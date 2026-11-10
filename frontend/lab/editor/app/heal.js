// @ts-check
// The open photo's retouching (engine/heal.js): spots, each replaced by another place in the photo. They are part
// of the edit (session.js keeps them and hands them to the engine with the geometry), so every change here is a
// step of the history.
import { MOST } from '../../engine/heal.js';
import { changed, cur, draw, eng, save } from './session.js';

/** @typedef {import('../../engine/heal.js').Spot} Spot */
export const list = () => /** @type {Spot[]} */ (cur?.spots || []);
const done = (/** @type {string} */ key, /** @type {string} */ name, val = '') => { changed(); draw(); save(key, name, val); };

/** A new spot where the photo was tapped, its source picked from nearby (further afield for Remove). Returns its place
 * in the list, −1 when there is no room. @param {Spot['tool']} tool @param {number} u @param {number} v 0..1 across
 * and down the picture as shown @param {number} size the spot's width as a share of the picture's @param {number} feather @param {number} opacity 0..1 */
export function add(tool, u, v, size, feather, opacity) {
  if (!cur || !eng || list().length >= MOST) return -1;
  const [x, y] = eng.maskPoint(u, v), e = eng.maskPoint(u + size / 2, v), r = Math.hypot(e[0] - x, e[1] - y), [sx, sy] = eng.healSource({ x, y, r }, tool === 'Remove');
  cur.spots = [...list(), { x, y, r, sx, sy, tool, feather, opacity }];
  done('', `${tool} spot`);
  return list().length - 1;
}
/** @param {number} i @param {Partial<Spot>} patch @param {string} key what keeps moving, for the history @param {string} name @param {string} [val] */
export function set(i, patch, key, name, val) { if (!cur || !list()[i]) return; cur.spots = list().map((s, k) => (k === i ? { ...s, ...patch } : s)); done(`spot${i}:${key}`, name, val); }
/** A spot's source dragged to another place. @param {number} i @param {number} u @param {number} v */
export function moveSource(i, u, v) { if (!eng) return; const [sx, sy] = eng.maskPoint(u, v); set(i, { sx, sy }, 'source', 'Spot source moved'); }
/** A spot's size, as a share of the picture's width where it lies. @param {number} i @param {number} size @param {string} text */
export function resize(i, size, text) { const s = list()[i]; if (!s || !eng) return; const [u, v] = eng.shownPoint(s.x, s.y), e = eng.maskPoint(u + size / 2, v); set(i, { r: Math.hypot(e[0] - s.x, e[1] - s.y) }, 'size', 'Spot size', text); }
/** The last spot taken away. */
export function undoSpot() { if (!cur || !list().length) return; cur.spots = list().slice(0, -1); done('', 'Spot removed'); }
export function clear() { if (!cur || !list().length) return; cur.spots = []; done('', 'Spots cleared'); }
