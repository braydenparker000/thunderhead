// Astra's stereo mix-down (frontend/astra/src/engine/downmix.js): converted sound is mixed a sample
// at a time, so it starts as soon as it is decoded. The numbers are invented samples.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mixable, toStereo } from '../frontend/astra/src/engine/downmix.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} is not ${b}`);
const H = Math.SQRT1_2;

test('mono goes to both sides, stereo passes through', () => {
  assert.deepEqual([...toStereo(new Float32Array([0.25, -0.5]), 1)], [0.25, 0.25, -0.5, -0.5]);
  assert.deepEqual([...toStereo(new Float32Array([0.25, -0.5, 0.125, 0.75]), 2)], [0.25, -0.5, 0.125, 0.75]);
});

test('5.1: the centre and each surround at -3 dB on their side, the bass channel left out', () => {
  // L R C LFE SL SR, two frames
  const out = toStereo(new Float32Array([0.1, 0.2, 0.4, 0.9, 0.3, 0.5, 0, 0, 1, 1, 0, 0]), 6);
  near(out[0], 0.1 + H * (0.4 + 0.3));
  near(out[1], 0.2 + H * (0.4 + 0.5));
  near(out[2], H);
  near(out[3], H);
});

test('the other layouts keep every speaker but the bass', () => {
  near(toStereo(new Float32Array([0.1, 0.2, 0.4]), 3)[0], 0.1 + H * 0.4);
  assert.deepEqual([...toStereo(new Float32Array([0.5, 0.25, 0.5, 0.75]), 4)], [0.5, 0.5]);
  near(toStereo(new Float32Array([0.1, 0.2, 0.4, 0.3, 0.5]), 5)[1], 0.2 + H * (0.4 + 0.5));
  // 6.1: L R C LFE BC SL SR
  near(toStereo(new Float32Array([0.1, 0.2, 0.4, 0.9, 0.2, 0.3, 0.5]), 7)[0], 0.1 + H * (0.4 + 0.3) + 0.5 * 0.2);
  // 7.1: L R C LFE BL BR SL SR
  const wide = toStereo(new Float32Array([0.1, 0.2, 0.4, 0.9, 0.2, 0.6, 0.3, 0.5]), 8);
  near(wide[0], 0.1 + H * 0.4 + 0.5 * (0.2 + 0.3));
  near(wide[1], 0.2 + H * 0.4 + 0.5 * (0.6 + 0.5));
});

test('only 48 kHz sound is mixed here; the rest is resampled by the unpacker', () => {
  assert.equal(mixable(48000), true);
  assert.equal(mixable(44100), false);
});
