// Music's clean headroom (frontend/music/src/dsp/headroom.js, limiter.js; MUSIC.md §5 "Clipping and
// headroom"): the automatic headroom equals the peak of the equaliser's, tone's and preamp's combined
// magnitude response for several settings (checked against a dense sweep of the same biquads), is 0 when
// the settings add no gain, counts the stages after the equaliser, and the safety net acts only on samples
// over full scale (below them every sample passes exactly). No browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainPeakDb, headroomDb, laterGainDb } from '../frontend/music/src/dsp/headroom.js';
import { coefficientsInto, PEAKING, LOW_SHELF, HIGH_SHELF, LOW_PASS, BAND_PASS } from '../frontend/music/src/dsp/filters.js';
import { TruePeakLimiter } from '../frontend/music/src/dsp/limiter.js';

const FS = 48000;

/** The cascade's peak in dB by brute force: 200,000 linear points on each channel. */
function sweepPeakDb(bands, preDb) {
  let best = -Infinity;
  for (const ch of [1, 2]) {
    const coefs = bands.filter((b) => b.g && (!b.ch || b.ch === ch)).map((b) => coefficientsInto(b.type, b.f, b.q, b.g, FS, new Array(6)));
    for (let i = 1; i < 200_000; i++) {
      const f = (i / 200_000) * FS * 0.499, w = (2 * Math.PI * f) / FS;
      let db = 0;
      for (const [b0, b1, b2, a0, a1, a2] of coefs) {
        const nr = b0 + b1 * Math.cos(w) + b2 * Math.cos(2 * w), ni = -(b1 * Math.sin(w) + b2 * Math.sin(2 * w));
        const dr = a0 + a1 * Math.cos(w) + a2 * Math.cos(2 * w), di = -(a1 * Math.sin(w) + a2 * Math.sin(2 * w));
        db += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
      }
      best = Math.max(best, db);
    }
  }
  return best + preDb;
}

const SETTINGS = {
  'one 6 dB peak': { bands: [{ type: PEAKING, f: 1000, q: 1.4, g: 6 }], pre: 0 },
  'graphic EQ, bass and treble up, tone on': {
    bands: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((f, i) => ({ type: PEAKING, f, q: 1.41, g: [5, 4, 2, 0, -1, -2, 0, 2, 3, 4][i] }))
      .concat([{ type: LOW_SHELF, f: 90, q: 0.8, g: 6 }, { type: HIGH_SHELF, f: 10000, q: 0.6, g: 3 }]),
    pre: 0,
  },
  'overlapping narrow peaks and a preamp cut': { bands: [{ type: PEAKING, f: 3000, q: 8, g: 9 }, { type: PEAKING, f: 3150, q: 8, g: 9 }], pre: -4 },
  'parametric: resonant low pass boost, a left-only band pass': { bands: [{ type: LOW_PASS, f: 120, q: 4, g: 6 }, { type: BAND_PASS, f: 2500, q: 2, g: 7, ch: 1 }], pre: 1.5 },
};

test('the headroom is the peak of the combined response, for several settings', () => {
  for (const [name, { bands, pre }] of Object.entries(SETTINGS)) {
    const want = sweepPeakDb(bands, pre), got = chainPeakDb(bands, pre, FS);
    assert.ok(Math.abs(got - want) < 0.01, `${name}: ${got.toFixed(4)} dB, the sweep ${want.toFixed(4)} dB`);
    assert.equal(headroomDb(bands, pre, FS), Math.max(0, got));
  }
});

test('no headroom when the settings add no gain: flat, cuts only, or a preamp cut larger than the boost', () => {
  assert.equal(headroomDb([], 0, FS), 0);
  assert.equal(headroomDb([{ type: PEAKING, f: 1000, q: 1, g: -6 }, { type: LOW_SHELF, f: 90, q: 0.8, g: -3 }], 0, FS), 0);
  assert.equal(headroomDb([{ type: PEAKING, f: 1000, q: 1, g: 4 }], -6, FS), 0);
  assert.ok(Math.abs(headroomDb([], 3, FS) - 3) < 1e-9, 'a preamp boost alone is taken off whole');
});

/** A stereo sine through the limiter: what comes out (both channels the same) and its meters. */
function through(lim, amp, seconds = 0.5) {
  const n = Math.round(FS * seconds), x = new Float64Array(n), y = new Float64Array(n), yr = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * 997 * i) / FS + 0.3);
  for (let at = 0; at < n; at += 128) {
    const m = Math.min(128, n - at);
    lim.process(x.subarray(at, at + m), x.subarray(at, at + m), y.subarray(at, at + m), yr.subarray(at, at + m), m);
  }
  return { x, y, meter: lim.meter() };
}

