// @ts-check
// The graphics chip reset under the photo (the phone took it back, its driver fell over, or it ran out of memory). The
// edit is kept and the photo opened again, with nothing left off (the owner, 2026-11-17: "It should never ever ever
// stay off"): what was being made when it reset is blamed and goes gentler on this phone, and work that can wait
// waits a while (engine/gentle.js). A reset that comes within that while of the one before (so with only what the
// photo cannot do without running) has the photo opened again only once a whole while has gone by since it: Chrome
// shuts a page out of the GPU after two of its crashes within two minutes.
// A photo is opened again on its own a few times in a page's life at most (2026-11-16: a photo opened over and over);
// past that it is said, and opening it again is the owner's. Each reset is in the timings (`lost`): what it blamed,
// how long after the photo opened, the GPU memory held, and whether and when the photo was opened again.
import { allMaking } from '../../engine/work.js';
import { blame, calmIn, jobOf } from '../../engine/gentle.js';
import { memory } from '../../engine/gpu-memory.js';
import { note } from './timings.js';

const MOST = 3, MB = 1 << 20;   // a photo opened again on its own at most this often in a page's life
const HEAVY = ['copy', 'prep', 'starfish', 'detail'];   // all that was running is blamed; the timings name the heaviest
const again = /** @type {Map<string, number>} */ (new Map());

/** A reset under the open photo `id`, opened at `began` (performance.now()): `keep` saves its edit, `open` opens it
 * again, `say` tells the owner, `still` whether it is still the photo open.
 * @param {{ id: string, began: number, keep: () => Promise<unknown>, open: () => void, say: (s: string) => void, still: () => boolean }} o */
export function reset(o) {
  const soon = calmIn() > 0, jobs = allMaking().map(jobOf).filter((j) => j !== 'none').sort((a, b) => HEAVY.indexOf(a) - HEAVY.indexOf(b));   // soon: within the while after the reset before, when only what the photo cannot do without was running
  let level = 0; for (const j of jobs.length ? jobs : ['none']) level = Math.max(level, blame(j));
  const wait = soon ? calmIn() : 0;   // then the photo opens again once a whole while has gone by since this one
  const n = again.get(o.id) || 0, more = n < MOST;
  note('lost', 0, { job: jobs[0] || 'none', since: Math.round(performance.now() - o.began), mb: Math.round(memory.lost / MB), peakMb: Math.round(memory.peak / MB), budgetMb: Math.round(memory.budget / MB), level, again: more ? 1 : 0, calm: Math.round(wait) });
  o.keep().catch(() => {}).finally(() => {
    if (!more) { if (o.still()) o.say('The graphics chip keeps resetting on this photo, so it was left as it is. Open it again to try once more; your edit is kept.'); return; }
    again.set(o.id, n + 1);
    if (!wait) { o.open(); return; }
    if (o.still()) o.say(`The graphics chip reset again, so the photo opens again in ${Math.ceil(wait / 1000)} s, more gently. Your edit is kept.`);
    setTimeout(() => { if (o.still()) o.open(); }, wait);
  });
}
