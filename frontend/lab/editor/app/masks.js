// @ts-check
// The open photo's masks (engine/local.js): adding one, laying it on the picture, its own adjustments, and what
// a range mask picks up under a tap. They are part of the edit (session.js keeps, draws and saves them), so
// every change here is a step of the history like any other.
import { changed, cur, draw, eng, save, view } from './session.js';

/** @typedef {import('../../engine/local.js').Mask} Mask */
export const DRAW = ['Linear', 'Radial'], RANGE = ['Color', 'Luminance'];
/** The settings that run 0..100, and where each starts. */
export const UNI = /** @type {Record<string, number>} */ ({ Feather: 50, Range: 30, Amount: 100 });
export const list = () => /** @type {Mask[]} */ (cur?.masks || []);
/** A mask's name as the board lists it. @param {Mask} m */
export const label = (m) => (DRAW.includes(m.kind) ? `${m.kind} gradient` : m.kind) + (m.n > 1 ? ` ${m.n}` : '');
const named = (/** @type {number} */ i) => `Mask · ${label(list()[i])}`;
const done = (/** @type {string} */ key, /** @type {string} */ name, val = '') => { changed(); draw(); save(key, name, val); };

/** Adds a mask and returns its place in the list (−1 when there is no room). A gradient starts laid over the
 * picture as it is shown: a linear one down from the top, a radial one in the middle. @param {Mask['kind']} kind */
export function add(kind) {
  if (!cur || !eng || list().length >= 8) return -1;
  const P = eng.maskPoint, c = P(0.5, 0.5), r = Math.hypot(P(0.75, 0.5)[0] - c[0], P(0.75, 0.5)[1] - c[1]);
  const a = kind === 'Linear' ? [...P(0.5, 0.15), ...P(0.5, 0.55)] : kind === 'Radial' ? [...c, r, r * 0.8] : null;
  cur.masks = [...list(), { kind, n: list().filter((m) => m.kind === kind).length + 1, vals: {}, invert: false, a, pick: null }];
  done('', `${named(list().length - 1)} added`);
  return list().length - 1;
}
/** @param {number} i @param {Partial<Mask>} patch */
const set = (i, patch) => { if (cur) cur.masks = list().map((m, k) => (k === i ? { ...m, ...patch } : m)); };
/** One of a mask's own adjustments or settings. @param {number} i @param {string} name @param {number} v @param {string} text as the plate shows it */
export function setVal(i, name, v, text) { const m = list()[i]; if (!m || m.vals[name] === v) return; set(i, { vals: { ...m.vals, [name]: v } }); done(`mask${i}:${name}`, `${named(i)} · ${name}`, text); }
/** Where a gradient lies, in mask units (it follows a finger: one step of the history a drag). @param {number} i @param {number[]} a */
export function lay(i, a) { if (!list()[i]) return; set(i, { a }); done(`mask${i}:lay`, `${named(i)} moved`); }
/** A range mask takes the colour or the brightness under a tap. @param {number} i @param {number} u @param {number} v 0..1 across and down the picture */
export function pick(i, u, v) {
  const m = list()[i], t = m && eng && cur ? eng.toneAt(u, v, cur.shotEv) : null;
  if (!m || !t) return;
  set(i, { pick: m.kind === 'Color' ? [t[1], t[2]] : [t[0]] }); done('', `${named(i)} picked`);
}
/** @param {number} i */
export function invert(i) { const m = list()[i]; if (!m) return; set(i, { invert: !m.invert }); done('', `${named(i)} inverted`); }
/** Its adjustments back to none (where it lies stays). @param {number} i */
export function reset(i) { const m = list()[i]; if (!m) return; const name = `${named(i)} reset`; set(i, { vals: {}, invert: false }); done('', name); }
/** @param {number} i */
export function remove(i) { if (!cur || !list()[i]) return; const name = `${named(i)} deleted`; cur.masks = list().filter((_, k) => k !== i); done('', name); }
/** Which mask is laid over the picture in red while the Masks board is up (−1: none). @param {number} i */
export function show(i) { if (view.mask === i) return; view.mask = i; draw(); }
