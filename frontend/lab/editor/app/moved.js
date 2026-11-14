// @ts-check
// How a pinch, a pan or a glide went on this phone, as numbers (timings.js keeps them): how long it lasted, how
// many frames were drawn, the longest gap between two of them, and how many gaps were over two frames' time. And
// whether the GPU was making a full-size view when it began, which is when a gesture has stuttered: that work is
// now given to the GPU a part at a time and left when a finger comes down (engine/net-pace.js, full.js `region`),
// and these numbers are how it is known whether that is enough on the real phone. Nothing of the photo is noted.
import { note } from './timings.js';

let run = 0, wasBusy = false;
/** A gesture has begun (or goes on): frames are watched until `active` says it is over. A finger that comes down
 * again while one is watched (a glide caught, a second finger) is part of the same. @param {() => boolean} active
 * fingers still move the photo, or it glides @param {boolean} busy the GPU was making a full-size view when a finger came down */
export function moved(active, busy) {
  wasBusy ||= busy;
  if (run) return;
  const began = performance.now();
  let last = began, frames = 0, worst = 0, slow = 0, idle = 0;
  const tick = (/** @type {number} */ now) => {
    const gap = now - last; last = now; frames++;
    if (gap > worst) worst = gap;
    if (gap > 34) slow++;
    idle = active() ? 0 : idle + 1;
    if (idle < 3) { run = requestAnimationFrame(tick); return; }   // over once nothing has moved it for three frames
    run = 0;
    if (frames > 6) note('move', now - began, { frames, worst: Math.round(worst), slow, busy: wasBusy ? 1 : 0 });   // (a tap is no gesture)
    wasBusy = false;
  };
  run = requestAnimationFrame(tick);
}
