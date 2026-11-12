// Stacking for noise, the arithmetic (frontend/lab/engine/stack.js; engine/raw/ROADMAP.md stage 8). Frames of one
// scene are averaged as sensor data: the noise must fall with the square root of how many there are, a frame that
// has moved must be told from one that has not, the stack's file must come back as it went, and its editing copy
// must be the one the decoder would make. The frames are the engine's made-up photo (known.js) with noise laid on
// by this test, seeded, so every run sees the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FINER, STILL, binned, pack, shiftOf, stackMeta, summer, unpack } from '../frontend/lab/engine/stack.js';
import { known } from '../frontend/lab/engine/known.js';

const scene = known(240);
/** The scene's sensor data with noise of `sd` levels, from `seed`. */
function noisy(sd, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s + 0.5) / 4294967296; }, gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
  return Uint16Array.from(scene.mosaic, (v) => Math.max(0, Math.min(16383, Math.round(v + sd * gauss()))));
}
/** How far sensor data sits from the scene's own, in the camera's levels (root mean square). */
const off = (m, scale = 1) => Math.sqrt(m.reduce((t, v, i) => t + (v / scale - scene.mosaic[i]) ** 2, 0) / m.length);

test('noise falls with the square root of the frames, and the stack holds finer levels than a frame', () => {
  const one = off(noisy(40, 1)), sum = summer(scene.mosaic.length);
  for (let k = 0; k < 16; k++) sum.add(noisy(40, 100 + k));
  const stack = sum.done(), left = off(stack, FINER);
  assert.equal(sum.count, 16);
  assert.ok(Math.abs(one - 40) < 2, `a frame's noise is what was laid on (${one.toFixed(1)})`);
  assert.ok(left < one / 3.6 && left > one / 4.4, `sixteen frames: a quarter of the noise (${left.toFixed(2)} of ${one.toFixed(1)})`);
  // an average of whole numbers is not whole: the finer scale keeps what a frame's own would round away
  const two = summer(4); two.add(Uint16Array.of(10, 11, 12, 13)); two.add(Uint16Array.of(11, 11, 13, 16));
  assert.deepEqual([...two.done()], [42, 44, 50, 58]);
});

test("what the engine is told of a stack: the levels at the finer scale, the ISO its noise answers to", () => {
  const m = stackMeta({ ...scene.meta, iso: 6400 }, 16, { dr: 200, settings: 'CLASSIC CHROME' });
  assert.deepEqual([m.black, m.white, m.iso, m.frames, m.dr, m.settings], [scene.meta.black * 4, scene.meta.white * 4, 400, 16, 200, 'CLASSIC CHROME']);
  assert.equal(m.cfa, scene.meta.cfa);
});

test("a stack's file comes back as it went, and its editing copy is the decoder's", () => {
  const sum = summer(scene.mosaic.length); sum.add(scene.mosaic); sum.add(scene.mosaic);
  const meta = stackMeta(scene.meta, 2), parts = pack(sum.done(), meta), bytes = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0; for (const p of parts) { bytes.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), at); at += p.byteLength; }
  const back = unpack(bytes.buffer);
  assert.deepEqual(back.meta, JSON.parse(JSON.stringify(meta)));
  assert.equal(back.mosaic.length, 240 * 240);
  assert.equal(back.mosaic.byteOffset, 0, 'the sensor data lies at the start, to be read where it is');
  assert.ok(back.mosaic.every((v, i) => v === scene.mosaic[i] * FINER), 'two frames alike average to themselves');
  // the editing copy of the same data, whichever scale it is kept at, is the one the decoder makes of a frame
  const copy = binned(back.mosaic, back.meta);
  assert.equal(copy.length, scene.proxy.length);
  let worst = 0; for (let i = 0; i < copy.length; i++) worst = Math.max(worst, Math.abs(copy[i] - scene.proxy[i]));
  assert.ok(worst <= 1, `off by ${worst} of 65535 at most (the last step of a division)`);
  assert.throws(() => unpack(new Uint8Array(64).buffer), /not a stack|JSON|Unexpected/);
});

test('a frame that lies on the first is told from one that has moved', () => {
  const w = scene.width, a = scene.proxy, moved = (dx) => { const b = new Uint16Array(a.length); for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) b[(y * w + x) * 4 + k] = a[(y * w + Math.max(0, Math.min(w - 1, x - dx))) * 4 + k]; return b; };
  const still = shiftOf(a, binned(noisy(40, 7), scene.meta), w, w), one = shiftOf(a, moved(1), w, w);
  const half = shiftOf(a, Uint16Array.from(a, (v, i) => (v + moved(1)[i]) / 2), w, w);
  assert.ok(Math.hypot(...still) <= STILL, `another exposure of the same thing, noise and all, has not moved (${still.map((v) => v.toFixed(3))})`);
  assert.deepEqual(one.map(Math.round), [1, 0]);
  assert.ok(Math.hypot(...one) > STILL && Math.hypot(...half) > STILL, `a pixel's move, and half of one, are seen (${half.map((v) => v.toFixed(2))})`);
});
