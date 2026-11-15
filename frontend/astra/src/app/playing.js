// The play path, from the owner's tap on a stream to the player playing it:
// the player opens at once (full screen needs the tap), TorBox links are
// resolved to the file, then it loads. Another source or episode picked in
// the player comes back through here, so it is resolved the same way.
//
// Every play has a ticket (app.playTicket): a later tap, a close or another
// pick makes the earlier one stale, and a stale one does nothing after its
// await (a slow lookup cannot load over what the owner chose since, nor open
// a player the owner closed). Nothing plays that the owner did not pick.

import {episodeCode, aired} from './content.js';
import {resolveDebrid} from '../addons/debrid.js';
import {filtersFrom, shown} from '../addons/stream-facts.js';
import {sizeFrom} from '../screens/streams.js';
import {h} from '../ui/dom.js';
import {toast} from '../ui/components.js';

// "Out 3 Nov" for an episode with a date to come; "Not out yet" without one.
const outOn = v => { const t = v?.released ? new Date(v.released) : null; return t && !Number.isNaN(t.getTime()) ? 'Out ' + t.toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) : 'Not out yet'; };

/**
 * Whether a progress report may be saved over the title's saved place. A
 * load asked to start later (a resume) reports early times before it gets
 * there (the video's clock starts at 0, or at the keyframe before): those
 * would overwrite the resume point. Once playback has reached it (or run a
 * minute, the start having been ignored), every report counts.
 * @param {number} time @param {{startTime: number, reached?: boolean}} load (marked reached here)
 */
export function keepProgress(time, load) {
  if (!load || load.reached || !(load.startTime > 0)) return true;
  if (time >= load.startTime - 5 || time >= 60) load.reached = true;
  return !!load.reached;
}

/**
 * The streams the owner's filter chips let through (screens/streams.js shows
 * the same: per add-on, in its order, smallest first when asked, and the
 * Thunderhead's size limit), and those they hide.
 */
export function filterSources(sources, filters, maxMb = 0) {
  const f = filtersFrom(filters), kept = new Set();
  const byAddon = new Map(), out = [];
  for (const s of sources) byAddon.set(s.addonUrl, [...(byAddon.get(s.addonUrl) || []), s]);
  for (const group of byAddon.values()) for (const [, i] of shown(group.map(s => s.stream), f)) if (!overLimit(group[i].stream, maxMb)) { out.push(group[i]); kept.add(group[i]); }
  return {sources: out, hidden: sources.filter(s => !kept.has(s))};
}
const overLimit = (s, mb) => { const m = mb && /^([\d.]+) (GB|MB)$/.exec(sizeFrom(s)); return !!m && Number(m[1]) * (m[2] === 'GB' ? 1000 : 1) > mb; };

/** Plays a stream from the streams screen. Must run from a tap: the player goes full screen before anything awaits. */
export function play(app, options) {
  const ticket = ++app.playTicket;
  if (app.player) return playNow(app, options, ticket);
  // First play of the visit: the engine is still loading (the tap's user
  // activation lasts long enough for full screen once it has). The player's
  // black loading screen shows at once, so the tap is answered.
  const veil = h('div', {class: 'player-veil', role: 'status', 'aria-label': 'Opening the player'}, h('div', {class: 'spinner'}));
  app.root.append(veil);
  app.loadPlayer().then(() => { if (ticket === app.playTicket) playNow(app, options, ticket); }, () => toast('The player could not load. Check the connection.'))
    .finally(() => setTimeout(() => veil.remove(), 150));
}

/** What the player shows for a title or an episode (everything but the stream). */
function describe(meta, video) {
  const videos = meta.videos || [];
  const index = video ? videos.findIndex(v => v.id === video.id) : -1;
  const next = index >= 0 ? videos.slice(index + 1).find(v => v.season !== 0) || null : null;
  return {next, options: {
    meta: {
      id: meta.id, title: meta.name, episodeLine: video ? [episodeCode(video), video.title].filter(Boolean).join(' • ') : '',
      release: [String(meta.releaseInfo || '').slice(0, 4), (meta.genres || [])[0]].filter(Boolean).join(' · '),
      description: video?.overview || meta.description || '', logo: meta.logo || '', background: video?.thumbnail || meta.background || '', poster: meta.poster || '',
    },
    // The player's episode panel lists seasons; videos without one (a channel's uploads) have no panel.
    episodes: video && video.season != null ? {seasons: [...new Set(videos.map(v => v.season))].filter(s => s != null), season: video.season, current: video.id,
      items: videos.filter(v => v.season != null).map(v => ({id: v.id, season: v.season, episode: v.episode, title: v.title, thumbnail: v.thumbnail, video: v}))} : null,
    next: next ? {label: episodeCode(next), title: next.title, thumbnail: next.thumbnail, hasAired: aired(next), status: aired(next) ? '' : outOn(next)} : null,
  }};
}

