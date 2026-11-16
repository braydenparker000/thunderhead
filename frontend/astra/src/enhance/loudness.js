// Even loudness, the pure parts: measuring a film's programme loudness the
// way EBU R 128 / ITU-R BS.1770-4 does, and the law that moves a gain towards
// a target from that measure (leveller.js puts both into the sound chain).
//
// BS.1770 in short: each channel goes through K-weighting (a high shelf of
// about +4 dB above 1.5 kHz, as the head does, then a high-pass at 38 Hz);
// mean squares are taken over 400 ms blocks every 100 ms, summed over the
// channels with their weights (surrounds 1.41, the bass channel left out);
// a block's loudness is -0.691 + 10 log10 of that. The programme loudness is
// the mean of the blocks above -70 LUFS (the absolute gate) and then of those
// within 10 LU of that first mean (the relative gate), so silence and quiet
// passages do not pull it down.

/** The level every film is brought to, in LUFS: -18 sits between broadcast (-23) and loud streaming (-14). */
export const TARGET = -18;
/** The most the gain may lift or cut, in dB. */
export const RANGE = 12;
/** Measured seconds after which the gain moves slowly (and a film's gain is worth remembering). */
export const SETTLED = 10;
/** dB a second the gain may move: fast while the measure is young, then at most 1 dB per 2 s. */
export const FAST = 3, SLOW = 0.5;
/** Measured seconds before the gain moves at all: 2 from a guess, 10 from a film's remembered gain. */
export const HOLD = 2;
/** The start for a film never measured, with no other film to go by: mastering near -23 LUFS is common. */
export const GUESS = 5;
/** Films whose settled gain is remembered. */
export const REMEMBERED = 200;

const ABSOLUTE = -70, RELATIVE = -10, BIN = 0.1, BINS = 800; // the histogram covers -70 to +10 LUFS in 0.1 LU steps

/**
 * K-weighting's two biquads for a sample rate, as [b0, b1, b2, a1, a2] for the
 * shelf then the high-pass (a0 = 1). From the analogue design BS.1770 is
 * based on (as in libebur128), so it is exact at 48 kHz and right at any rate.
 */
export function kWeighting(rate) {
  let K = Math.tan(Math.PI * 1681.974450955533 / rate), Q = 0.7071752369554196;
  const Vh = 10 ** (3.999843853973347 / 20), Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  K = Math.tan(Math.PI * 38.13547087602444 / rate); Q = 0.5003270373238773; a0 = 1 + K / Q + K * K;
  const high = [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  return [...shelf, ...high];
}

/**
 * Each channel's weight in the usual order (L R C LFE …, as stereoMatrix):
 * fronts 1, side and rear-side surrounds 1.41, back channels 1, the bass channel 0.
 */
export function channelWeights(n) {
  const S = 1.41;
  switch (n) {
    case 4: return [1, 1, S, S];
    case 5: return [1, 1, 1, S, S];
    case 6: return [1, 1, 1, 0, S, S];
    case 7: return [1, 1, 1, 0, 1, S, S];
    case 8: return [1, 1, 1, 0, 1, 1, S, S];
    default: return Array(Math.max(0, n)).fill(1);
  }
}

/**
 * K-weights the samples `x` through `k` (kWeighting) with the channel's filter
 * state `s` (4 numbers, kept between calls) and returns the sum of squares.
 * Self-contained: the meter's AudioWorklet runs this same function's source.
 */
export function kSquares(x, k, s) {
  let s0 = s[0], s1 = s[1], s2 = s[2], s3 = s[3], sum = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = k[0] * v + s0; s0 = k[1] * v - k[3] * y + s1; s1 = k[2] * v - k[4] * y;
    const z = k[5] * y + s2; s2 = k[6] * y - k[8] * z + s3; s3 = k[7] * y - k[9] * z;
    sum += z * z;
  }
  s[0] = s0; s[1] = s1; s[2] = s2; s[3] = s3;
  return sum;
}

