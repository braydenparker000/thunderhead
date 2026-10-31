// The tempo ladder (GUITAR.md §4.3; NEXT-BATCH.md part 9, the owner's yes): a loop climbs in small
// steps the owner earns. After each pass the owner marks it Clean or Not yet; two clean passes in a
// row step the speed up, two misses in a row step it down (never below where the climb started),
// and it stops at the target. That keeps practice at about 70–85 % clean, where it works best (a
// heuristic, not a law). Each section's best clean speed and each day's counts are kept with the
// song, so the next session starts near yesterday's ceiling and opens on the bars that went worst.
// Pure: the reader holds the state and plays the speeds.

/** Speeds are percentages of the score's tempo. */
export const LADDER = {
  /** Two clean passes in a row step up. */
  up: 2,
  /** Two misses in a row step down by this much. */
  misses: 2,
  drop: 8,
  /** A new day starts this far under the section's last ceiling. */
  below: 8,
};

/** A section of a song: its loop's first and last bar (indexes into the score's bars). */
export const sectionKey = (/** @type {number} */ a, /** @type {number} */ b) => `${a}-${b}`;

/** @typedef {{ on: boolean, start: number, step: number, target: number }} LadderPrefs */
/** @typedef {{ day: string, passes: number, clean: number, ceiling: number }} Day */
/** @typedef {Day & { best: number, last: Day | null }} Rec */
/** @typedef {{ speed: number, start: number, target: number, streak: number, misses: number,
 *   recent: boolean[], doubled: boolean, moved: 'up' | 'down' | null, slower: boolean }} Climb */

/** Where a section's climb starts: the owner's start, or a little under its last ceiling when that
 * is higher; never over the target. @param {LadderPrefs} prefs @param {Rec | null | undefined} rec
 * @returns {Climb} */
export function climb(prefs, rec) {
  const ceiling = rec ? Math.max(rec.ceiling || 0, rec.last?.ceiling || 0) : 0;
  const speed = Math.min(prefs.target, Math.max(prefs.start, ceiling - LADDER.below));
  return { speed, start: speed, target: prefs.target, streak: 0, misses: 0, recent: [], doubled: false, moved: null, slower: false };
}

/** One pass marked. With 9 or more of the last 10 clean the next step is double, once; with 4 or
 * fewer, `slower` says the next climb should start lower. @param {Climb} c @param {boolean} clean
 * @param {number} step @returns {Climb} */
export function judge(c, clean, step) {
  const recent = [...c.recent, clean].slice(-10);
  const share = recent.filter(Boolean).length / recent.length;
  let { speed, streak, misses, doubled } = c;
  /** @type {Climb['moved']} */
  let moved = null;
  if (clean) {
    streak++;
    misses = 0;
    if (streak >= LADDER.up) {
      const twice = !doubled && recent.length >= 10 && share >= 0.95;
      const next = Math.min(c.target, speed + step * (twice ? 2 : 1));
      if (next > speed) {
        moved = 'up';
        doubled ||= twice;
      }
      speed = next;
      streak = 0;
    }
  } else {
    misses++;
    streak = 0;
    if (misses >= LADDER.misses) {
      const next = Math.max(c.start, speed - LADDER.drop);
      if (next < speed) moved = 'down';
      speed = next;
      misses = 0;
    }
  }
  return { ...c, speed, streak, misses, recent, doubled, moved, slower: recent.length >= 10 && share <= 0.4 };
}

/** The section's record after one marked pass at `speed` on `day`: today's counts and ceiling
 * (the fastest clean pass), the best clean speed ever, and the last day it was played before.
 * @param {Rec | null | undefined} rec @param {number} speed @param {boolean} clean @param {string} day
 * @returns {Rec} */
export function noted(rec, speed, clean, day) {
  const r =
    rec?.day === day
      ? { ...rec }
      : { day, passes: 0, clean: 0, ceiling: 0, best: rec?.best || 0, last: rec?.passes ? { day: rec.day, passes: rec.passes, clean: rec.clean, ceiling: rec.ceiling } : (rec?.last ?? null) };
  r.passes++;
  if (clean) {
    r.clean++;
    r.ceiling = Math.max(r.ceiling, speed);
    r.best = Math.max(r.best, speed);
  }
  return r;
}

/** The section that went worst on the last day it was played before `today` (at least 3 passes
 * marked): the lowest clean share, then the lowest ceiling. The next session opens on it.
 * @param {Readonly<Record<string, Rec>> | null | undefined} sections @param {string} today
 * @returns {{ key: string, passes: number, clean: number } | null} */
export function weakest(sections, today) {
  /** @type {{ key: string, passes: number, clean: number, ceiling: number, day: string } | null} */
  let worst = null;
  const days = Object.values(sections ?? {}).map((r) => (r.day < today ? r.day : (r.last?.day ?? ''))).filter(Boolean);
  const lastDay = days.sort().at(-1);
  if (!lastDay) return null;
  for (const [key, r] of Object.entries(sections ?? {})) {
    const d = r.day === lastDay ? r : r.last?.day === lastDay ? r.last : null;
    if (!d || d.passes < 3) continue;
    const share = d.clean / d.passes;
    const worse = !worst || share < worst.clean / worst.passes || (share === worst.clean / worst.passes && d.ceiling < worst.ceiling);
    if (worse) worst = { key, passes: d.passes, clean: d.clean, ceiling: d.ceiling, day: lastDay };
  }
  return worst && { key: worst.key, passes: worst.passes, clean: worst.clean };
}

/** A stored ladder record made safe (localStorage can hold anything). @param {unknown} v
 * @returns {Record<string, Rec>} */
export function cleanLadder(v) {
  /** @type {Record<string, Rec>} */
  const out = {};
  if (!v || typeof v !== 'object') return out;
  const n = (/** @type {unknown} */ x, max = 1e6) => Math.min(max, Math.max(0, Math.round(Number(x) || 0)));
  const day = (/** @type {any} */ d) =>
    d && typeof d === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(d.day) ? { day: d.day, passes: n(d.passes), clean: Math.min(n(d.clean), n(d.passes)), ceiling: n(d.ceiling, 150) } : null;
  for (const [key, r] of Object.entries(v).slice(-24)) {
    const d = /^\d{1,4}-\d{1,4}$/.test(key) ? day(r) : null;
    if (d) out[key] = { ...d, best: n(/** @type {any} */ (r).best, 150), last: day(/** @type {any} */ (r).last) };
  }
  return out;
}
