// A sound fingerprint for finding a series' opening and ending: the same music
// in two episodes gives the same run of numbers, at whatever place it sits.
// Pure functions, no DOM; matching is in fingerprint-match.js.
//
// The sound is mixed to mono, low-passed and resampled to 11025 Hz, then cut
// into 2048-sample frames (0.19 s) centred every STEP (0.125 s) of media time.
// Each frame keeps its pitch-class energy (chroma, 80-3500 Hz) and nine bands
// (300-3400 Hz). Each step's 32-bit item compares those numbers with each
// other and with the same numbers half a second earlier, never with a fixed
// level, so loudness does not matter; and it only looks below 3.5 kHz, where
// AAC, Opus and AC-3 at any usual bitrate keep the music, so two encodes of
// one song give nearly the same bits (about 1 in 10 differ, against 1 in 2
// for unrelated sound). Silent steps are 0 and match nothing.

export const STEP = 0.125;            // seconds of media time per item
export const RATE = 11025;            // the rate everything is resampled to
const N = 2048, HALF = N / 2;         // frame length
const NC = 12, NB = 9, NF = NC + NB + 1;   // chroma, bands, loudness per frame
const SILENT = 3e-4;                  // frame RMS below about -70 dBFS
const GAP = 0.02;                     // a chunk this far from where the last ended starts a new run

// Fixed tables: window, FFT twiddles and bit reversal, and which FFT bin feeds
// which chroma class and which band.
// The frame's real FFT is done as a complex FFT of half the length (M points).
const M = HALF, WIN = new Float64Array(N), COS = new Float64Array(M), SIN = new Float64Array(M), REV = new Uint16Array(M);
const BIN_CLASS = new Int8Array(HALF).fill(-1), BIN_BAND = new Int8Array(HALF).fill(-1);
for (let i = 0; i < N; i++) WIN[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
for (let i = 0; i < M; i++) { COS[i] = Math.cos(2 * Math.PI * i / N); SIN[i] = -Math.sin(2 * Math.PI * i / N); }
for (let i = 0, bits = Math.log2(M); i < M; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); REV[i] = r; }
for (let k = 1; k < HALF; k++) {
  const f = k * RATE / N;
  if (f >= 80 && f <= 3500) BIN_CLASS[k] = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12) % 12;
  const band = Math.floor(Math.log(f / 300) / Math.log(3400 / 300) * NB);
  if (band >= 0 && band < NB) BIN_BAND[k] = band;
}

/** Lowpass biquad coefficients (RBJ, Butterworth Q) for cutoff fc at rate sr. */
function lowpass(fc, sr) {
  const w = 2 * Math.PI * fc / sr, alpha = Math.sin(w) / (2 * Math.SQRT1_2), c = Math.cos(w), a0 = 1 + alpha;
  return [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, -2 * c / a0, (1 - alpha) / a0];
}

