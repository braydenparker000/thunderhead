// Auto white balance, the estimate (frontend/lab/engine/autowhite.js). Scenes are made up here from lights whose
// colour is known: each surface's camera colour is the light's camera neutral (the engine's own neutralFor, dcp.js)
// times the surface's own colour, at a brightness. Two cameras: the engine's made-up one (known.js) and a JPEG's
// (linear sRGB, picture.js). The camera's white is set wrong on purpose; the estimate must find the light where
// the scene has neutrals, and keep the camera's white where it has none (grass, a sunset). Seeded: every run alike.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIP, autoWhite, samples } from '../frontend/lab/engine/autowhite.js';
import { neutralFor, whiteOf } from '../frontend/lab/engine/dcp.js';
import { CAMERA } from '../frontend/lab/engine/known.js';
import { XYZ_TO_SRGB } from '../frontend/lab/engine/picture.js';

const profile = (cm1) => ({ cm1, cm2: null, fm1: null, fm2: null, t1: 6504, t2: 6504, hsm: null, look: null, tone: null, expOffset: 0, name: 'Made up', model: '' });
const CAMERAS = { 'made-up camera': profile(CAMERA.xyzToCamD65), 'a JPEG': profile(XYZ_TO_SRGB) };

let seed = 7;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed + 0.5) / 4294967296; };
/** Camera colours of `surfaces` ([colour, how many]) under a light of `kelvin` and `tint`: each at a brightness
 * between `lo` and `hi` of the sensor's range, with a little noise. */
function lit(p, kelvin, tint, surfaces, lo = 0.15, hi = 0.8) {
  const n = neutralFor(p, kelvin, tint), out = [];
  for (const [c, count] of surfaces) for (let i = 0; i < count; i++) {
    const e = 65535 * (lo + (hi - lo) * rnd()) / Math.max(...n);
    for (let k = 0; k < 3; k++) out.push(n[k] * c[k] * e * (1 + 0.02 * (rnd() - 0.5)));
  }
  return out;
}
const ramp = Array.from({ length: 12 }, (_, i) => [[0.08 + i * 0.08, 0.08 + i * 0.08, 0.08 + i * 0.08], 30]);
const PATCHES = [[[0.9, 0.2, 0.15], 80], [[0.2, 0.7, 0.2], 80], [[0.15, 0.25, 0.85], 80], [[0.9, 0.8, 0.2], 80], [[0.7, 0.3, 0.7], 80], [[0.85, 0.6, 0.45], 80], [[0.3, 0.6, 0.8], 80]];
const FOLIAGE = [[[0.2, 0.6, 0.1], 400], [[0.15, 0.45, 0.12], 400], [[0.3, 0.7, 0.2], 200], [[0.25, 0.5, 0.05], 200], [[0.35, 0.55, 0.1], 200]];
const SUNSET = [[[1, 0.5, 0.15], 300], [[1, 0.35, 0.1], 300], [[1, 0.75, 0.3], 300], [[0.9, 0.25, 0.2], 200], [[0.6, 0.2, 0.35], 100], [[1, 0.6, 0.2], 200]];
const inside = (r) => r.kelvin >= 2500 - 1e-6 && r.kelvin <= 10000 + 1e-6 && Math.abs(r.tint) <= 40 + 1e-9;

test('a grey ramp and colour patches: the light is found when the camera got it wrong by 1000 K', () => {
  const misses = [];
  for (const [name, p] of Object.entries(CAMERAS)) for (const [kelvin, tint] of [[3200, 0], [5500, 6], [7500, -5]]) for (const off of [-1000, 1000]) {
    const truth = whiteOf(p, neutralFor(p, kelvin, tint)), r = autoWhite(lit(p, kelvin, tint, [...ramp, ...PATCHES]), neutralFor(p, kelvin + off, 0), p);
    misses.push([Math.abs(r.kelvin - kelvin), Math.abs(r.tint - tint)]);
    assert.equal(r.weak, false, `${name}, ${kelvin} K, camera at ${kelvin + off} K: plenty of grey to go by (${r.share.toFixed(2)})`);
    assert.ok(Math.abs(r.kelvin - kelvin) <= 250, `${name}, ${kelvin} K, camera at ${kelvin + off} K: found ${Math.round(r.kelvin)} K`);
    assert.ok(Math.abs(r.tint - tint) <= 8, `${name}, tint ${tint}, found ${r.tint.toFixed(1)}`);
    assert.ok(Math.abs(r.kelvin - truth.kelvin) <= 60, `the same light as the engine itself reads it back (${Math.round(truth.kelvin)} K): found ${Math.round(r.kelvin)} K`);
  }
  console.log(`worst miss: ${Math.round(Math.max(...misses.map((m) => m[0])))} K, ${Math.max(...misses.map((m) => m[1])).toFixed(1)} tint over ${misses.length} scenes`);
});

