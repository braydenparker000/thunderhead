// @ts-check
// A small tick under the finger (docs/design/EDITOR.md): the dial passing its start or reaching an end, the drum's
// face clicking into place, Undo and Redo, an export done. Kept rare on purpose: never one per pixel of a drag, and
// never more than one every 40 ms. Off with the owner's setting (Settings › Photos › Editor › Haptics), when the
// phone asks for less motion, and where the browser has no vibration (it then does nothing, and never throws).
import { prefOn } from '/th/pref.js';

/** How long each kind buzzes, in ms (a list: buzz, pause, buzz). */
export const KINDS = /** @type {Record<string, number | number[]>} */ ({ detent: 8, end: 14, done: [10, 70, 16] });
const GAP = 40;
let last = -1e9;

/** Whether a tick would be felt now: the setting is on, the phone does not ask for less motion, and it can vibrate. */
export function can() {
  try {
    if (!prefOn('photos.haptics', true)) return false;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  } catch { return false; }
}
/** A tick of `kind` ('detent', 'end' or 'done'). Returns whether one was asked of the phone. @param {string} kind */
export function tick(kind) {
  try {
    const now = performance.now();
    if (now - last < GAP || !can()) return false;
    last = now;
    return navigator.vibrate(KINDS[kind] ?? KINDS.detent) !== false;
  } catch { return false; }
}
