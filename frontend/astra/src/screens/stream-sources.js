// The stream list's playable streams as the player lists them (its Sources panel, and what a tap hands it): made
// once per drawing of the list (screens/streams.js `drawnAt`), ahead, 40 a frame when the main thread is free, so a
// tap reads them in its own frame; made at once only when a tap comes before that (or for a headless screen).

import {withoutHash} from '../addons/stream-text.js';
import {sizeFrom} from './stream-card.js';
import {inParts} from './stream-pace.js';

/** A source's name: the add-on's, then the stream's, once only when the stream's already starts with it ("Example 1080p", not "Example Example 1080p"). */
export function sourceName(addon, stream, between = ' ') {
  const a = String(addon || '').replace(/\s+/g, ' ').trim(), n = String(stream || '').replace(/\s+/g, ' ').trim();
  return !n ? a : (a && n.toLowerCase().startsWith(a.toLowerCase()) && !/[\p{L}\p{N}]/u.test(n[a.length] || '') ? n : `${a}${between}${n}`).trim();
}

/** Each playable stream of `screen` with its group, in the add-ons' order. */
const playable = screen => [...screen.groups.values()].filter(g => g.streams).sort((a, b) => a.order - b.order).flatMap(g => g.streams.filter(s => s.url).map(s => [g, s]));

/** One as the player lists it: its add-on's name and its own, its words and size (no hash shown). */
const sourceOf = (g, s) => ({id: s.key, addonUrl: g.addon.url, label: sourceName(g.addon.name, withoutHash(s.name), ' · '),
  detail: [withoutHash(s.title).trim(), sizeFrom(s)].filter(Boolean).join('\n'), stream: {...s, name: sourceName(g.addon.name, s.name)}});

/** The screen's sources for the drawing on screen now (StreamsScreen.sources). */
export function sourcesOf(screen) {
  if (screen.listed && screen.listed.at === screen.drawnAt) return screen.listed.list; // a headless screen (collect) has none: made each time
  const list = playable(screen).map(([g, s]) => sourceOf(g, s));
  if (screen.drawnAt != null) screen.listed = {at: screen.drawnAt, list};
  return list;
}

/** The same made ahead, 40 a frame; dropped if the list is drawn again (or closed) meanwhile. */
export async function prepareSources(screen) {
  const at = screen.drawnAt, list = [];
  if (screen.listed?.at === at) return;
  if (await inParts(playable(screen), 40, part => list.push(...part.map(([g, s]) => sourceOf(g, s))), () => !screen.destroyed && screen.drawnAt === at)) screen.listed = {at, list};
}
