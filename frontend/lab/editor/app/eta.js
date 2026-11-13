// @ts-check
// How long an export will take, from this phone's own past exports (timings.js keeps each one: its ms, the pixels
// of the files it saved, `net` 1 when the network made it), and how long is left while one runs. Plain arithmetic,
// nothing of the page: the Export board (boards/ExportPlate.js) says what it gives.

/** @typedef {{ kind?: string, ms?: number, px?: number, net?: number, fell?: number, again?: number, held?: number }} Timing */

/** How many of the last exports by a way the estimate is the median of. */
export const LAST = 5;

/** This phone's median ms a megapixel for the way asked (`net` true: by the network), from its last few finished
 * exports by that way; null when it has none. An export cut off (no time), or one that carried on from bands kept
 * before (its time is not the whole photo's), says nothing of either. @param {Timing[]} timings oldest first @param {boolean} net */
export function perMp(timings, net) {
  const rates = timings.filter((t) => t && t.kind === 'save' && Number(t.ms) > 0 && Number(t.px) > 0 && !t.fell && !t.again && !t.held && !!t.net === net)
    .slice(-LAST).map((t) => Number(t.ms) / (Number(t.px) / 1e6)).sort((a, b) => a - b);
  if (!rates.length) return null;
  const m = rates.length >> 1;
  return rates.length % 2 ? rates[m] : (rates[m - 1] + rates[m]) / 2;
}

/** The ms an export of `px` pixels (all its files together, as the timings count them) should take, or null where
 * this phone has not made one that way. @param {Timing[]} timings @param {boolean} net @param {number} px */
export function estimate(timings, net, px) {
  const r = perMp(timings, net);
  return r === null || !(px > 0) ? null : (r * px) / 1e6;
}

/** An estimate in words: "about 40 s", "about 2 min". @param {number} ms */
export function about(ms) {
  return ms < 55_000 ? `about ${Math.max(5, Math.round(ms / 5000) * 5)} s` : `about ${Math.round(ms / 60_000)} min`;
}

/** The time left in words: "45 s left", "1 min 20 s left", "12 min left". @param {number} ms */
export function left(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s < 3 ? 'almost done' : `${Math.ceil(s / 5) * 5} s left`;
  if (s >= 600) return `${Math.round(s / 60)} min left`;
  const t = Math.round(s / 10) * 10, m = Math.floor(t / 60), r = t % 60;
  return r ? `${m} min ${r} s left` : `${m} min left`;
}

/** The time left while an export runs, to show: from the rate measured so far (at first blended with `guess`, the
 * whole export's estimate, which carries the start until a quarter is done), changed at most once a second, halfway
 * towards each new reading, and never more than a fifth above what was shown. Returns a function of how far along
 * it is (0 to 1) and the ms spent so far that gives the ms left to show, or null while there is nothing to go by.
 * @param {number | null} [guess] */
export function countdown(guess = null) {
  let shown = /** @type {number | null} */ (null), at = 0;
  return (/** @type {number} */ done, /** @type {number} */ spent) => {
    if (shown !== null && spent - at < 1000) return shown;
    const measured = done > 0.005 ? (spent * (1 - done)) / done : null, planned = guess ? Math.max(0, guess - spent) : null;
    const w = Math.min(1, done / 0.25);
    const raw = measured === null ? planned : planned === null ? measured : w * measured + (1 - w) * planned;
    if (raw === null) return shown;
    let next = raw;
    if (shown !== null) {
      const due = Math.max(0, shown - (spent - at));   // where the last figure would be by now
      next = (raw + due) / 2;
      if (next > shown) next = Math.min(next, shown * 1.2);
    }
    shown = next; at = spent;
    return shown;
  };
}
