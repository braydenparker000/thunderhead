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

test('dialogue lift: the centre channel alone is raised by centreGain(step), in every layout with a centre', async () => {
  const { centreGain } = await import('../frontend/astra/src/enhance/sound-chain.js');
  // A 5.1 frame with sound in the centre only (as tests/fixtures/astra/centre.mkv): both sides get H × gain × centre.
  for (const step of [0, 1, 2]) {
    const [l, r] = toStereo(new Float32Array([0, 0, 0.5, 0, 0, 0]), 6, centreGain(step));
    near(l, H * centreGain(step) * 0.5); near(r, l);
  }
  near(centreGain(2) / centreGain(0), 10 ** (8 / 20)); // +2 is 8 dB
  // The other channels are untouched by the lift.
  const frame = [0.1, 0.2, 0.4, 0.9, 0.3, 0.5, 0.25, 0.15];
  for (const n of [3, 5, 6, 7, 8]) {
    const plain = toStereo(new Float32Array(frame.slice(0, n)), n), lifted = toStereo(new Float32Array(frame.slice(0, n)), n, 2);
    near(lifted[0] - plain[0], H * 0.4); near(lifted[1] - plain[1], H * 0.4);
  }
  // Layouts without a centre (mono, stereo, quad) are the same with or without it.
  for (const n of [1, 2, 4]) assert.deepEqual([...toStereo(new Float32Array(frame.slice(0, n)), n, 2)], [...toStereo(new Float32Array(frame.slice(0, n)), n)]);
});
