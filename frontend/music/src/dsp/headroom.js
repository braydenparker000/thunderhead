// Automatic headroom (MUSIC.md §5, "Clipping and headroom"): the gain the owner's equaliser, tone and
// preamp add at their loudest frequency, so the chain can take it off before the equaliser and the
// processed signal is not pushed over full scale by the settings. The peak is read from the cascade's
// combined magnitude response (the biquads that play, filters.js), per channel (a band may act on one),
// at DC and on a log grid of 1024 points from 1 Hz to just under Nyquist, refined around the grid's largest point
// and at every band's own frequency. A sine at any frequency comes out at most at its input level; other
// signals can still peak a little higher (a filter's time response): the output's safety net
// (limiter.js, on samples over full scale only) takes what still gets through. Pure; the tests run it directly.
import {coefficientsInto} from './filters.js';

// From 1 Hz, the lowest frequency a band can take (param-eq.js PARAM_FREQ_MIN), and at DC (shelves, low pass).
const GRID = 1024, F_MIN = 1;

/** dB of a cascade of biquads ([b0, b1, b2, a0, a1, a2] each) at f Hz. */
function cascadeDb(coefs, f, fs) {
  const w = 2 * Math.PI * f / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  let db = 0;
  for (const [b0, b1, b2, a0, a1, a2] of coefs) {
    const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2), dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
    db += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  return db;
}

/** The largest gain in dB (preamp included) the chain applies at any frequency; may be below 0. */
export function chainPeakDb(bands, preampDb = 0, fs = 48000) {
  const top = fs * 0.499, ratio = Math.pow(top / F_MIN, 1 / (GRID - 1));
  let best = -Infinity;
  for (const ch of [1, 2]) {
    // The bands on this channel (ch 0: both, 1: left, 2: right), as the engine computes them.
    const coefs = bands.filter(b => b.g && (!b.ch || b.ch === ch)).map(b => coefficientsInto(b.type, b.f, b.q, b.g, fs, new Array(6)));
    if (!coefs.length) { best = Math.max(best, 0); continue; }
    const at = f => cascadeDb(coefs, f, fs);
    let bestF = F_MIN, bestDb = -Infinity;
    const look = f => { const d = at(f); if (d > bestDb) { bestDb = d; bestF = f; } };
    look(0);
    for (let i = 0, f = F_MIN; i < GRID; i++, f *= ratio) look(Math.min(f, top));
    for (const b of bands) if (b.f > 0) look(Math.min(top, Math.max(F_MIN, b.f)));
    // Golden-section search on log frequency around the best point (one grid step either side).
    const around = Math.max(F_MIN, bestF);
    let lo = Math.log(Math.max(F_MIN, around / ratio)), hi = Math.log(Math.min(top, around * ratio));
    const g = (Math.sqrt(5) - 1) / 2;
    for (let k = 0; k < 40; k++) {
      const a = hi - g * (hi - lo), b = lo + g * (hi - lo);
      if (at(Math.exp(a)) > at(Math.exp(b))) hi = b; else lo = a;
    }
    look(Math.exp((lo + hi) / 2));
    best = Math.max(best, bestDb);
  }
  return best + preampDb;
}

/**
 * The most the stages after the equaliser can add, dB (MUSIC.md §5 "Clipping and headroom"); checked:
 * - the stereo matrix (Stereo X, mono, balance): its largest row sum |a| + |c|, up to 2 (+6 dB) for Stereo X
 *   at its widest on a signal in the side channel only; mono (0.5 + 0.5) and balance (each side ≤ 1) add none;
 * - the reverb's return: dry + its wet send times the impulse's gain on a broadband signal (`irGain`, the
 *   impulse's root-sum-square, from dsp.js), a typical figure, not a worst case;
 * - the master volume (≤ 1 lowers the need);
 * - the limiter (no makeup gain) and ReplayGain (before the equaliser; a song over full scale gets its trim,
 *   dsp/trim.js) add nothing here.
 * @param {{matrix: number[], dry: number, wet: number[], irGain: number, volume: number}} o
 */
export function laterGainDb({matrix, dry = 1, wet = [0, 0], irGain = 0, volume = 1}) {
  const width = Math.max(Math.abs(matrix[0]) + Math.abs(matrix[1]), Math.abs(matrix[2]) + Math.abs(matrix[3]));
  const reverb = dry + Math.max(...wet) * irGain;
  return 20 * Math.log10(Math.max(1e-6, width * reverb * volume));
}

/** The headroom to take off before the equaliser, dB (0 when the settings add no gain); laterDb: laterGainDb. */
export function headroomDb(bands, preampDb = 0, fs = 48000, laterDb = 0) {
  const p = chainPeakDb(bands, preampDb, fs) + laterDb;
  return p > 1e-6 ? p : 0;
}