test('the safety net: a −1 dBFS sine untouched sample for sample, a +3.4 dBFS one kept under full scale, nothing clamped', () => {
  const quiet = new TruePeakLimiter(FS);
  quiet.setNet(true);
  const q = through(quiet, Math.pow(10, -1 / 20));
  let worst = 0;
  for (let i = 0; i + quiet.delay < q.y.length; i++) worst = Math.max(worst, Math.abs(q.y[i + quiet.delay] - q.x[i]));
  assert.equal(worst, 0, 'a −1 dBFS sine passes bit for bit (only delayed)');
  assert.equal(q.meter.minGain, 1);
  const hot = new TruePeakLimiter(FS);
  hot.setNet(true);
  const h = through(hot, Math.pow(10, 3.4 / 20));
  assert.equal(h.meter.clamps, 0, 'no sample clipped');
  assert.ok(h.meter.outPeak <= 1, `out peak ${(20 * Math.log10(h.meter.outPeak)).toFixed(4)} dBFS`);
});

/** Full-band noise peaking at exactly `peakDb` dBFS (a sample at that level, many near it), seeded. */
function noise(n, peakDb, seed = 7) {
  const x = new Float64Array(n);
  let s = seed, m = 0;
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) % 2147483648; x[i] = s / 1073741824 - 1; m = Math.max(m, Math.abs(x[i])); }
  const g = Math.pow(10, peakDb / 20) / m;
  for (let i = 0; i < n; i++) x[i] *= g;
  return x;
}

/** x through a limiter in 128-frame blocks; returns the output (left) and the meters. */
function pass(lim, x) {
  const n = x.length, y = new Float64Array(n), yr = new Float64Array(n);
  for (let at = 0; at < n; at += 128) { const m = Math.min(128, n - at); lim.process(x.subarray(at, at + m), x.subarray(at, at + m), y.subarray(at, at + m), yr.subarray(at, at + m), m); }
  return { y, meter: lim.meter() };
}

test('the safety net is transparent: a −0.1 dBFS master passes sample for sample; a +3 dB over is held at full scale with no clamp', () => {
  const net = new TruePeakLimiter(FS);
  net.setNet(true);
  const x = noise(FS, -0.1), { y, meter } = pass(net, x);
  let worst = 0;
  for (let i = 0; i + net.delay < x.length; i++) worst = Math.max(worst, Math.abs(y[i + net.delay] - x[i]));
  assert.equal(worst, 0, 'bit for bit, only delayed');
  assert.equal(meter.minGain, 1, 'no gain change at all');
  // After an over has passed, it is exact again.
  const hot = new TruePeakLimiter(FS);
  hot.setNet(true);
  const z = noise(FS, 3), after = noise(FS, -0.1, 11), both = new Float64Array(2 * FS);
  both.set(z); both.set(after, FS);
  const r = pass(hot, both);
  assert.equal(r.meter.clamps, 0, 'no hard clamp');
  assert.ok(r.meter.outPeak <= 1 && r.meter.outPeak > 0.999, `held at full scale (${r.meter.outPeak})`);
  let tail = 0;
  for (let i = FS + FS / 2; i + hot.delay < 2 * FS; i++) tail = Math.max(tail, Math.abs(r.y[i + hot.delay] - both[i]));
  assert.equal(tail, 0, 'exact again once the over has passed');
});

test('the response is read from 1 Hz and at DC, not from 10 Hz', () => {
  // A narrow +12 dB peak at 3 Hz (a band can go down to 1 Hz) and a low-pass boost, flat to DC.
  assert.ok(Math.abs(chainPeakDb([{ type: PEAKING, f: 3, q: 4, g: 12 }], 0, FS) - 12) < 0.01);
  assert.ok(Math.abs(chainPeakDb([{ type: LOW_PASS, f: 2, q: 0.5, g: 9 }], 0, FS) - 9) < 0.01, `${chainPeakDb([{ type: LOW_PASS, f: 2, q: 0.5, g: 9 }], 0, FS)}`);
});

test('every gain stage after the equaliser counts: Stereo X up to +6 dB, balance never raises, volume, the reverb return', () => {
  const flat = [];
  const later = (o) => laterGainDb({ matrix: [1, 0, 0, 1], dry: 1, wet: [0, 0], irGain: 0, volume: 1, ...o });
  assert.equal(later({}), 0);
  // Stereo X at its widest (w = 2): a = 1.5, c = −0.5, |a| + |c| = 2: +6.02 dB.
  assert.ok(Math.abs(later({ matrix: [1.5, -0.5, -0.5, 1.5] }) - 20 * Math.log10(2)) < 1e-9);
  assert.equal(later({ matrix: [1, 0, 0, 0.5] }), 0, 'balance turns one side down, never up');
  assert.ok(Math.abs(later({ volume: 0.5 }) + 20 * Math.log10(2)) < 1e-9);
  assert.ok(Math.abs(later({ dry: 0.85, wet: [0.3, 0], irGain: 1.5 }) - 20 * Math.log10(0.85 + 0.45)) < 1e-9);
  assert.ok(Math.abs(headroomDb(flat, 0, FS, later({ matrix: [1.5, -0.5, -0.5, 1.5] })) - 20 * Math.log10(2)) < 1e-9);
});
