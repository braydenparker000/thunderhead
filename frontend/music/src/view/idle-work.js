// Work done in idle time after start (MUSIC.md §5.11 "Idle work"): the screens built ahead (prebuild.js),
// the library's category views (Library.warmGroups), the playing track's list (prepareTrackList), spare list
// rows (PowerList.prewarm). The fourth phone report had 63 long tasks in 198 s, several inside transitions.
// Every job here is a list of pieces, run one after another in idle callbacks:
// - none starts within QUIET_MS after an input event (a touch, a key, the wheel), nor while a transition
//   moves, a layout is pending or a list scrolls (a drag or a fling);
// - pieces run back to back only while SLICE_MS has not passed and the browser's idle period lasts; then
//   the job yields to the next idle callback, and it waits again once any of the above begins;
// - each piece runs under its job's name for the recorder (ui/long-work.js), so a long task it makes is
//   named in the report. A piece is the smallest unit of its work (a scene's layout, one category view):
//   one that takes longer than SLICE_MS on a slow phone is still one task (the report shows which).
import {isMoving} from './motion.js';
import {pieceRan} from '../ui/long-work.js';

export const QUIET_MS = 300, SLICE_MS = 8;

let lastInput = -Infinity;
const touched = () => { lastInput = performance.now(); };
for (const type of ['pointerdown', 'pointermove', 'touchstart', 'touchmove', 'keydown', 'wheel']) globalThis.addEventListener?.(type, touched, {capture: true, passive: true});

/** @type {{ctx: any, name: string, rank: number, pieces: (() => unknown)[], done: () => void}[]} */
const jobs = [];
let queued = false;

const idle = (fn, ms = 0) => {
  const ric = globalThis.requestIdleCallback;
  const go = () => (ric ? ric(fn, {timeout: 5000}) : fn({timeRemaining: () => SLICE_MS, didTimeout: false}));
  ms > 0 ? setTimeout(go, ms) : go();
};

/** A list scrolling now (a finger drag or a fling) in the library (or its leaving copy). */
function scrolling(ctx) {
  const lw = ctx?.listWidget;
  for (const l of [lw?.libList, lw?.ghost]) if (l?._fling || l?.drag?.started) return true;
  return false;
}

/** Whether idle work must wait now: an input in the last QUIET_MS, a transition, a pending layout, a scroll. */
export function busy(ctx, now = performance.now()) {
  return now - lastInput < QUIET_MS || isMoving(ctx) || !!ctx?._layoutPending || !!ctx?.topNav?.scenes?.running || !!ctx?.listWidget?.trans || !!ctx?.navbar?.container?.()?.scenes?.running || scrolling(ctx);
}

function pump(deadline) {
  queued = false;
  const t0 = performance.now();
  while (jobs.length) {
    const job = jobs[0];
    if (busy(job.ctx)) { schedule(QUIET_MS); return; }
    if (performance.now() - t0 >= SLICE_MS || (deadline && deadline.timeRemaining() <= 0 && !deadline.didTimeout)) { schedule(); return; }
    const piece = job.pieces.shift();
    if (piece) {
      const at = performance.now();
      try { piece(); } catch (e) { console.warn('[claude-player] idle work', job.name, e); }
      pieceRan(job.name, at, performance.now() - at);
    }
    if (!job.pieces.length) { jobs.shift(); job.done(); }
  }
}

function schedule(ms = 0) {
  if (queued) return;
  queued = true;
  idle(pump, ms);
}

/** Which jobs go first: the playing track's list (as before, ahead of the screens: the library's start
 * rows, built with the screens, then stay the list shown), the screens built ahead (the next transition
 * needs them), the category views, and the spare rows last; any other after them. */
const RANK = {'prepare-track-list': 0, prebuild: 1, groups: 2, 'spare-rows': 3};

/** Queues a job of pieces under name, behind the jobs that go before it; resolves when its last piece has run. */
export function idleWork(ctx, name, pieces) {
  return new Promise(done => {
    const rank = RANK[name] ?? 4, job = {ctx, name, rank, pieces: [...pieces], done};
    // (Between pieces a job may go ahead of one under way; each job's pieces keep their order.)
    const at = jobs.findIndex((j) => j.rank > rank);
    if (at < 0) jobs.push(job); else jobs.splice(at, 0, job);
    schedule();
  });
}

/** Marks an input now (tests; and a press the page handles before the capture listeners see it). */
export function noteInput(at = performance.now()) { lastInput = at; }