function playNow(app, {meta, video = null, source, sources, hiddenSources = [], startTime = 0}, ticket) {
  app.setCovered(true);
  const {next, options} = describe(meta, video);
  app.playing = {meta, video, next, stream: source.stream, sourceId: source.id, load: {startTime}};
  app.player.open({...options, stream: {...source.stream, url: null}, sourceId: source.id, sources, hiddenSources, startTime, deferred: true});
  resolveAndLoad(app, source.stream, startTime, ticket);
}

async function resolveAndLoad(app, stream, startTime, ticket) {
  const url = await resolveDebrid(stream.url).catch(() => stream.url);
  if (ticket === app.playTicket && app.player.isOpen) app.player.load({...stream, url}, startTime);
}

export function bindPlayer(app) {
  const player = app.player;
  const save = (time, duration) => {
    const p = app.playing;
    if (!p || !keepProgress(time, p.load)) return;
    const v = p.video;
    const entry = app.progress.save({type: p.meta.type, id: p.meta.id, videoId: v ? v.id : p.meta.id, season: v?.season ?? null, episode: v?.episode ?? null, time, duration, meta: p.meta,
      next: p.next ? {videoId: p.next.id, season: p.next.season, episode: p.next.episode, title: p.next.title, thumbnail: p.next.thumbnail} : null});
    if (entry?.completed && !app.watched.has(p.meta.type, p.meta.id, v ? v.id : null)) app.watched.set(p.meta.type, p.meta.id, v ? v.id : null, true);
  };
  player.addEventListener('progress', e => { save(e.detail.time, e.detail.duration); if (e.detail.final) app.progress.flush(true); });
  player.addEventListener('close', () => {
    app.playTicket++; // whatever was on its way is dropped
    app.progress.flush(true); app.playing = null; app.subtitleSearch?.abort(); app.subtitleSearch = null; app.setCovered(app.stack.length > 0);
  });
  player.addEventListener('episode', e => switchEpisode(app, e.detail.episode.video));
  player.addEventListener('next', () => { if (app.playing?.next) switchEpisode(app, app.playing.next); });
  // Another source from the player's panel: resolved here (TorBox), from where the film was.
  player.addEventListener('source', e => {
    const p = app.playing;
    if (!p) return;
    e.preventDefault();
    const {source, startTime} = e.detail, ticket = ++app.playTicket;
    Object.assign(p, {sourceId: source.id, stream: source.stream, load: {startTime}});
    player.defer(source.stream, startTime);
    resolveAndLoad(app, source.stream, startTime, ticket);
  });
  player.addEventListener('fileinfo', e => app.findSubtitles(e.detail));
}

/**
 * Another episode from inside the player (a tap on Next or in the episode
 * panel). What plays stops while its streams are collected. The same
 * release group plays on when it has the episode; otherwise the episode's
 * sources, through the owner's filters, wait for the owner to pick one.
 */
async function switchEpisode(app, video) {
  const {meta} = app.playing || {};
  const player = app.player;
  if (!meta || !player.isOpen) return;
  const ticket = ++app.playTicket;
  const group = player.stream?.bingeGroup;
  player.video.pause();
  player.showLoading(true);
  const streams = new app.screenTypes.streams(app, meta, video, {headless: true});
  const all = await streams.collect().catch(() => []);
  if (ticket !== app.playTicket || !player.isOpen) return; // closed, or another pick since
  if (!all.length) return player.showError('None of your add-ons returned a playable stream for this episode.');
  const {sources, hidden} = filterSources(all, app.store.get('streamFilters', null), app.maxMb);
  const same = group && all.find(s => s.stream.bingeGroup === group);
  if (same) return playNow(app, {meta, video, source: same, sources: sources.includes(same) ? sources : [same, ...sources], hiddenSources: hidden.filter(s => s !== same)}, ticket);
  const {next, options} = describe(meta, video);
  app.playing = {meta, video, next, stream: null, sourceId: null, load: {startTime: 0}};
  player.open({...options, stream: null, sources, hiddenSources: hidden}); // the sources panel, nothing loading
}
