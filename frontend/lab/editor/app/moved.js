// @ts-check
// How a pinch, a pan or a glide (and a turn of the dial) went on this phone, as numbers (timings.js keeps them): how long it lasted, how
// many frames were drawn, the longest gap between two of them, and how many gaps were over two frames' time. And
// whether the GPU was making a full-size view when it began, which is when a gesture has stuttered: that work is
// now given to the GPU a part at a time and left when a finger comes down (engine/net-pace.js, full.js `region`),
// and these numbers are how it is known whether that is enough on the real phone. Nothing of the photo is noted.
// And what ran in the worst gap (`ran`, AUDIT.md P.2): whatever can hold a frame up marks itself as it runs, with the
// browser's own performance marks (th:frame an engine frame, th:part a part of a full-size view, th:tile a tile of the
// still canvas, th:map the zoom's map, th:board a board drawn again, th:copy a tile of the editing copy made again),
// and `long` is a long task the browser saw (a script that held the page 50 ms or more).
import { note } from './timings.js';

const KINDS = ['frame', 'part', 'tile', 'map', 'board', 'copy'];
const clear = () => { for (const k of KINDS) performance.clearMarks(`th:${k}`); };
let longs = /** @type {number[][]} */ ([]);
try { new PerformanceObserver((l) => { for (const e of l.getEntries()) longs.push([e.startTime, e.startTime + e.duration]); if (longs.length > 50) longs = longs.slice(-25); }).observe({ type: 'longtask' }); } catch { /* a browser without it */ }
setInterval(() => { if (!run) clear(); }, 60_000);   // kept no longer than a gesture could want them
/** What ran between `a` and `b` (ms, the page's clock), each kind once; 'none' for nothing marked. @param {number} a @param {number} b */
const within = (a, b) => [...KINDS.filter((k) => performance.getEntriesByName(`th:${k}`, 'mark').some((m) => m.startTime >= a && m.startTime <= b)), ...(longs.some(([s, e]) => s < b && e > a) ? ['long'] : [])].join(' ') || 'none';

let run = 0, wasBusy = false;
/** A gesture has begun (or goes on): frames are watched until `active` says it is over. A finger that comes down
 * again while one is watched (a glide caught, a second finger) is part of the same. @param {() => boolean} active
 * fingers still move the photo, or it glides @param {boolean} busy the GPU was making a full-size view when a finger came down
 * @param {'move' | 'turn' | 'swipe' | 'tools'} [kind] `turn`: the dial is being turned (boards/DialPlate.js), `swipe`: the panel slid
 * between sections (boards/Barrel.js), `tools`: the tool dial is held (boards/ToolDial.js); what is watched is how the page kept up
 * @param {Record<string, number | string>} [more] noted with it, as it is when the gesture is over (a turn: how far the photo is zoomed
 * in, per cent; a swipe: the sections passed, the photo fitted again and its detail put away meanwhile, how it ended) */
export function moved(active, busy, kind = 'move', more = {}) {
  wasBusy ||= busy;
  if (run) return;
  clear();
  const began = performance.now();
  let last = began, frames = 0, worst = 0, slow = 0, idle = 0, wa = 0, wb = 0;
  const tick = () => {
    const now = performance.now(), gap = now - last; frames++;   // (by the page's own clock, which the marks keep: a frame's own time may not be on it)
    if (gap > worst) { worst = gap; wa = last; wb = now; }
    last = now;
    if (gap > 34) slow++;
    idle = active() ? 0 : idle + 1;
    if (idle < 3) { run = requestAnimationFrame(tick); return; }   // over once nothing has moved it for three frames
    run = 0;
    if (frames > 6) note(kind, now - began, { frames, worst: Math.round(worst), ran: within(wa, wb), slow, busy: wasBusy ? 1 : 0, ...more });   // (a tap is no gesture)
    wasBusy = false;
  };
  run = requestAnimationFrame(tick);
}
