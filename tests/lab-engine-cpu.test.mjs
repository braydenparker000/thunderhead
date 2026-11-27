// The network's heaviest pass written for the CPU (engine/netcpu, frontend/lab/engine/cpu/*.wasm): both builds make
// the sums a plain loop makes, the one that multiplies and adds to the last bit, the fused one within rounding; a
// shape it does not take is refused. How fast it is on a phone is the engine test page's to say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layer, macs, plain } from '../frontend/lab/engine/cpu-conv.js';

const build = (name) => new WebAssembly.Module(readFileSync(new URL(`../frontend/lab/engine/cpu/${name}.wasm`, import.meta.url)));

test('both builds of the CPU pass make the sums a plain loop makes', () => {
  for (const shape of [{ cin: 5, cout: 8, h: 3, w: 4 }, { cin: 37, cout: 16, h: 9, w: 12 }, { cin: 288, cout: 144, h: 6, w: 8 }]) {
    const exact = layer(build('conv'), shape), want = plain(shape, exact.input, exact.weights, exact.bias);
    assert.equal(exact.run(), 0);
    assert.ok(want.some((v) => v > 0.05) && want.some((v) => v < -0.005), 'the layer has values either side of the bend');
    assert.deepEqual([...exact.output], [...want], `multiply then add: the same to the last bit (${JSON.stringify(shape)})`);
    const fused = layer(build('conv-fused'), shape);
    assert.equal(fused.run(), 0);
    let off = 0; for (let i = 0; i < want.length; i++) off = Math.max(off, Math.abs(fused.output[i] - want[i]));
    assert.ok(off < 2e-5, `fused: within rounding (${off})`);
  }
  assert.equal(macs({ cin: 288, cout: 144, h: 176, w: 176 }), 11_561_730_048, 'the network\'s heavy pass is 11.6 thousand million multiply-adds');
});

test('a shape it does not take is refused', () => {
  const m = build('conv');
  assert.equal(layer(m, { cin: 4, cout: 8, h: 2, w: 6 }).run(), 1, 'a width that is not a multiple of 4');
  assert.equal(layer(m, { cin: 4, cout: 12, h: 2, w: 4 }).run(), 1, 'channels out that are not a multiple of 8');
});

test('conv3r_wino matches direct 3x3 conv with pre-act LeakyReLU, residual skip, and odd strip height', () => {
  const G = [[1, 0, 0], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5], [0, 0, 1]];
  for (const name of ['conv', 'conv-fused']) {
    for (const [cin, cout, h, w, flags] of [[15, 16, 5, 8, 0], [16, 16, 7, 16, 3], [16, 8, 4, 8, 1]]) {
      const x = new WebAssembly.Instance(build(name), {}).exports, mem = x.memory;
      const room = (n) => { const p = x.room(n * 4 + 16); return [p, () => new Float32Array(mem.buffer, p, n)]; };
      const [ip, getI] = room((h + 2) * (w + 2) * cin), [wp, getW] = room((cout / 8) * 16 * cin * 8);
      const [bp, getB] = room(cout), [op, getO] = room((h + 2) * (w + 2) * cout), [sp] = room(16 * cin * 4);
      const inp = getI(), wU = getW(), bias = getB(), filt = new Float32Array(cout * cin * 9);
      let s = 42; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 1.4;
      for (let y = 1; y <= h; y++) for (let col = 1; col <= w; col++) for (let c = 0; c < cin; c++) inp[(y * (w + 2) + col) * cin + c] = rnd();
      for (let i = 0; i < filt.length; i++) filt[i] = rnd() * 0.3;
      for (let i = 0; i < cout; i++) bias[i] = rnd() * 0.1;
      const tmp = new Float32Array(12);
      for (let oc = 0; oc < cout; oc++) for (let ci = 0; ci < cin; ci++) {
        const base = (oc * cin + ci) * 9;
        for (let r = 0; r < 4; r++) for (let col = 0; col < 3; col++) tmp[r * 3 + col] = G[r][0] * filt[base + col] + G[r][1] * filt[base + 3 + col] + G[r][2] * filt[base + 6 + col];
        for (let r = 0; r < 4; r++) for (let col = 0; col < 4; col++) wU[(((oc >> 3) * 16 + r * 4 + col) * cin + ci) * 8 + (oc & 7)] = tmp[r * 3] * G[col][0] + tmp[r * 3 + 1] * G[col][1] + tmp[r * 3 + 2] * G[col][2];
      }
      assert.equal(x.conv3r_wino(ip, wp, bp, op, sp, cin, cout, h, w, flags), 0);
      const out = getO(), pre = !!(flags & 1), skip = !!(flags & 2);
      let maxDiff = 0;
      for (let y = 0; y < h; y++) for (let col = 0; col < w; col++) for (let oc = 0; oc < cout; oc++) {
        let sum = bias[oc];
        for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++) for (let ci = 0; ci < cin; ci++) {
          let v = inp[((y + ky) * (w + 2) + col + kx) * cin + ci];
          if (pre && v < 0) v *= 0.1;
          sum += v * filt[(oc * cin + ci) * 9 + ky * 3 + kx];
        }
        if (skip) sum += inp[((y + 1) * (w + 2) + col + 1) * cin + oc];
        maxDiff = Math.max(maxDiff, Math.abs(out[((y + 1) * (w + 2) + col + 1) * cout + oc] - sum));
      }
      assert.ok(maxDiff < 5e-5, `${name} (${cin}>${cout} ${h}x${w} f=${flags}): maxDiff=${maxDiff}`);
    }
  }
});
