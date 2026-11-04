// The editor's recipe table on the phone (frontend/apps/photos/edit/fields.js) is the contract's
// (shared/contract/photos-recipe.ts): every control's range and default, the curves; the canonical
// form drops defaults; the tone lookup is monotonic and its ends fixed for a JPEG as shot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalRecipe, RECIPE_CURVES, RECIPE_NUMBERS, RECIPE_WB } from '../shared/contract/photos-recipe.ts';
import { CURVES, NUMBERS, PANELS } from '../frontend/apps/photos/edit/fields.js';
import { toneLut } from '../frontend/apps/photos/edit/uniforms.js';
import { gainsFor, neutralFor, tempTintOf } from '../frontend/apps/photos/edit/color.js';

test('the phone has the contract’s ranges and defaults, and every slider names a real key', () => {
  for (const [k, v] of Object.entries(RECIPE_NUMBERS)) assert.deepEqual(NUMBERS[k], [...v], k);
  assert.deepEqual(NUMBERS.Temperature.slice(0, 2), [...RECIPE_WB.Temperature]);
  assert.deepEqual(NUMBERS.Tint.slice(0, 2), [...RECIPE_WB.Tint]);
  assert.deepEqual(CURVES, [...RECIPE_CURVES]);
  for (const p of PANELS) for (const t of p.tools) if ('key' in t) assert.ok(NUMBERS[t.key], `${p.id}: ${t.key}`);
});

test('canonical recipes drop defaults, as-shot white balance and straight curves', () => {
  assert.deepEqual(canonicalRecipe({ Exposure2012: 0, Contrast2012: 10, WhiteBalance: 'As Shot', Temperature: 5000, ToneCurvePV2012: [[0, 0], [255, 255]] }), { Contrast2012: 10 });
});

test('the tone lookup rises and a JPEG as shot keeps black and white', () => {
  const half = (h) => { const e = (h >> 10) & 31, m = h & 1023; return e ? 2 ** (e - 15) * (1 + m / 1024) : m / 2 ** 24; };
  for (const raw of [true, false]) {
    const lut = toneLut({}, raw);
    for (let i = 4; i < lut.length; i += 4) assert.ok(half(lut[i]) >= half(lut[i - 4]) - 1e-3, `rises at ${i / 4}`);
  }
  const j = toneLut({}, false);
  assert.ok(half(j[0]) < 0.02 && half(j[j.length - 4]) > 0.98);
});

test('white balance: as shot is no change, and the picker makes a colour neutral', () => {
  const d65 = [0.3127, 0.329];
  const s = tempTintOf(d65);
  assert.ok(Math.abs(s.temperature - 6500) <= 150, JSON.stringify(s));
  const g = gainsFor(d65, s.temperature, s.tint);
  for (const v of g) assert.ok(Math.abs(v - 1) < 0.05, JSON.stringify(g));
  const warm = [0.5, 0.4, 0.25];
  const n = neutralFor(d65, warm);
  const k = gainsFor(d65, n.temperature, n.tint).map((x, i) => x * warm[i]);
  assert.ok(Math.abs(k[0] / k[1] - 1) < 0.08 && Math.abs(k[2] / k[1] - 1) < 0.08, JSON.stringify({ n, k }));
});
