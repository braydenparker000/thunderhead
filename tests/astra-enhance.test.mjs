// The pure parts of Astra's sound and picture enhancements (frontend/astra/src/enhance/): the
// stereo mix the chain does itself agrees with the engine's own, and the picture's sizes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stereoMatrix, centreGain, settle, isOff, makeupGain, LIMIT } from '../frontend/astra/src/enhance/sound-chain.js';
import { shownSize, outputSize } from '../frontend/astra/src/enhance/picture.js';
import { toStereo } from '../frontend/astra/src/engine/downmix.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} is not ${b}`);

test('the chain\'s own mix is the engine\'s mix, for every layout', () => {
  for (let n = 1; n <= 8; n++) {
    const frame = Float32Array.from({ length: n }, (_, i) => (i + 1) / 10);
    const [l, r] = toStereo(frame, n), m = stereoMatrix(n);
    near(m.reduce((s, [a], i) => s + a * frame[i], 0), l);
    near(m.reduce((s, [, b], i) => s + b * frame[i], 0), r);
  }
});

test('dialogue steps raise only the centre, 4 dB a step', () => {
  near(centreGain(0), 1);
  near(20 * Math.log10(centreGain(1)), 4);
  near(20 * Math.log10(centreGain(2)), 8);
  near(centreGain(7), centreGain(2));
  const lifted = stereoMatrix(6, centreGain(1)), flat = stereoMatrix(6);
  assert.deepEqual(lifted.filter((_, i) => i !== 2), flat.filter((_, i) => i !== 2));
  near(lifted[2][0] / flat[2][0], centreGain(1));
});

test('settings are bounded, and everything off is off', () => {
  assert.deepEqual(settle({ boost: 9, night: 1, dialogue: -1, delay: 'x' }), { boost: 3, night: true, dialogue: 0, delay: 0 });
  assert.ok(isOff(settle()));
  assert.ok(!isOff(settle({ delay: 0.1 })));
  near(20 * Math.log10(makeupGain(LIMIT)), 0.57, 0.01);
});

test('the picture is drawn at the size it is shown, capped at 1080p, never below the film', () => {
  assert.deepEqual(shownSize([800, 600], [320, 180], 'contain'), [800, 450]);
  assert.deepEqual(shownSize([800, 600], [320, 180], 'cover'), [1066.6666666666667, 600]);
  assert.deepEqual(shownSize([800, 600], [320, 180], 'fill'), [800, 600]);
  assert.deepEqual(outputSize([640, 360], 2, [320, 180]), [1280, 720]);
  assert.deepEqual(outputSize([1170, 658], 3, [320, 180]), [1920, 1080]);
  assert.deepEqual(outputSize([640, 360], 2, [320, 180], 0.5), [640, 360]);
  assert.deepEqual(outputSize([400, 225], 1, [1280, 720]), [1280, 720], 'shown smaller than the film: the film\'s own size');
});
