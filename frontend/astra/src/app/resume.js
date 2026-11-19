// A Continue Watching card's tap (screens/home.js), from the stream its progress entry remembers
// (app/remembered.js, owner ruling 2026-11-19). A 'resume' card plays that stream at once from where it
// stopped, resolved as a tap on the stream list resolves one (playing.js play: the same loading path), while
// the title's streams are collected behind it (a headless Streams collect, as the player's episode switch
// does) for the Sources panel; their arrival never disturbs what plays. When the remembered stream cannot be
// reached, the same stream is looked for in that list and played; when it is not there, the sources panel
// waits for the owner's pick with one plain line. A 'next' card continues the release group the owner
// watched (playing.js playNext, the rule of Next inside the player). Nothing is picked for the owner: only
// the stream they chose themselves plays again.

import {play, playNow, playNext, pickIn, filterSources, fullMeta} from './playing.js';
import {rememberedSource, sameStream} from './remembered.js';

export const GONE_LINE = 'The stream you were watching is no longer offered. Pick another.';

/** The episode a card names, or null for a film. */
export const videoOf = (e, m) => e.videoId && e.videoId !== m.id ? {id: e.videoId, season: e.season, episode: e.episode, title: e.title || '', thumbnail: e.thumbnail} : null;

/** Whether a card's tap plays without the stream list: a remembered stream to resume, or a release group to continue. */
export const playsDirectly = e => e.kind === 'next' ? !!e.stream?.group : !!e.stream?.link;

/**
 * Plays a card's remembered stream from `startTime`. Must run from the tap (the player goes full screen).
 * Returns false when the card remembers no stream (the caller opens the stream list).
 */
export function resumeRemembered(app, e, m, startTime) {
  const r = e.stream;
  if (!r?.link) return false;
  const video = videoOf(e, m), meta = {...m, videos: m.videos || []}, source = rememberedSource(r);
  // The title's streams, behind the player: for its Sources panel, and to find the same stream again.
  const collected = new app.screenTypes.streams(app, meta, video, {headless: true}).collect().catch(() => []);
  const recover = why => {
    const ticket = ++app.playTicket;
    app.player.errorCard.hidden = true; // a dead link's card: what follows replaces it
    app.player.showLoading(true);
    app.player.loadingStatus.textContent = 'Looking for your stream again…';
    collected.then(all => {
      if (ticket !== app.playTicket || !app.player.isOpen) return; // closed, or another pick since
      const meta = app.playing?.meta || {...m, videos: []}, {sources, hidden} = filterSources(all, app.store.get('streamFilters', null), app.maxMb);
      const same = sameStream(r, all, {skipHash: why === 'none'});
      if (same) return playNow(app, {meta, video: app.playing?.video ?? video, source: same, sources: sources.includes(same) ? sources : [same, ...sources], hiddenSources: hidden.filter(s => s !== same), startTime}, ticket);
      pickIn(app, meta, app.playing?.video ?? video, sources, hidden, GONE_LINE);
    });
  };
  play(app, {meta, video, source, sources: [source], startTime, recover});
  const ticket = app.playTicket; // this play's; a recovery, another pick or a close moves it on
  collected.then(all => { if (ticket === app.playTicket && app.player?.isOpen) adopt(app, r, all); });
  app.meta(m).then(full => { if (app.playing?.meta?.id === m.id) fullMeta(app, full); }, () => {});
  return true;
}

/** The collected streams reach the player's Sources panel; the one playing stays as it is, marked current. */
function adopt(app, r, all) {
  const player = app.player, p = app.playing;
  if (!all.length || !p?.stream) return;
  const {sources, hidden} = filterSources(all, app.store.get('streamFilters', null), app.maxMb);
  const same = sameStream(r, all), current = player.sources.find(s => s.id === player.sourceId);
  player.sources = same ? (sources.includes(same) ? sources : [same, ...sources]) : [current, ...sources].filter(Boolean);
  player.hiddenSources = hidden.filter(s => s !== same);
  if (same) { player.sourceId = same.id; p.sourceId = same.id; }
  player.actionButtons.sources.hidden = false;
  player.actions.replaceChildren(...Object.values(player.actionButtons).filter(b => !b.hidden));
  if (!player.panel.hidden && player.menus.panelName === 'sources') player.menus.renderPanel();
}

/** A 'next' card with a remembered release group: Next's rule. False without one (the caller opens the stream list). */
export function continueNext(app, e, m) {
  const group = e.stream?.group;
  if (!group) return false;
  const video = videoOf(e, m);
  playNext(app, {...m, videos: m.videos || []}, video, group);
  app.meta(m).then(full => { if (app.playing?.meta?.id === m.id) fullMeta(app, full); }, () => {});
  return true;
}

let ahead = null;
/**
 * A finger came down on a card with a remembered stream: the player's code starts loading, and with Settings ›
 * Playback › "Get ready ahead" on (data saver off) the stream's address is asked ahead (app/ready.js: mode 'ahead',
 * never adds anything), so the tap usually finds it waiting. Nothing is asked when Home is only shown.
 */
export function pressCard(app, e) {
  if (e.kind !== 'resume' || !e.stream?.link) return;
  app.loadPlayer?.().catch(() => {});
  import('./ready.js').then(({ReadyAhead}) => { ahead ??= new ReadyAhead(app); ahead.pressed(rememberedSource(e.stream).stream)?.catch(() => {}); }, () => {});
}