/** Loudness in LUFS of a weighted mean square. */
export const lufs = z => -0.691 + 10 * Math.log10(z);

/**
 * The programme loudness from 100 ms steps (weighted mean squares): each step
 * closes a 400 ms block of the last four. The blocks are kept as a histogram
 * (count and energy per 0.1 LU), so hours of film take the same memory.
 */
export class Gate {
  constructor() { this.count = new Uint32Array(BINS); this.energy = new Float64Array(BINS); this.steps = []; this.blocks = 0; }

  /** Adds one 100 ms step's weighted mean square; returns true when it closed a block above the absolute gate. */
  step(z) {
    this.steps.push(z);
    if (this.steps.length > 4) this.steps.shift();
    if (this.steps.length < 4) return false;
    return this.block((this.steps[0] + this.steps[1] + this.steps[2] + this.steps[3]) / 4);
  }

  /** Adds one 400 ms block's weighted mean square. */
  block(z) {
    const l = lufs(z);
    if (!(l > ABSOLUTE)) return false;
    const i = Math.min(BINS - 1, Math.floor((l - ABSOLUTE) / BIN));
    this.count[i]++; this.energy[i] += z; this.blocks++;
    return true;
  }

  /** Seconds of sound measured: one block above the absolute gate per 100 ms. */
  get seconds() { return this.blocks / 10; }

  /** The gated programme loudness in LUFS, or null before the first block. */
  get integrated() {
    if (!this.blocks) return null;
    let n = 0, e = 0;
    for (let i = 0; i < BINS; i++) { n += this.count[i]; e += this.energy[i]; }
    const gate = lufs(e / n) + RELATIVE;
    n = 0; e = 0;
    for (let i = 0; i < BINS; i++) if (ABSOLUTE + (i + 0.5) * BIN > gate) { n += this.count[i]; e += this.energy[i]; }
    return n ? lufs(e / n) : null;
  }

  reset() { this.count.fill(0); this.energy.fill(0); this.steps = []; this.blocks = 0; }
}

/** The gain in dB that brings a film measured at `loudness` LUFS to the target, within the range. */
export const wantedGain = loudness => Math.max(-RANGE, Math.min(RANGE, TARGET - loudness));

/**
 * One step of the gain law: from `gain` towards `wanted` (both dB), after
 * `seconds` of measured sound, over `dt` seconds. `known`: the start was this
 * film's remembered gain, so it moves only slowly and only once the measure
 * has settled. Never faster than FAST, and SLOW once the measure is settled.
 */
export function nextGain(gain, wanted, seconds, dt, known = false) {
  if (seconds < (known ? SETTLED : HOLD)) return gain;
  const most = (known || seconds >= SETTLED ? SLOW : FAST) * dt, d = wanted - gain;
  return Math.abs(d) <= most ? wanted : gain + Math.sign(d) * most;
}

/** The remembered gains, cleaned: title id → dB, finite and in range, the most recent last, at most REMEMBERED. */
export function cleanLevels(levels) {
  if (!levels || typeof levels !== 'object' || Array.isArray(levels)) return {};
  const ok = Object.entries(levels).filter(([k, v]) => k && typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= RANGE);
  return Object.fromEntries(ok.slice(-REMEMBERED));
}

/** The levels with `id`'s settled gain put last (the most recent), rounded to 0.1 dB; the oldest go past REMEMBERED. */
export function remember(levels, id, db) {
  const out = cleanLevels(levels);
  if (!id || !Number.isFinite(db)) return out;
  delete out[id];
  out[id] = Math.round(Math.max(-RANGE, Math.min(RANGE, db)) * 10) / 10;
  return cleanLevels(out);
}

/** Where a film's gain starts: its remembered gain, else the middle of the films remembered, else GUESS. */
export function startLevel(levels, id) {
  const all = cleanLevels(levels);
  if (id && id in all) return {db: all[id], known: true};
  const v = Object.values(all).sort((a, b) => a - b);
  return {db: v.length ? v[v.length >> 1] : GUESS, known: false};
}
