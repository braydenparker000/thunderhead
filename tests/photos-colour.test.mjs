// Photos' colour pipeline in Node (PHOTOS.md, the colour pipeline), on synthetic numbers only: the camera
// matrix fit (frontend/apps/photos/edit/fit.js) finds a known matrix through vignetting and a camera tone curve
// applied on luminance, refuses a black-and-white JPEG and too few cells, leaves clipped and edge cells out,
// and the baseline exposure finds a known gain; the base tone keeps mid-grey and is monotonic; a JPEG's
// size is read from its frame header.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseline, fitMatrix, inverse, jpegSize, mul, pairs } from '../frontend/apps/photos/edit/fit.js';
import { BASE_TONE } from '../frontend/apps/photos/edit/fields.js';
import { toneLut } from '../frontend/apps/photos/edit/uniforms.js';

const TRUE = [[1.62, -0.48, -0.14], [-0.21, 1.58, -0.37], [0.04, -0.46, 1.42]];
const apply = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const Y = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
/** A seeded generator, so the cells are the same every run. */
function rand(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

/** Cells of camera RGB and the "camera JPEG" made from them: the true matrix, a gain, vignetting and an S
 * curve on luminance (each cell scaled, its chromaticity kept). */
function scene(n, { gain = 1, mono = false } = {}) {
  const r = rand(7), c = [], l = [];
  for (let i = 0; i < n; i++) {
    const grey = 0.02 + 0.3 * r(), cam = [0, 1, 2].map(() => grey * (0.75 + 0.5 * r()));
    const lin = apply(TRUE, cam).map((v) => v * gain);
    const y = Y(lin), vignette = 0.7 + 0.3 * r(), curved = (y ** 0.8 / (y ** 0.8 + 0.25)) * 1.2;
    const out = mono ? [1, 1, 1].map(() => curved * vignette) : lin.map((v) => (v * curved * vignette) / y);
    c.push(cam);
    l.push(out);
  }
  return { c, l };
}

test('the fit finds a known matrix through vignetting and a camera curve on luminance', () => {
  const { c, l } = scene(3000);
  const f = fitMatrix(c, l);
  assert.equal(f.ok, true, f.why);
  const worst = Math.max(...f.matrix.flat().map((v, i) => Math.abs(v - TRUE.flat()[i])));
  assert.ok(worst < 0.03, `worst coefficient off by ${worst}`);
  for (const row of f.matrix) assert.ok(Math.abs(row[0] + row[1] + row[2] - 1) < 1e-9, 'white kept white');
  assert.ok(f.after < f.before * 0.2, `${f.after} against ${f.before}`);
});

test('the fit refuses a black-and-white JPEG and too few cells', () => {
  const mono = scene(3000, { mono: true });
  assert.match(fitMatrix(mono.c, mono.l).why, /too little colour/);
  const few = scene(200);
  assert.equal(fitMatrix(few.c, few.l).ok, false);
});

test('the baseline exposure puts the median cell where the camera has it', () => {
  // no curve: the JPEG is the scene times 2^1.5
  const r = rand(3), c = [], l = [];
  for (let i = 0; i < 2000; i++) { const g = 0.01 + 0.2 * r(), cam = [0, 1, 2].map(() => g * (0.8 + 0.4 * r())); c.push(cam); l.push(apply(TRUE, cam).map((v) => v * 2 ** 1.5)); }
  assert.ok(Math.abs(baseline(TRUE, c, l) - 1.5) < 0.01);
  assert.equal(baseline(TRUE, c, l.map((v) => v.map((x) => x * 2 ** 9))), 3, 'held at +3 EV');
});

test('cells: clipped and edge cells stay out of the fit', () => {
  const gw = 8, gh = 8, cam = new Float64Array(gw * gh * 3).fill(0.1), max = new Float32Array(gw * gh).fill(0.2), rgba = new Uint8Array(gw * gh * 4).fill(128);
  const inner = (gw - 2) * (gh - 2);
  assert.equal(pairs(cam, max, rgba, gw, gh).c.length, inner);
  max[3 * gw + 3] = 0.99; // a clipped pixel in one cell
  assert.equal(pairs(cam, max, rgba, gw, gh).c.length, inner - 1);
  for (let ch = 0; ch < 3; ch++) rgba[(5 * gw + 5) * 4 + ch] = 40; // an edge in the JPEG: the cell and its four neighbours go
  assert.equal(pairs(cam, max, rgba, gw, gh).c.length, inner - 1 - 5);
});

test('matrix helpers: the inverse undoes the matrix', () => {
  const p = mul(TRUE, inverse(TRUE));
  p.forEach((row, i) => row.forEach((v, j) => assert.ok(Math.abs(v - (i === j ? 1 : 0)) < 1e-12)));
});

test('the base tone keeps mid-grey, rises monotonically, and Contrast pivots there', () => {
  const half = (h) => { const e = (h >> 10) & 31, m = h & 1023; return e ? 2 ** (e - 15) * (1 + m / 1024) : m * 2 ** -24; };
  const at = (lut, lin) => half(lut[Math.round(((Math.log2(lin) + 12) / 14) * 1023) * 4]) * 255;
  for (const recipe of [{}, { Contrast2012: 100 }, { Contrast2012: -100 }]) {
    const lut = toneLut(recipe, true);
    assert.ok(Math.abs(at(lut, BASE_TONE.midGrey) - 118) < 1.5, `mid-grey at ${at(lut, BASE_TONE.midGrey)} for ${JSON.stringify(recipe)}`);
    for (let i = 4; i < 1024 * 4; i += 4) assert.ok(half(lut[i]) >= half(lut[i - 4]), `monotonic at ${i / 4}`);
  }
  const pts = BASE_TONE.curve;
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i][0] > pts[i - 1][0] && pts[i][1] > pts[i - 1][1]);
  assert.ok(pts[1][1] > pts[1][0], 'the toe is lifted');
});

test("a JPEG's size comes from its frame header", () => {
  const app0 = [0xff, 0xe0, 0, 16, ...Array(14).fill(0)];
  const sof = [0xff, 0xc0, 0, 17, 8, 0x0b, 0x80, 0x11, 0x40, 3];
  assert.deepEqual(jpegSize(new Uint8Array([0xff, 0xd8, ...app0, ...sof, ...Array(12).fill(0)])), [4416, 2944]);
  assert.equal(jpegSize(new Uint8Array([0xff, 0xd8, 0, 0])), null);
});
