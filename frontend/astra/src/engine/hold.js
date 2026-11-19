// How much of a film Astra holds at once: bytes first, seconds second, within the memory budget (budget.js). By time,
// the pipelines read 40 s past the playhead (remux.js; 20 with the data saver), the browser's buffer keeps 20 s behind
// it (mse.js) and the reader's cache keeps 80 s of the film (source-tuning.js), and a film of a few Mbit/s is held so.
// A fast film's seconds would pass the budget (a 25 Mbit/s film by time alone: 125 MB ahead in the browser's buffer and
// a page of about 600 MB, 2026-11-18), so the budget's `film` bytes are shared out, in this order while they last:
// - the cache gets what reading needs: the download's reach (at most HOLD.reach of the budget) and `trail` seconds
//   behind it, for the one of picture and sound read last (they were never more than 0.12 s apart, on a 25 and a
//   60 Mbit/s film, the page six times slower too; 4 s here before kept 30 MB of a 60 Mbit/s film);
// - the browser's buffer gets `minAhead` seconds ahead of the playhead and `minBehind` behind it, then behind up to
//   `skipBack` (the player's 10 s skip back and a key frame);
// - the cache keeps what the buffer holds ahead as well: a change of sound track reads the film again from a second
//   past the playhead, and without it read it again over the link (the first change to DTS on a 40 Mbit/s link came
//   0.8 s later, after a silence of 2.0 s instead of 1.2);
// - then more ahead (kept in both), more behind, and the cache's own seconds.
// With the roomy budget a 25 Mbit/s film keeps about 8 s ahead and 12 s behind, and a 60 Mbit/s one 6 s on each side;
// a film whose seconds fit is held as before. Measured: frontend/astra/README.md, Memory while a film plays.

export const HOLD = {reach: 0.15, minAhead: 6, minBehind: 2, skipBack: 12, trail: 1, leastReach: 2 << 20};

/**
 * What a film of `rate` bytes a second holds within `film` bytes: the download's `reach`, the most bytes `ahead` of the
 * playhead and `behind` it in the browser's buffer, and the reader's `cache`. `reach`: the reader's own (by time, at
 * most its byte limit); `keep`, `ahead` and `behind`: the seconds each would hold by time. Null while the rate is unknown.
 * In turn, while the budget lasts: what reading needs; the floors ahead and behind; behind up to a skip back; the cache
 * keeping what is ahead too (a change of sound track reads it again, from memory rather than the link); more ahead
 * (counted twice, kept in both); more behind; the cache's own seconds.
 */
export function holding({film, rate, reach, keep = 80, ahead = 40, behind = 20}) {
  if (!(rate > 0) || !(film > 0)) return null;
  const lead = Math.floor(Math.min(reach, Math.max(HOLD.leastReach, film * HOLD.reach)));
  const need = lead + HOLD.trail * rate, wantA = ahead * rate, wantB = behind * rate;
  let front = Math.min(wantA, HOLD.minAhead * rate), back = Math.min(wantB, HOLD.minBehind * rate);
  let left = film - need - front - back;
  const take = (most) => { const n = Math.max(0, Math.min(left, most)); left -= n; return n; };
  back += take(Math.min(wantB, HOLD.skipBack * rate) - back);
  let cover = take(front);
  if (cover >= front) { const more = take(2 * (wantA - front)) / 2; front += more; cover += more; }
  back += take(wantB - back);
  return {reach: lead, ahead: front, behind: back, cache: Math.min(keep * rate + lead, need + cover + Math.max(0, left))};
}

/** Seconds the pipelines read past the playhead: `seconds`, or as many as the reader's budget gives ahead (`held`). */
export const aheadSeconds = (seconds, source) => source?.held ? Math.min(seconds, source.held.ahead / source.byteRate) : seconds;

/** Seconds of played film the browser's buffer keeps: `seconds`, or as many as the budget gives behind. */
export const behindSeconds = (seconds, source) => source?.held ? Math.min(seconds, source.held.behind / source.byteRate) : seconds;
