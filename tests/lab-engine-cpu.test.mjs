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
