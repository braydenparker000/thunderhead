// Display P3 for exported files (frontend/lab/engine/icc.js): the matrix that takes a frame to it, and the colour
// profile a file carries, both worked out from the published points of the two spaces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P3, SRGB, SRGB_TO_P3, bradford, inverse, mul, p3Profile, toXyz } from '../frontend/lab/engine/icc.js';

const near = (a, b, eps, what) => a.flat().forEach((v, i) => assert.ok(Math.abs(v - b.flat()[i]) <= eps, `${what}: ${v} against ${b.flat()[i]}`));

test('the matrices are the published ones: sRGB to XYZ, sRGB to Display P3, and back', () => {
  near(toXyz(SRGB), [[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]], 2e-4, 'sRGB to XYZ (IEC 61966-2-1)');
  near(SRGB_TO_P3, [[0.8225, 0.1774, 0], [0.0332, 0.9669, 0], [0.0171, 0.0724, 0.9108]], 3e-4, 'sRGB to Display P3');
  near(mul(SRGB_TO_P3, inverse(SRGB_TO_P3)), [[1, 0, 0], [0, 1, 0], [0, 0, 1]], 1e-12, 'there and back');
  // white stays white, and every sRGB colour is inside P3: no part of it below nothing
  near([SRGB_TO_P3.map((r) => r[0] + r[1] + r[2])], [[1, 1, 1]], 1e-9, 'white');
  assert.ok(SRGB_TO_P3.flat().every((v) => v > -1e-12));
  // P3's own red is outside sRGB: brought back, a part of it is below nothing
  assert.ok(inverse(SRGB_TO_P3)[1][0] < -0.03 && inverse(SRGB_TO_P3)[0][0] > 1.2);
});

test('the profile: a header, ten tags, the three colours under D50, one curve for all three', () => {
  const p = p3Profile(), v = new DataView(p.buffer), text = (at, n) => String.fromCharCode(...p.subarray(at, at + n));
  assert.deepEqual(p, p3Profile(), 'the same bytes every time');
  assert.equal(v.getUint32(0), p.length);
  assert.ok(p.length > 400 && p.length < 700 && p.length % 4 === 0, `${p.length} bytes`);
  assert.deepEqual([v.getUint8(8), text(12, 12), text(36, 4)], [4, 'mntrRGB XYZ ', 'acsp']);
  const s15 = (at) => v.getInt32(at) / 65536, tags = Object.fromEntries(Array.from({ length: v.getUint32(128) }, (_, i) => [text(132 + i * 12, 4), [v.getUint32(136 + i * 12), v.getUint32(140 + i * 12)]]));
  assert.deepEqual(Object.keys(tags), ['desc', 'cprt', 'wtpt', 'rXYZ', 'gXYZ', 'bXYZ', 'rTRC', 'gTRC', 'bTRC', 'chad']);
  for (const [name, [at, n]] of Object.entries(tags)) assert.ok(at >= 128 + 4 + 120 && at % 4 === 0 && at + n <= p.length, `${name} lies inside the file, on a multiple of four`);
  assert.deepEqual([tags.rTRC, tags.gTRC], [tags.bTRC, tags.bTRC], 'one curve');
  assert.equal(text(tags.desc[0] + 28, 20).replace(/\0/g, ''), 'Display P3');
  const col = (name) => [0, 1, 2].map((i) => s15(tags[name][0] + 8 + i * 4));
  // the three colours add up to the profile's white (D50), and are Display P3's as every such profile gives them
  near([[0, 1, 2].map((i) => col('rXYZ')[i] + col('gXYZ')[i] + col('bXYZ')[i])], [[0.9642, 1, 0.8249]], 2e-4, 'white');
  near([col('rXYZ'), col('gXYZ'), col('bXYZ')], [[0.5151, 0.2412, -0.0011], [0.292, 0.6922, 0.0419], [0.1571, 0.0666, 0.7841]], 3e-4, 'the colours under D50');
  // the curve is sRGB's, and the adaptation is Bradford's from D65 to D50
  assert.deepEqual([text(tags.rTRC[0], 4), v.getUint16(tags.rTRC[0] + 8)], ['para', 3]);
  near([[0, 1, 2, 3, 4].map((i) => s15(tags.rTRC[0] + 12 + i * 4))], [[2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045]], 2e-5, 'the curve');
  near([Array.from({ length: 9 }, (_, i) => s15(tags.chad[0] + 8 + i * 4))], [bradford([0.3127 / 0.329, 1, (1 - 0.3127 - 0.329) / 0.329], [0.9642, 1, 0.8249]).flat()], 2e-5, 'the adaptation');
  near([bradford([0.9505, 1, 1.089], [0.9642, 1, 0.8249]).flat()], [[1.0478, 0.0229, -0.0501, 0.0295, 0.9905, -0.0171, -0.0092, 0.015, 0.7521]], 4e-4, 'Bradford, D65 to D50');
  assert.ok(P3.r[0] > SRGB.r[0] && P3.g[1] > SRGB.g[1]);
});
