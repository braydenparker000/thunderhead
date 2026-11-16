// @ts-check
// The photo gliding to another board's window (zoom.js `follow`) by its transform alone. The layer that holds it
// takes the new window's place at once, so the page is laid out once, not on every frame of the glide as when
// the layer's own left, top, width and height were eased (a phone then laid the page out 20 times in 320 ms);
// the photo is then put back where it showed, by a transform, and eased to where it now belongs, which the
// compositor does without the page (the "FLIP" way: first, last, invert, play).

const EASE = 'cubic-bezier(0.2, 0.85, 0.2, 1)', MS = 320;
let running = /** @type {Animation | null} */ (null);

/** Whether the photo is gliding now (its detail is drawn once it rests). */
export const flying = () => running?.playState === 'running';

/** Glides `el` from where it showed (`before`, its box on the screen then) to where it now is: `base` is its own
 * transform there (zoom.js `transform`), `k` the screen's CSS pixels to one of its own, and `tx`, `ty` the shift in
 * `base`. `room` is its layer, left unclipped while it glides (the photo, fitted, never spills past its window at
 * either end). Nothing glides with less motion asked for, or when it has not moved.
 * @param {HTMLElement} el @param {DOMRect} before @param {string} base @param {number} k @param {number} tx @param {number} ty @param {HTMLElement} room */
export function flip(el, before, base, k, tx, ty, room) {
  running?.cancel();
  const after = el.getBoundingClientRect(), s = before.width / (after.width || 1);
  const dx = (before.left - after.left) / k + tx * (1 - s), dy = (before.top - after.top) / k + ty * (1 - s);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !before.width || (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(s - 1) < 0.002)) return;
  room.style.overflow = 'visible';
  const a = el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s}) ${base}` }, { transform: base }], { duration: MS, easing: EASE });
  running = a;
  const done = () => { if (running === a) { running = null; room.style.overflow = 'hidden'; } };
  a.finished.then(done, done);
}