/** One frame's features from 2048 samples at 11025 Hz: chroma, bands, RMS. */
function frameFeatures(x, at, re, im) {
  // Even samples as real parts, odd as imaginary; an M-point FFT; then split.
  let sq = 0;
  for (let i = 0; i < M; i++) {
    const v0 = x[at + 2 * i], v1 = x[at + 2 * i + 1], j = REV[i];
    sq += v0 * v0 + v1 * v1; re[j] = v0 * WIN[2 * i]; im[j] = v1 * WIN[2 * i + 1];
  }
  for (let size = 2; size <= M; size <<= 1) {
    const half = size >> 1, stride = 2 * M / size;
    for (let s = 0; s < M; s += size) for (let k = 0; k < half; k++) {
      const a = s + k, b = a + half, c = COS[k * stride], d = SIN[k * stride];
      const tr = re[b] * c - im[b] * d, ti = re[b] * d + im[b] * c;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
  const out = new Float32Array(NF);
  for (let k = 1; k < HALF; k++) {
    // X[k] = E[k] + W^k O[k], with E and O read back from Z[k] and Z[M-k].
    const zr = re[k], zi = im[k], wr = re[M - k], wi = -im[M - k];
    const er = (zr + wr) / 2, ei = (zi + wi) / 2, or = (zi - wi) / 2, oi = (wr - zr) / 2;
    const xr = er + or * COS[k] - oi * SIN[k], xi = ei + or * SIN[k] + oi * COS[k];
    const p = xr * xr + xi * xi;
    if (BIN_CLASS[k] >= 0) out[BIN_CLASS[k]] += p;
    if (BIN_BAND[k] >= 0) out[NC + BIN_BAND[k]] += p;
  }
  out[NF - 1] = Math.sqrt(sq / N);
  return out;
}

/** The 32-bit item for a step from its frames k-3..k+1 (an array of five); 0 when silent. */
export function hashFrames(f) {
  const now = new Float64Array(NF), before = new Float64Array(NF);
  for (let j = 0; j < NF; j++) { now[j] = f[2][j] + f[3][j] + f[4][j]; before[j] = f[0][j] + f[1][j] + f[2][j]; }
  if (now[NF - 1] < 3 * SILENT) return 0;
  let sn = 1e-20, sb = 1e-20;
  for (let i = 0; i < NC; i++) { sn += now[i]; sb += before[i]; }
  let h = 0;
  for (let i = 0; i < NC; i++) {
    const n = now[i] / sn, b = before[i] / sb, i1 = (i + 1) % NC;
    if (now[i] > now[i1]) h |= 1 << i;                                      // which neighbour class is stronger
    if (n - now[i1] / sn > b - before[i1] / sb) h |= 1 << (NC + i);         // and how that changed
  }
  for (let m = 0; m < NB - 1; m++) {                                        // band slope change (Haitsma-Kalker)
    const ln = Math.log(now[NC + m] + 1e-9) - Math.log(now[NC + m + 1] + 1e-9);
    const lb = Math.log(before[NC + m] + 1e-9) - Math.log(before[NC + m + 1] + 1e-9);
    if (ln > lb) h |= 1 << (2 * NC + m);
  }
  return (h >>> 0) || 1;
}

/**
 * Turns PCM into fingerprint items. Feed chunks of any size, any rate, any
 * channel count, each with the media time of its first sample; chunks may
 * skip ahead or come back (a seek): each continuous run is resampled on its
 * own, and frames already worked out are not worked out again.
 */
export class Fingerprinter {
  constructor() {
    this.frames = [];          // frame index -> features (a sparse array: no sorting to walk it)
    this.items = [];           // step index -> item, worked out once (frames never change)
    this.lo = Infinity; this.hi = -Infinity;
    this.run = null;
    this.re = new Float64Array(N); this.im = new Float64Array(N);
  }

  /** channels: Float32Array per channel; sampleRate 8000-96000; mediaTime of the first sample in seconds. */
  feed(channels, sampleRate, mediaTime) {
    const n = channels?.[0]?.length || 0;
    if (!n || !(sampleRate >= 8000 && sampleRate <= 192000) || !(mediaTime >= 0)) return;
    let r = this.run;
    if (!r || r.sr !== sampleRate || Math.abs(r.t0 + r.srcN / sampleRate - mediaTime) > GAP) r = this.run = this.newRun(sampleRate, mediaTime);
    // Mix to mono, then low-pass with two biquads in one pass (4th order) before resampling.
    if (!(this.mono?.length >= n)) this.mono = new Float32Array(n);
    const f = this.mono.subarray(0, n).fill(0), nc = channels.length, gain = 1 / nc;
    for (let c = 0; c < nc; c++) { const ch = channels[c]; for (let i = 0; i < n; i++) f[i] += ch[i] * gain; }
    if (r.lp) {
      const [b0, b1, b2, a1, a2] = r.lp.c, z = r.lp.z;
      let x1 = z[0], x2 = z[1], y1 = z[2], y2 = z[3], u1 = z[4], u2 = z[5];
      for (let i = 0; i < n; i++) {
        const x = f[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2, u = b0 * y + b1 * y1 + b2 * y2 - a1 * u1 - a2 * u2;
        x2 = x1; x1 = x; y2 = y1; y1 = y; u2 = u1; u1 = u; f[i] = u;
      }
      z[0] = x1; z[1] = x2; z[2] = y1; z[3] = y2; z[4] = u1; z[5] = u2;
    }
    // Linear interpolation to 11025 Hz, carrying the last sample across chunks.
    const ratio = r.sr / RATE, end = r.srcN + n - 1;
    const room = Math.max(0, Math.floor(end / ratio) - r.outN + 1);
    if (r.len + room > r.buf.length) { const nb = new Float32Array(Math.max(r.buf.length * 2, r.len + room)); nb.set(r.buf.subarray(0, r.len)); r.buf = nb; }
    for (let x = r.outN * ratio; x < end; x = ++r.outN * ratio) {
      const i0 = Math.floor(x), v0 = i0 < r.srcN ? r.prev : f[i0 - r.srcN], v1 = f[i0 + 1 - r.srcN];
      r.buf[r.len++] = v0 + (v1 - v0) * (x - i0);
    }
    r.prev = f[n - 1]; r.srcN += n;
    this.frameOut(r);
  }

  newRun(sr, t0) {
    const lp = sr > RATE * 1.1 ? {c: lowpass(4000, sr), z: new Float64Array(6)} : null;
    // buf holds the resampled sound from output sample `base` of the run on.
    return {sr, t0, srcN: 0, outN: 0, prev: 0, lp, buf: new Float32Array(RATE * 4), len: 0, base: 0, next: Math.ceil((t0 + HALF / RATE) / STEP)};
  }

  /** Works out every frame the run now holds whole, then drops samples no frame needs. */
  frameOut(r) {
    for (;;) {
      const k = r.next, s = Math.round((k * STEP - r.t0) * RATE) - HALF - r.base;
      if (s + N > r.len) break;
      if (s >= 0 && !this.frames[k]) { this.frames[k] = frameFeatures(r.buf, s, this.re, this.im); this.lo = Math.min(this.lo, k); this.hi = Math.max(this.hi, k); }
      r.next++;
    }
    const keep = Math.round((r.next * STEP - r.t0) * RATE) - HALF - r.base;
    if (keep > RATE) { r.buf.copyWithin(0, keep, r.len); r.len -= keep; r.base += keep; }
  }

  /** Seconds of media covered, as [{start, end}] runs of items. */
  covered() { return spansToTimes(this.fingerprint()); }

  /** The fingerprint so far, optionally only items with times in [from, to): {step, spans: [{start, hashes}]}. */
  fingerprint({from = 0, to = Infinity} = {}) {
    const fr = this.frames, items = this.items, spans = [];
    let cur = null;
    for (let k = Math.max(this.lo, Math.ceil(from / STEP)), last = Math.min(this.hi, Math.ceil(to / STEP) - 1); k <= last; k++) {
      let h = items[k];
      if (h === undefined) {
        if (!(fr[k - 3] && fr[k - 2] && fr[k - 1] && fr[k] && fr[k + 1])) { cur = null; continue; }
        items[k] = h = hashFrames([fr[k - 3], fr[k - 2], fr[k - 1], fr[k], fr[k + 1]]);
      }
      if (!cur) spans.push(cur = {start: k, end: k});
      cur.end = k + 1;
    }
    return {step: STEP, spans: spans.map(s => ({start: s.start, hashes: Uint32Array.from(items.slice(s.start, s.end))}))};
  }
}

/** [{start, end}] in seconds for each span of a fingerprint. */
export function spansToTimes(fp) {
  return (fp?.spans || []).map(s => ({start: s.start * STEP, end: (s.start + s.hashes.length) * STEP}));
}

/** Only the items of a fingerprint with times in [from, to). */
export function sliceFingerprint(fp, from, to) {
  const spans = [];
  for (const s of fp?.spans || []) {
    const a = Math.max(s.start, Math.ceil(from / STEP)), b = Math.min(s.start + s.hashes.length, Math.ceil(to / STEP));
    if (b > a) spans.push({start: a, hashes: s.hashes.slice(a - s.start, b - s.start)});
  }
  return {step: STEP, spans};
}

/** What is kept of an episode: its first `head` and last `tail` seconds. */
export function keepEnds(fp, duration, head = 360, tail = 240) {
  const a = sliceFingerprint(fp, 0, head);
  if (!(duration > head)) return a;
  const b = sliceFingerprint(fp, Math.max(head, duration - tail), Infinity);
  return {step: STEP, spans: [...a.spans, ...b.spans]};
}

/** Both fingerprints in one; where they overlap, `b` wins. */
export function mergeFingerprints(a, b) {
  const all = new Map();
  for (const fp of [a, b]) for (const s of fp?.spans || []) s.hashes.forEach((h, i) => all.set(s.start + i, h));
  const spans = [];
  let cur = null;
  for (const k of [...all.keys()].sort((x, y) => x - y)) {
    if (!cur || cur.start + cur.list.length !== k) spans.push(cur = {start: k, list: []});
    cur.list.push(all.get(k));
  }
  return {step: STEP, spans: spans.map(s => ({start: s.start, hashes: Uint32Array.from(s.list)}))};
}

/** Spans less than `gap` seconds apart joined into one, the missing items 0 (unknown). */
export function joinGaps(fp, gap = 3) {
  const spans = [];
  for (const s of [...(fp?.spans || [])].sort((x, y) => x.start - y.start)) {
    const last = spans[spans.length - 1], lastEnd = last ? last.start + last.hashes.length : -Infinity;
    if (last && s.start - lastEnd <= gap / STEP && s.start >= lastEnd) {
      const joined = new Uint32Array(s.start + s.hashes.length - last.start);
      joined.set(last.hashes); joined.set(s.hashes, s.start - last.start);
      last.hashes = joined;
    } else spans.push({start: s.start, hashes: s.hashes});
  }
  return {step: STEP, spans};
}
