// @ts-check
// A zoomed photo's momentum (zoom.js, docs/design/EDITOR.md): a pan let go while the finger still moves glides on
// with the finger's speed and slows to rest. Past an edge of the photo it gives a little, like a rubber band, and
// comes back inside. Any new touch stops it at once. While it glides only the picture's transform changes, as while
// fingers move: nothing is drawn until it rests (zoom.js then makes the detail).

const GLIDE_MS = 325;   // how quickly a glide dies away: its speed falls to a third in this long
const EDGE_MS = 45;   // past an edge it dies far quicker
const BACK_MS = 80;   // and comes back inside about this quickly
const ROOM = 48;   // the most it gives past an edge, in the design's pixels
const FAST = 0.3;   // design pixels a millisecond: slower than this at the lift is no fling

/** A finger's last moves, as [time, x, y] (ms, design pixels). */
export const trail = /** @type {number[][]} */ ([]);
/** Notes where the finger is. @param {number} t @param {number} x @param {number} y */
export function heard(t, x, y) { trail.push([t, x, y]); while (trail.length > 2 && t - trail[0][0] > 80) trail.shift(); }
/** The finger's speed as it lifted at `now`, in design pixels a millisecond, or null if it had stopped or was slow.
 * The trail is emptied. @param {number} now */
export function speed(now) {
  const a = trail[0], b = trail.at(-1); trail.length = 0;
  if (!a || !b || b[0] - a[0] < 8 || now - b[0] > 60) return null;
  const v = [(b[1] - a[1]) / (b[0] - a[0]), (b[2] - a[2]) / (b[0] - a[0])];
  return Math.hypot(v[0], v[1]) > FAST ? v : null;
}

/** How far past an edge the photo shows for `over` pixels of momentum past it: a little, never more than ROOM. @param {number} over */
const give = (over) => Math.sign(over) * ROOM * (1 - Math.exp(-Math.abs(over) / ROOM));

let raf = 0, on = false;
/** Whether the photo glides now. */
export const gliding = () => on;
/** Stops a glide where it is (a new touch). Returns whether one was stopped. */
export function halt() { const was = on; cancelAnimationFrame(raf); raf = 0; on = false; return was; }

/** Glides from (x, y) at (vx, vy) pixels a millisecond. `inside(x, y)` is the nearest place the photo may rest;
 * `show(x, y)` puts the photo there for a frame; `rest(x, y)` hears where it came to rest.
 * @param {{ x: number, y: number, vx: number, vy: number, inside: (x: number, y: number) => number[], show: (x: number, y: number) => void, rest: (x: number, y: number) => void }} o */
export function fling(o) {
  halt();
  const p = [o.x, o.y], v = [o.vx, o.vy];
  let last = performance.now();
  on = true;
  const step = (/** @type {number} */ now) => {
    const dt = Math.max(0, Math.min(32, now - last)); last = now;
    let held = o.inside(p[0], p[1]);
    for (const i of [0, 1]) {
      if (v[i]) { p[i] += v[i] * dt; v[i] *= Math.exp(-dt / (p[i] === o.inside(p[0], p[1])[i] ? GLIDE_MS : EDGE_MS)); if (Math.abs(v[i]) < 0.02) v[i] = 0; }
      else p[i] += (held[i] - p[i]) * (1 - Math.exp(-dt / BACK_MS));   // still, and past the edge: back inside
    }
    held = o.inside(p[0], p[1]);
    for (const i of [0, 1]) if (!v[i] && Math.abs(p[i] - held[i]) < 0.4) p[i] = held[i];
    if (!v[0] && !v[1] && p[0] === held[0] && p[1] === held[1]) { on = false; raf = 0; o.show(p[0], p[1]); o.rest(p[0], p[1]); return; }
    o.show(held[0] + give(p[0] - held[0]), held[1] + give(p[1] - held[1]));
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
