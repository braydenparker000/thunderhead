// Finding the same music in two fingerprints (fingerprint.js), at whatever
// place it sits in each, and turning what is found into skip segments.
//
// For every shift of one fingerprint against the other, the items that meet
// are compared bit by bit. Unrelated sound differs in about half the bits;
// the same music in two encodes in about a tenth. A first pass looks at every
// fourth item and keeps the stretches whose 5 s average is clearly below a
// half; each is then checked item by item at its best shift, and its two ends
// are put where the bit errors step from low to high.

import {STEP} from './fingerprint.js';

const COARSE = 4;            // first pass: every fourth item
const SMOOTH = 10;           // first pass average: 10 samples, 5 s
const LOOSE = 0.36;          // first pass: an average below this is worth a look
const MATCH = 0.33;          // second pass: the level the ends are measured against
const EDGE = 24;             // 3 s either side when placing an end
const BUDGET = 20000;        // compares between yields

function bits(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}
/** Share of differing bits between two items; 0.5 when either is silent or missing. */
const err = (x, y) => (x && y ? bits(x ^ y) / 32 : 0.5);

/**
 * The work of matchRuns in small steps: a generator that yields every few
 * thousand compares (a few ms on a slow phone) and returns the runs. A caller
 * that must not block runs it a slice at a time; matchRuns runs it whole.
 */
export function* matchSteps(a, b, {minSeconds = 20, maxSeconds = 240} = {}) {
  const minItems = Math.round(minSeconds / STEP), found = [];
  let work = 0;
  for (const sa of a?.spans || []) for (const sb of b?.spans || []) {
    const A = sa.hashes, B = sb.hashes;
    if (A.length < minItems || B.length < minItems) continue;
    // d: index in B minus index in A; both indexes within their arrays.
    for (let d = -(A.length - minItems); d <= B.length - minItems; d++) {
      const i0 = Math.max(0, -d), i1 = Math.min(A.length, B.length - d);
      const n = Math.floor((i1 - i0) / COARSE);
      let sum = 0, runFrom = -1;
      const e = new Float32Array(n);
      for (let j = 0; j < n; j++) {
        const i = i0 + j * COARSE;
        e[j] = err(A[i], B[i + d]); sum += e[j];
        if (j >= SMOOTH) sum -= e[j - SMOOTH];
        const low = j >= SMOOTH - 1 && sum / SMOOTH < LOOSE;
        if (low && runFrom < 0) runFrom = j - SMOOTH + 1;
        if ((!low || j === n - 1) && runFrom >= 0) {
          const to = low ? j + 1 : j;
          if ((to - runFrom) * COARSE >= minItems * 0.6) found.push({sa, sb, d, from: i0 + runFrom * COARSE, to: i0 + to * COARSE});
          runFrom = -1;
        }
      }
      if ((work += n) > BUDGET) { work = 0; yield; }
    }
  }
  const runs = [];
  for (const c of found) {
    const r = refine(c);
    work += (c.to - c.from) * 6;
    if (r && r.end - r.start >= minItems && r.end - r.start <= maxSeconds / STEP) runs.push(r);
    if (work > BUDGET) { work = 0; yield; }
  }
  // One stretch of music shows at neighbouring shifts too: keep the best of those.
  runs.sort((x, y) => y.weight - x.weight);
  const kept = [];
  for (const r of runs) if (!kept.some(k => overlaps(k, r))) kept.push(r);
  return kept.map(r => ({
    aStart: r.sa.start * STEP + r.start * STEP, aEnd: r.sa.start * STEP + r.end * STEP,
    bStart: (r.sb.start + r.d) * STEP + r.start * STEP, bEnd: (r.sb.start + r.d) * STEP + r.end * STEP,
    score: Math.round(r.score * 1000) / 1000,
  })).sort((x, y) => (y.aEnd - y.aStart) - (x.aEnd - x.aStart));
}

/** Long common runs between fingerprints a and b, longest first: [{aStart, aEnd, bStart, bEnd, score}] in seconds. */
export function matchRuns(a, b, opts) {
  const it = matchSteps(a, b, opts);
  for (;;) { const s = it.next(); if (s.done) return s.value; }
}

const overlaps = (x, y) => x.sa === y.sa && x.sb === y.sb && share(x.start, x.end, y.start, y.end) && share(x.start + x.d, x.end + x.d, y.start + y.d, y.end + y.d);
const share = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) > 0.5 * Math.min(a1 - a0, b1 - b0);

/** Checks a first-pass stretch item by item: the best shift nearby, then each end placed to the step. */
function refine({sa, sb, d, from, to}) {
  const A = sa.hashes, B = sb.hashes;
  const at = (dd, i) => (i >= 0 && i < A.length && i + dd >= 0 && i + dd < B.length ? err(A[i], B[i + dd]) : 0.5);
  let best = null;
  for (let dd = d - 2; dd <= d + 2; dd++) {
    let s = 0;
    for (let i = from; i < to; i++) s += at(dd, i);
    if (!best || s < best.s) best = {dd, s};
  }
  const dd = best.dd, lo = from - 2 * SMOOTH * COARSE, hi = to + 2 * SMOOTH * COARSE;
  // An end goes where errors are low on one side and high on the other, over 3 s each way.
  const edge = (around, startEdge) => {
    let pick = around, top = -Infinity;
    for (let x = Math.max(lo, around - 6 * EDGE); x <= Math.min(hi, around + 6 * EDGE); x++) {
      let s = 0;
      for (let i = x - EDGE; i < x; i++) s += startEdge ? at(dd, i) - MATCH : MATCH - at(dd, i);
      for (let i = x; i < x + EDGE; i++) s += startEdge ? MATCH - at(dd, i) : at(dd, i) - MATCH;
      if (s > top) { top = s; pick = x; }
    }
    return pick;
  };
  let start = Math.max(0, -dd, edge(from, true)), end = Math.min(A.length, B.length - dd, edge(to, false));
  if (end <= start) return null;
  let s = 0;
  for (let i = start; i < end; i++) s += at(dd, i);
  const mean = s / (end - start);
  if (mean >= MATCH) return null;
  const score = 1 - 2 * mean;
  return {sa, sb, d: dd, start, end, score, weight: (end - start) * score};
}

const tenth = x => Math.round(x * 10) / 10;

/**
 * Segments for the second episode (b) from runs: one in the first 35 % is
 * the intro, one in the last 25 % the outro (the longest of each). Runs under
 * minSeconds or over 4 minutes are not an opening. Times to 0.1 s.
 */
export function segmentsFrom(runs, {duration, minSeconds = 20, maxSeconds = 240} = {}) {
  const known = duration > 0 && Number.isFinite(duration);
  let intro = null, outro = null;
  for (const r of runs || []) {
    const len = r.bEnd - r.bStart;
    if (!(len >= minSeconds && len <= maxSeconds)) continue;
    if (known ? r.bStart < duration * 0.35 : r.bStart < 600) { if (!intro || len > intro.bEnd - intro.bStart) intro = r; }
    else if (known && r.bEnd > duration * 0.75) { if (!outro || len > outro.bEnd - outro.bStart) outro = r; }
  }
  const out = [];
  if (intro) out.push({type: 'intro', start: tenth(intro.bStart), end: tenth(intro.bEnd)});
  if (outro) out.push({type: 'outro', start: tenth(outro.bStart), end: tenth(Math.min(outro.bEnd, duration))});
  return out;
}