test('nothing neutral (grass; a sunset): the camera\'s white is kept, and said to be', () => {
  for (const [name, p] of Object.entries(CAMERAS)) for (const [what, scene] of [['grass', FOLIAGE], ['a sunset', SUNSET]]) for (const shot of [4800, 5500, 6500]) {
    const asShot = neutralFor(p, shot, 0), r = autoWhite(lit(p, 5500, 0, scene), asShot, p), own = whiteOf(p, asShot);
    assert.equal(r.weak, true, `${name}, ${what}, camera at ${shot} K: weak evidence (${r.share.toFixed(3)})`);
    assert.ok(Math.abs(r.kelvin - own.kelvin) <= 300, `${name}, ${what}: stayed at ${Math.round(r.kelvin)} K by the camera's ${Math.round(own.kelvin)} K`);
    assert.equal(r.found, null);
  }
});

test('a few neutrals in a colourful scene move it only part of the way', () => {
  const p = CAMERAS['made-up camera'], asShot = neutralFor(p, 4800, 0), own = whiteOf(p, asShot);
  const r = autoWhite(lit(p, 5800, 0, [...FOLIAGE, [[0.7, 0.7, 0.7], 150]]), asShot, p);
  assert.equal(r.weak, false);
  assert.ok(r.found && Math.abs(r.found.kelvin - 5800) <= 250, `the votes found the light (${Math.round(r.found?.kelvin)} K)`);
  assert.ok(r.kelvin > own.kelvin + 50 && r.kelvin < r.found.kelvin - 50, `and it moved part of the way: ${Math.round(own.kelvin)} → ${Math.round(r.kelvin)} K`);
});

test('clipped highlights and deep shadows are left out', () => {
  for (const p of Object.values(CAMERAS)) {
    const asShot = neutralFor(p, 4500, 0), grey = lit(p, 6000, 0, [...ramp, ...PATCHES]);
    // a blown-out sky: red and green clipped, blue not, so its colour says a blue light that is not there
    const blown = []; for (let i = 0; i < 2000; i++) blown.push(65535, 65535, 40000 + 2000 * rnd());
    // a deep shadow, many pixels, its colour all noise; and a dim green cast in it
    const deep = []; for (let i = 0; i < 3000; i++) deep.push(20 + 300 * rnd(), 20 + 300 * rnd(), 20 + 300 * rnd());
    const dim = lit(p, 2600, 0, [[[1, 1, 1], 1500]], 0.002, 0.008);
    const r = autoWhite([...blown, ...deep, ...dim, ...grey], asShot, p), plain = autoWhite(grey, asShot, p);
    assert.ok(Math.abs(r.kelvin - 6000) <= 250 && Math.abs(r.tint) <= 8, `found ${Math.round(r.kelvin)} K, ${r.tint.toFixed(1)} with them, ${Math.round(plain.kelvin)} K without`);
  }
  // the editing copy's own marks: a pixel flagged clipped takes its 3 × 3 sample with it
  const img = { width: 9, height: 9, proxy: new Uint16Array(81 * 4).map((_, i) => (i % 4 === 3 ? 0 : 1000)) };
  assert.equal(samples(img, 9).length, 9 * 3);
  img.proxy[(4 * 9 + 4) * 4 + 3] = 1;
  assert.equal(samples(img, 9).length, 8 * 3);
  assert.ok(CLIP > 60000 && CLIP < 65535);
});

test('the answer always lies in 2 500–10 000 K and within 40 of the locus', () => {
  const p = CAMERAS['made-up camera'];
  for (const [kelvin, tint, shot] of [[2000, 0, 2300], [1800, 30, 2500], [13000, 0, 11000], [20000, -20, 15000], [5500, 60, 5500], [5500, -70, 5500], [3000, 0, 15000]]) {
    const r = autoWhite(lit(p, kelvin, tint, [...ramp, ...PATCHES]), neutralFor(p, shot, 0), p);
    assert.ok(inside(r), `light ${kelvin} K / ${tint}, camera at ${shot} K: answered ${Math.round(r.kelvin)} K, ${r.tint.toFixed(1)}`);
  }
  for (let k = 0; k < 40; k++) {   // made-up scenes of random colours and lights, the camera anywhere
    const scene = Array.from({ length: 6 }, () => [[rnd(), rnd(), rnd()], 50]), r = autoWhite(lit(p, 1500 + 20000 * rnd(), 120 * (rnd() - 0.5), scene), neutralFor(p, 2000 + 13000 * rnd(), 80 * (rnd() - 0.5)), p);
    assert.ok(inside(r), `${Math.round(r.kelvin)} K, ${r.tint.toFixed(1)}`);
  }
  assert.ok(inside(autoWhite([], neutralFor(p, 20000, 0), p)), 'and with nothing at all to go by');
});
