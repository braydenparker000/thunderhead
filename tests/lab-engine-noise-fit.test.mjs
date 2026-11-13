// How noisy a photo's sensor data is, read from the data itself (frontend/lab/engine/noise-fit.js): on a made-up
// mosaic with known noise, a slope like a sky's and a third of it textured, the fit finds the noise it was given;
// a photo with nothing flat says it cannot; and the sensor's own figure rises with the ISO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitNoise, sensorNoise } from '../frontend/lab/engine/noise-fit.js';

const W = 1800, H = 1200, black = 1022, white = 16383, range = white - black;
function mosaic(a, b, busy = false) {
  let seed = 5; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed + 0.5) / 4294967296; }, gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
  const m = new Uint16Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0.002 + 0.6 * (x / W) ** 2.2 * (0.4 + 0.6 * y / H);
    if (busy || ((x >> 7) % 3 === 1 && (y >> 7) % 2 === 1)) v *= 1 + 0.5 * Math.sin(x * 1.3) * Math.sin(y * 0.9);
    m[y * W + x] = Math.max(0, Math.min(65535, Math.round(black + range * (v + Math.sqrt(a * v + b) * gauss()))));
  }
  return m;
}

test('the fit finds the noise a mosaic was given, at three ISOs\' worth, past a slope and texture', () => {
  for (const [a, b] of [[2.24e-4, 7.3e-8], [4.4e-5, 1.2e-8], [1.1e-3, 1.5e-6]]) {
    const f = fitNoise(mosaic(a, b), W, H, black, white, [0, 0], 1);
    assert.ok(f.ok && f.blocks > 5000, `${f.blocks} blocks`);
    assert.ok(f.a > 0.9 * a && f.a < 1.2 * a, `a ${f.a.toExponential(3)} for ${a}`);
    assert.ok(f.b > 0.6 * b && f.b < 1.6 * b, `b ${f.b.toExponential(3)} for ${b}`);
  }
  // read from a ninth of the photo (as full.js does): still within a fifth
  const f = fitNoise(mosaic(2.24e-4, 7.3e-8), W, H, black, white, [0, 0], 3);
  assert.ok(f.ok && f.a > 0.85 * 2.24e-4 && f.a < 1.25 * 2.24e-4, `a ${f.a.toExponential(3)}`);
});

test('a mosaic too small to go by says so; the sensor\'s own figure doubles with the ISO', () => {
  assert.equal(fitNoise(new Uint16Array(60 * 60).fill(2000), 60, 60, black, white, [0, 0], 1).ok, false);
  const lo = sensorNoise(125), hi = sensorNoise(250), top = sensorNoise(640);
  assert.ok(Math.abs(hi.a / lo.a - 2) < 1e-9 && top.a > 2.2e-4 && top.a < 2.3e-4 && lo.b > 0 && top.b > 0);
});
