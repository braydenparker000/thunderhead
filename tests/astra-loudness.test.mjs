// Even loudness (frontend/astra/src/enhance/loudness.js): the BS.1770 measure against the
// standard's coefficients and EBU Tech 3341's own test signals, synthesized here, and the gain law.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kWeighting, kSquares, channelWeights, Gate, wantedGain, nextGain, remember, startLevel, cleanLevels, TARGET, GUESS, REMEMBERED } from '../frontend/astra/src/enhance/loudness.js';

const near = (a, b, e, what = '') => assert.ok(Math.abs(a - b) <= e, `${what} ${a} is not ${b} ±${e}`);

/**
 * Measures stereo 1 kHz sine passages [[dBFS peak, seconds], …] (both channels) as the meter does:
 * K-weighting per channel, 100 ms steps of weighted mean square, the gate. Returns the programme loudness.
 */
function measure(parts, rate = 48000, channels = 2, only = null) {
  const k = kWeighting(rate), w = channelWeights(channels), states = Array.from({ length: channels }, () => new Float64Array(4));
  const gate = new Gate(), len = rate / 10, x = new Float32Array(len);
  let n = 0;
  for (const [db, seconds] of parts) {
    const a = 10 ** (db / 20);
    for (let s = 0; s < Math.round(seconds * 10); s++) {
      for (let i = 0; i < len; i++, n++) x[i] = a * Math.sin(2 * Math.PI * 1000 * n / rate);
      let z = 0;
      for (let c = 0; c < channels; c++) if (w[c] && (only == null || only === c)) z += w[c] * kSquares(x, k, states[c]);
      gate.step(z / len);
    }
  }
  return gate.integrated;
}

test('K-weighting at 48 kHz is the standard\'s own pair of filters', () => {
  const k = kWeighting(48000);
  const bs1770 = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585, 1, -2, 1, -1.99004745483398, 0.99007225036621];
  k.forEach((v, i) => near(v, bs1770[i], 1e-8, `coefficient ${i}`));
});

test('a 1 kHz sine at -18 dBFS in both channels reads -18.0 LUFS, at 48 and at 44.1 kHz', () => {
  near(measure([[-18, 5]]), -18, 0.1, '48 kHz');
  near(measure([[-18, 5]], 44100), -18, 0.1, '44.1 kHz');
  near(measure([[0, 3]], 48000, 1), -3.01, 0.1, 'BS.1770: 0 dBFS in one channel reads -3.01');
});

test('EBU Tech 3341 cases 1 to 5: the gates leave out the quiet and silent passages', () => {
  near(measure([[-23, 20]]), -23, 0.1, 'case 1');
  near(measure([[-33, 20]]), -33, 0.1, 'case 2');
  near(measure([[-36, 10], [-23, 60], [-36, 10]]), -23, 0.1, 'case 3: the relative gate');
  near(measure([[-72, 10], [-36, 10], [-23, 60], [-36, 10], [-72, 10]]), -23, 0.1, 'case 4: both gates');
  near(measure([[-26, 20], [-20, 20.1], [-26, 20]]), -23, 0.1, 'case 5');
  assert.equal(measure([[-80, 5]]), null, 'only silence: nothing to go by');
});

test('channel weights: a surround counts 1.41, the bass channel not at all', () => {
  const front = measure([[-20, 5]], 48000, 6, 0), side = measure([[-20, 5]], 48000, 6, 4);
  near(side - front, 10 * Math.log10(1.41), 0.05);
  assert.equal(channelWeights(6)[3], 0);
});

test('the gain law: held, then fast, then at most 1 dB per 2 s, never past the range', () => {
  near(wantedGain(-21.2), TARGET + 21.2, 1e-9, 'a film at -21.2 wants +3.2');
  assert.equal(wantedGain(-40), 12); assert.equal(wantedGain(0), -12);
  assert.equal(nextGain(5, 12, 1, 0.1), 5, 'held for the first 2 s of sound');
  near(nextGain(5, 12, 3, 0.1), 5.3, 1e-9, 'fast while young');
  near(nextGain(5, 12, 10, 2), 6, 1e-9, '1 dB per 2 s once settled');
  assert.equal(nextGain(5, 5.1, 20, 1), 5.1, 'reaches the target without overshoot');
  assert.equal(nextGain(5, 12, 9, 0.1, true), 5, 'a remembered gain is held until the measure settles');
  near(nextGain(5, 0, 12, 1, true), 4.5, 1e-9, 'and then moves slowly');
  // Steady: a film at -30 LUFS from the guess, 0.1 s at a time: within 0.1 dB of +12 by 10 s, and no step bigger than allowed.
  let g = GUESS, worst = 0;
  for (let t = 0.1; t <= 10; t += 0.1) { const n = nextGain(g, wantedGain(-30), t, 0.1); worst = Math.max(worst, Math.abs(n - g)); g = n; }
  near(g, 12, 0.1); assert.ok(worst <= 0.3 + 1e-9);
});

test('remembered gains: by title, most recent last, at most 200, damaged entries dropped', () => {
  let levels = {};
  for (let i = 0; i < REMEMBERED + 5; i++) levels = remember(levels, `tt${i}`, i % 20 - 10);
  assert.equal(Object.keys(levels).length, REMEMBERED);
  assert.equal('tt0' in levels, false, 'the oldest went');
  levels = remember(levels, 'tt10', 3.14159);
  assert.equal(Object.keys(levels).at(-1), 'tt10'); assert.equal(levels.tt10, 3.1);
  assert.deepEqual(startLevel(levels, 'tt10'), { db: 3.1, known: true });
  assert.equal(startLevel(levels, 'new').known, false);
  assert.deepEqual(startLevel({}, 'new'), { db: GUESS, known: false });
  assert.deepEqual(startLevel({ a: 2, b: 4, c: 9 }, 'new'), { db: 4, known: false }, 'the middle of the others');
  assert.deepEqual(cleanLevels({ a: 'x', b: NaN, c: 40, d: -2 }), { d: -2 });
  assert.deepEqual(cleanLevels([1]), {});
});
