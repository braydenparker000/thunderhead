// The pure parts of Astra's sound and picture enhancements (frontend/astra/src/enhance/): the
// stereo mix the chain does itself agrees with the engine's own, the picture's sizes, and the BT.2390
// curve that maps an HDR film to the SDR canvas; and headphone surround's sound written ahead of the chain's own delay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stereoMatrix, centreGain, settle, isOff, makeupGain, LIMIT } from '../frontend/astra/src/enhance/sound-chain.js';
import { shownSize, outputSize } from '../frontend/astra/src/enhance/picture.js';
import { eetf, pq, pqNits, curve, eetfPQ } from '../frontend/astra/src/enhance/tonemap.js';
import { toStereo } from '../frontend/astra/src/engine/downmix.js';
import { FLAC, PLACED, soundShift } from '../frontend/astra/src/engine/sound-six.js';

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

// Expected values from an independent implementation of ITU-R BT.2390 5.4.1 (Python, 40-digit decimals).
test('BT.2390 EETF: PQ round trip, unchanged below the knee, bent smoothly to the target peak above it', () => {
  near(pq(100), 0.5080784215173949, 1e-12); near(pq(203), 0.5806888810416079, 1e-12); near(pq(1000), 0.7518270962470418, 1e-12);
  for (const n of [0.01, 1, 5, 100, 203, 1000, 10000]) near(pqNits(pq(n)), n, n * 1e-9);
  // 1000-nit source on a 406-nit canvas (the shipped constants): 5, 20, 100, 203 untouched.
  for (const [n, want] of [[5, 5], [20, 20], [100, 100], [203, 203], [300, 294.9822168528088], [500, 381.6947054482469], [700, 402.5763888659582], [1000, 406], [4000, 406]]) near(eetf(n), want, 1e-6 * want);
  near(eetf(600, 1000, 203), 201.32416453286868, 1e-6);
  near(eetf(1000, 4000, 406), 376.0092653205163, 1e-6);
  const c = curve(1000, 406);
  let last = 0;
  for (let e = 0; e <= 1.0001; e += 0.01) { const v = eetfPQ(e, c); assert.ok(v >= last - 1e-12, 'rising everywhere'); last = v; }
  near(eetfPQ(1, c), c.maxLum, 1e-12);
  const d = 1e-6; near((eetfPQ(c.ks + d, c) - eetfPQ(c.ks, c)) / d, 1, 1e-3); near((eetfPQ(1, c) - eetfPQ(1 - d, c)) / d, 0, 1e-3);
  near(eetf(800, 1000, 1000), 800, 1e-6); // a screen as bright as the source: nothing to do
});

test("whole surround is written 12 ms earlier, the delay of the chain's HRTF panners and limiter; other sound is not", () => {
  near(PLACED, 0.012);
  near(soundShift({ offset: 1, advance: 0.25, audioMime: FLAC }), 1.262);
  near(soundShift({ offset: 1, advance: 0.25, audioMime: 'audio/mp4; codecs="opus"' }), 1.25);
});
