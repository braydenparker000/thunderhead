// @ts-check
// Small pictures of the open photo, drawn off screen between the dial's frames: a look's tile, a version's, the
// 100 % view's map, the photo before any edit. Each is made once, when a board first asks, and kept by its key
// until another photo opens.
import * as photo from './session.js';

let of = /** @type {unknown} */ (null);   // the photo these were made from
const made = /** @type {Map<string, string>} */ (new Map()), asked = /** @type {Set<string>} */ (new Set());

/** A picture's URL: '' until it is made (a change follows, so the board draws again).
 * @param {string} key its name; a key that starts the same up to ':' as an older one replaces it when `only`
 * @param {import('./past.js').State | null | (() => import('./past.js').State)} st the edit to draw (or what makes it, asked only when the
 *   picture has to be made); null: the photo as it is now
 * @param {number} w pixels wide (0: the editing copy's own size) @param {{ amount?: number }} [more] @param {boolean} [only] */
export function tile(key, st, w, more, only = false) {
  const now = photo.current();
  if (now !== of) { of = now; for (const u of made.values()) URL.revokeObjectURL(u); made.clear(); asked.clear(); }
  if (now && !made.has(key) && !asked.has(key)) {
    asked.add(key);
    photo.picture(typeof st === 'function' ? st() : st, w, more).then((url) => {
      if (of !== now || !url) { URL.revokeObjectURL(url); return; }
      const kind = key.slice(0, key.indexOf(':') + 1);
      if (only) for (const [k, u] of made) if (k.startsWith(kind)) { URL.revokeObjectURL(u); made.delete(k); asked.delete(k); }
      made.set(key, url); photo.events.dispatchEvent(new Event('change'));
    }, () => asked.delete(key));
  }
  if (made.has(key)) return /** @type {string} */ (made.get(key));
  const kind = key.slice(0, key.indexOf(':') + 1);   // the one it replaces stands in meanwhile
  return (only && [...made].find(([k]) => k.startsWith(kind))?.[1]) || '';
}
