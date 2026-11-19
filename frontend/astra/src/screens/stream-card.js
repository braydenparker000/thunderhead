// One stream's card on the Streams screen (screens/streams.js), and in the player's Sources panel (sourceCard).
// Designed (Settings › Streams, the default): what the stream says is read into facts (addons/release-facts.js)
// and laid out on the type and space scales:
//   line 1  the resolution badge (solid, the strongest thing on the card), picture badges, codec, sound, ready;
//   line 2  the release's own name on one line, cut in the middle so its end (group, extension) stays readable;
//   line 3  size · data an hour · source · group · indexer · seeders · languages, in caption size;
//   then the one quiet note on how it will play here (addons/stream-note.js).
// A fact not found is simply absent. When too little is found (release-facts.js designedEnough: the resolution
// and two more facts), or the owner chose "Add-on text", the add-on's own words are shown as it wrote them (the
// torrent's hash taken out). Nothing is lost: a long press shows the add-on's full text. A finger coming down
// starts getting ready (app/ready.js); a tap plays it, the card handed to the player as the origin of its
// opening. Nothing on a card ranks, hides or picks a stream. A long list is drawn in slices (drawInSlices).

import {h} from '../ui/dom.js';
import {longPress, sheet, toast} from '../ui/components.js';
import {press} from '../ui/motion.js';
import {bytesOf, minutesOf, perHour} from '../addons/stream-facts.js';
import {designedEnough, releaseFacts, splitMiddle} from '../addons/release-facts.js';
import {soundNote} from '../addons/device-facts.js';
import {withoutHash} from '../addons/stream-text.js';
import {externalPlayerUrl, canOpenExternally} from '../player/external.js';

const NEEDS_DEBRID = 'Torrents need a debrid add-on such as TorBox.';
/** Cards in the first slice at most (more than a screenful), then at most SLICE cards a slice; every slice also stops
 * after SLICE_MS of work (each stays under about 8 ms a frame with its layout on a slowed phone). */
