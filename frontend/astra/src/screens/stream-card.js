// One stream's card on the Streams screen (screens/streams.js): its name and the add-on's own words (the
// torrent's hash taken out, addons/stream-text.js), its size and what an hour of it costs, and one quiet note
// on how it will play here (addons/stream-note.js). A finger coming down on it starts getting ready
// (app/ready.js); a tap plays it; a long press offers the link elsewhere. Nothing on it ranks, hides or picks
// a stream. A long list is drawn in slices (drawInSlices) so the page never stops for it.

import {h} from '../ui/dom.js';
import {longPress, sheet, toast} from '../ui/components.js';
import {bytesOf, minutesOf, perHour} from '../addons/stream-facts.js';
import {soundNote} from '../addons/device-facts.js';
import {withoutHash} from '../addons/stream-text.js';
import {externalPlayerUrl, canOpenExternally} from '../player/external.js';

const NEEDS_DEBRID = 'Torrents need a debrid add-on such as TorBox.';
/** Cards drawn at once (more than a screenful), then how long each later slice may take. */
export const FIRST = 10, SLICE_MS = 6;
const sizeLabel = n => !n ? '' : n >= 1e9 ? (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + ' GB' : Math.round(n / 1e6) + ' MB';

/** A best-effort size from the stream's own number or text ("💾 4.2 GB", "1,400 MB"), as "1.4 GB". */
export function sizeFrom(stream) { return sizeLabel(bytesOf(stream)); }

/** A stream's name as shown: without the hash, on one line; the add-on's name when it has none. */
export const shownName = (s, addonName) => (withoutHash(s.name).trim() || addonName).replace(/\s*\n\s*/g, ' ');

/** The card for stream `s` of `group` on `screen` (a StreamsScreen). */
export function streamCard(screen, group, s) {
  const playable = !!s.url, desc = withoutHash(s.title);
  const size = s.size ? sizeFrom(s) : ''; // a size already in the description is not repeated
  // What an hour of it costs in data, when the title's runtime is known.
  const hourly = perHour(bytesOf(s), minutesOf(screen.video?.runtime || screen.meta.runtime));
  const card = h('button', {class: 'stream-card' + (playable ? '' : ' disabled'), type: 'button', 'aria-disabled': String(!playable), onpointerdown: () => screen.ahead?.pressed(s)?.then(a => screen.notes?.learn(a), () => {}),
    onclick: () => {
      if (!playable && s.externalUrl && /^https?:/i.test(s.externalUrl)) { window.open(s.externalUrl, '_blank', 'noopener'); return; }
      if (!playable) { toast(s.infoHash ? NEEDS_DEBRID : 'This source has no playable link.'); return; }
      // The sources as they are now (more add-ons may have answered since this card was drawn).
      const sources = screen.sources(), source = sources.find(x => x.id === s.key);
      if (!source) return;
      screen.app.play({meta: screen.meta, video: screen.video, source, sources, startTime: screen.startTime});
    }},
    h('b', {class: 'stream-name'}, shownName(s, group.addon.name)),
    desc.trim() ? h('span', {class: 'stream-desc'}, desc) : null,
    h('span', {class: 'stream-badges'}, size ? h('em', {}, size) : null, hourly ? h('em', {}, hourly) : null, !playable && s.infoHash ? h('em', {class: 'muted'}, 'Torrent') : null,
      playable && soundNote(s) ? h('em', {class: 'sound'}, soundNote(s)) : null),
    playable ? screen.notes?.mark(s) : null); // how it will play here (addons/stream-note.js); informs only
  if (playable) longPress(card, () => sheet(shownName(s, group.addon.name).replace(/\s+/g, ' '), [
    {label: 'Copy stream link', icon: 'copy', run: () => navigator.clipboard.writeText(s.url).then(() => toast('Link copied'), () => toast('Copy failed'))},
    canOpenExternally() ? {label: 'Play in another app', icon: 'play', run: () => { const url = externalPlayerUrl(s.url, {title: screen.meta.name || ''}); if (url) location.href = url; }} : null,
    {label: 'Open in VLC', icon: 'play', run: () => { location.href = `intent:${s.url}#Intent;package=org.videolan.vlc;type=video/*;S.title=${encodeURIComponent(screen.meta.name || '')};end`; }},
    {label: 'Check playback in the lab', icon: 'info', run: () => { /* a fragment never reaches a server or a cache key, and the lab drops it from the address */ location.href = `lab/#src=${encodeURIComponent(s.url)}`; }},
  ].filter(Boolean), {subtitle: group.addon.name}));
  return card;
}

/**
 * Draws `items` into `body` in their order: the first FIRST at once, the rest SLICE_MS' worth at a time between
 * frames (300 cards at once held a slowed phone for half a second). Only ever appends, so a card under a finger
 * is never replaced or moved; `alive()` turns false when the body is drawn again, which ends the work left.
 */
export function drawInSlices(body, items, make, alive) {
  let i = 0;
  const slice = budget => {
    const end = performance.now() + budget, part = document.createDocumentFragment();
    while (i < items.length && (i < FIRST || performance.now() < end)) part.append(make(items[i++]));
    body.append(part);
    if (i < items.length) setTimeout(() => { if (alive()) slice(SLICE_MS); }, 0);
  };
  slice(0);
}