export const FIRST = 10, SLICE = 8, SLICE_MS = 4;
const sizeLabel = n => !n ? '' : n >= 1e9 ? (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + ' GB' : Math.round(n / 1e6) + ' MB';

/** A best-effort size from the stream's own number or text ("💾 4.2 GB", "1,400 MB"), as "1.4 GB". */
export function sizeFrom(stream) { return sizeLabel(bytesOf(stream)); }

/** A stream's name as shown: without the hash, on one line; the add-on's name when it has none. */
export const shownName = (s, addonName) => (withoutHash(s.name).trim() || addonName).replace(/\s*\n\s*/g, ' ');

/** What the add-on said of a stream, whole, without the hash: what the long press shows. */
export const originalText = (s, addonName) => [shownName(s, addonName), withoutHash(s.title).trim(), s.filename && !String(s.title).includes(s.filename) ? s.filename : ''].filter(Boolean).join('\n');

/** How cards look now, from Settings › Streams (settings/streams.js); every switch on when there is no app. */
export function cardStyle(app) {
  const get = (id, fallback) => { try { return app?.setting ? app.setting(id) : fallback; } catch { return fallback; } };
  return {designed: get('streamCard', 'designed') === 'designed', badges: get('streamCardBadges', true), release: get('streamCardRelease', true),
    details: get('streamCardDetails', true), ready: get('streamCardReady', true)};
}

const dot = () => h('i', {class: 'sc-dot', 'aria-hidden': 'true'}, '·');
const joined = parts => parts.filter(Boolean).flatMap((p, i) => (i ? [dot(), p] : [p]));
const runtimeWords = m => (!m ? '' : m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
const bitrateWords = b => (!b ? '' : b >= 1e6 ? `${(b / 1e6).toFixed(1)} Mbps` : `${Math.round(b / 1e3)} kbps`);
const languageWords = list => (list.length > 2 ? `${list.slice(0, 2).join(', ')} +${list.length - 2}` : list.join(', '));

/** The designed lines for a stream's facts `f`, as the style `st` asks. */
function designedLines(s, f, st, minutes) {
  const picture = f.picture.some(p => p === 'DV' || p.startsWith('HDR')) ? f.picture.filter(p => p !== '10-bit') : f.picture;
  const sound = [f.sound.codec, f.sound.channels, f.sound.atmos ? 'Atmos' : ''].filter(Boolean).join(' ');
  const ready = st.ready && f.ready !== null ? h('span', {class: 'sc-ready' + (f.ready ? ' on' : '')}, f.ready ? 'Ready' : 'Not ready', f.service ? h('span', {class: 'visually-hidden'}, ` on ${f.service}`) : null) : null;
  // A real resolution is the solid badge; a quality word the add-on gave instead ("Low quality", "HD") is a quiet outline.
  const badge = f.resLabel ? h('b', {class: 'sc-res'}, f.resLabel) : f.quality ? h('b', {class: 'sc-quality'}, f.quality) : null;
  const parts = [badge, ...(st.badges ? [...picture.map(p => h('span', {class: 'sc-badge'}, p)), f.codec ? h('span', {class: 'sc-tech'}, f.codec) : null, sound ? h('span', {class: 'sc-tech'}, sound) : null] : []), ready].filter(Boolean);
  const top = parts.length ? h('span', {class: 'sc-top'}, ...parts) : null;
  const shownAs = f.release || f.title, [head, tail] = splitMiddle(shownAs);
  const name = st.release && shownAs ? h('span', {class: 'sc-name'}, h('span', {class: 'sc-head'}, head), tail ? h('span', {class: 'sc-tail'}, tail) : null) : null;
  const hourly = perHour(f.bytes, minutes || f.runtime);
  const seeds = f.seeders != null && (f.ready !== true || f.kind === 'p2p') ? `${f.seeders} seed${f.seeders === 1 ? '' : 's'}` : '';
  const facts = st.details ? joined([sizeLabel(f.bytes), hourly, f.source !== f.quality ? f.source : '', runtimeWords(f.runtime), bitrateWords(f.bitrate), f.group, f.via, f.indexer, seeds,
    languageWords(f.languages), !s.url && s.infoHash ? 'Torrent' : '']) : [];
  // The sound converted on the phone is said on a line of its own, above the note on how the picture plays.
  return [top, name, facts.length ? h('span', {class: 'sc-facts'}, ...facts) : null, s.url && soundNote(s) ? h('span', {class: 'sc-sound sound'}, soundNote(s)) : null];
}

/** The add-on's own lines (as before the designed card): its name, its words, size and data an hour. */
function addonLines(s, addonName, minutes) {
  const desc = withoutHash(s.title), size = s.size ? sizeFrom(s) : ''; // a size already in the description is not repeated
  const hourly = perHour(bytesOf(s), minutes);
  return [h('b', {class: 'stream-name'}, shownName(s, addonName)), desc.trim() ? h('span', {class: 'stream-desc'}, desc) : null,
    h('span', {class: 'stream-badges'}, size ? h('em', {}, size) : null, hourly ? h('em', {}, hourly) : null, !s.url && s.infoHash ? h('em', {class: 'muted'}, 'Torrent') : null,
      s.url && soundNote(s) ? h('em', {class: 'sound'}, soundNote(s)) : null)];
}

/**
 * A card's lines for stream `s` (its add-on named `addonName`, the title `minutes` long), as Settings say:
 * {designed, lines}. Exported for the player's Sources panel through sourceCard.
 */
export function cardLines(s, {addonName = '', minutes = null, style = cardStyle(null)} = {}) {
  const f = releaseFacts(s);
  if (style.designed && designedEnough(f)) {
    // The add-on's own name for the stream stays with the card for screen readers (the badge says the rest).
    return {designed: true, lines: [h('span', {class: 'visually-hidden'}, shownName(s, addonName) + '. '), ...designedLines(s, f, style, minutes)]};
  }
  return {designed: false, lines: addonLines(s, addonName, minutes)};
}

/** The long press: the add-on's full words (copied by a tap), then the link's other ways to play. */
function openSheet(s, addonName, metaName) {
  const words = originalText(s, addonName);
  sheet(shownName(s, addonName).replace(/\s+/g, ' '), [
    {label: 'Copy the add-on’s words', icon: 'info', detail: words, run: () => navigator.clipboard.writeText(words).then(() => toast('Copied'), () => toast('Copy failed'))},
    ...(s.url ? [
      {label: 'Copy stream link', icon: 'copy', run: () => navigator.clipboard.writeText(s.url).then(() => toast('Link copied'), () => toast('Copy failed'))},
      canOpenExternally() ? {label: 'Play in another app', icon: 'play', run: () => { const url = externalPlayerUrl(s.url, {title: metaName || ''}); if (url) location.href = url; }} : null,
      {label: 'Open in VLC', icon: 'play', run: () => { location.href = `intent:${s.url}#Intent;package=org.videolan.vlc;type=video/*;S.title=${encodeURIComponent(metaName || '')};end`; }},
      {label: 'Check playback in the lab', icon: 'info', run: () => { /* a fragment never reaches a server or a cache key, and the lab drops it from the address */ location.href = `lab/#src=${encodeURIComponent(s.url)}`; }},
    ] : []),
  ].filter(Boolean), {subtitle: addonName});
}

/** The card for stream `s` of `group` on `screen` (a StreamsScreen). */
export function streamCard(screen, group, s) {
  const playable = !!s.url, minutes = minutesOf(screen.video?.runtime || screen.meta.runtime);
  const {designed, lines} = cardLines(s, {addonName: group.addon.name, minutes, style: screen.style || cardStyle(screen.app)});
  const card = h('button', {class: 'stream-card' + (designed ? ' designed' : '') + (playable ? '' : ' disabled'), type: 'button', 'aria-disabled': String(!playable),
    onpointerdown: () => screen.ahead?.pressed(s)?.then(a => screen.notes?.learn(a), () => {}),
    onclick: () => {
      if (!playable && s.externalUrl && /^https?:/i.test(s.externalUrl)) { window.open(s.externalUrl, '_blank', 'noopener'); return; }
      if (!playable) { toast(s.infoHash ? NEEDS_DEBRID : 'This source has no playable link.'); return; }
      // The sources as they are now (more add-ons may have answered since this card was drawn).
      const sources = screen.sources(), source = sources.find(x => x.id === s.key);
      if (!source) return;
      // The card is where the player opens from (app/playing.js passes it on to the player).
      screen.app.play({meta: screen.meta, video: screen.video, source, sources, startTime: screen.startTime, origin: card});
    }},
  ...lines, playable ? screen.notes?.mark(s) : null); // how it will play here (addons/stream-note.js); informs only
  press(card); // pressed in the same frame as the touch, released with a spring (FEEL.md "Press")
  longPress(card, () => openSheet(s, group.addon.name, screen.meta.name));
  return card;
}

/**
 * The same card for the player's Sources panel: `source` as StreamsScreen.sources() gives it ({id, label,
 * stream, addonUrl}), `current` marks the one playing, `onPick(source)` runs on a tap. `app` reads the style.
 */
export function sourceCard(source, {current = false, onPick = () => {}, minutes = null, app = null, addonName = ''} = {}) {
  const s = source.stream || {};
  const {designed, lines} = cardLines(s, {addonName: addonName || String(source.label || '').split(' · ')[0], minutes, style: cardStyle(app)});
  return press(h('button', {class: 'stream-card source' + (designed ? ' designed' : '') + (current ? ' current' : ''), type: 'button', 'aria-current': current ? 'true' : null,
    onclick: () => onPick(source)}, ...lines));
}

/**
 * Draws `items` into `body` in their order: a first slice at once (up to FIRST), then one slice a frame, each laid
 * out in its own frame (300 cards at once held a slowed phone for half a second; a card costs more to lay out than
 * to make, so a slice is counted in cards as well as in time; off screen, content-visibility skips the layout). Only ever appends, so a card under a finger is never
 * replaced or moved; `alive()` turns false when the body is drawn again, which ends the work left. `drawn(cards)`
 * hears each slice once it is in the page (the list makes the visible ones rise).
 */
export function drawInSlices(body, items, make, alive, drawn = null) {
  let i = 0;
  const slice = (count, budget) => {
    const first = i, stop = Math.min(items.length, i + count), end = performance.now() + budget, part = document.createDocumentFragment(), made = [];
    while (i < stop && (i === first || performance.now() < end)) { const el = make(items[i++]); made.push(el); part.append(el); }
    body.append(part);
    drawn?.(made);
    // The next slice after this one has been drawn: a task posted from a frame's callback runs after that frame.
    if (i < items.length) requestAnimationFrame(() => setTimeout(() => { if (alive()) slice(SLICE, SLICE_MS); }, 0));
  };
  slice(FIRST, SLICE_MS);
}
