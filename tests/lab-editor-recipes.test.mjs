// A Fujifilm recipe laid on the editor's controls (frontend/lab/editor/app/recipe-map.js), without a browser: the
// film simulation is the profile of that name; tone, colour, sharpness, noise reduction, clarity and grain land
// on their dials; a white balance shift moves the shot's own temperature and tint; and what is only near, or not
// here at all, is said.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edit, filmLabel, profileFor, unpack } from '../frontend/lab/editor/app/recipe-map.js';

test('each film simulation is the profile of that name', () => {
  const pairs = { 'Reala Ace': 'REALA ACE', 'Classic Chrome': 'CLASSIC CHROME', 'Classic Negative': 'CLASSIC Neg', 'Classic Neg.': 'CLASSIC Neg', 'Nostalgic Neg.': 'NOSTALGIC Neg', 'PRO Neg. Hi': 'Pro Neg Hi',
    'PRO Neg. Std': 'Pro Neg Std', 'Eterna': 'ETERNA', 'Eterna Bleach Bypass': 'BLEACH BYPASS', 'Velvia': 'Velvia', 'Astia': 'ASTIA', 'Provia': 'PROVIA', 'Provia/STD': 'PROVIA', 'Adobe Standard': '', 'Acros+R': 'ACROS',
    'Monochrome+Ye': 'Monochrome', 'Sepia': 'Sepia', 'Something new': '' };
  for (const [film, label] of Object.entries(pairs)) assert.equal(filmLabel(film), label, film);
});

test('the profile a film simulation is, among a photo\'s own: its family whatever the label says, its colour filter where there is one', () => {
  const mine = ['Adobe Color', 'Adobe Standard', 'PROVIA', 'Velvia', 'ASTIA', 'CLASSIC CHROME', 'REALA ACE', 'Pro Neg Hi', 'Pro Neg Std', 'CLASSIC Neg', 'NOSTALGIC Neg', 'ETERNA', 'BLEACH BYPASS', 'ACROS', 'Monochrome', 'Sepia'];
  const pick = (film, labels = mine) => labels[profileFor(film, labels)] ?? null;
  assert.deepEqual(['Provia/STD', 'Classic Negative', 'Eterna', 'Eterna Bleach Bypass', 'PRO Neg. Std', 'Acros+R', 'Monochrome (+Y, +R, +G)', 'Any (See Below)', 'Reala Ace'].map((f) => pick(f)),
    ['PROVIA', 'CLASSIC Neg', 'ETERNA', 'BLEACH BYPASS', 'Pro Neg Std', 'ACROS', 'Monochrome', null, 'REALA ACE']);
  // another set of profiles, named the long way and with the filters
  const long = ['Adobe Standard', 'PROVIA/STANDARD', 'ETERNA BLEACH BYPASS', 'ETERNA/CINEMA', 'ACROS+G FILTER', 'ACROS+R FILTER', 'ACROS', 'MONOCHROME+Ye FILTER'];
  assert.deepEqual(['Provia', 'Eterna', 'Eterna Bleach Bypass', 'Acros+R', 'Acros', 'Acros (+Y, +R, +G)', 'Monochrome+Y', 'Monochrome', 'Velvia'].map((f) => pick(f, long)),
    ['PROVIA/STANDARD', 'ETERNA/CINEMA', 'ETERNA BLEACH BYPASS', 'ACROS+R FILTER', 'ACROS', 'ACROS', 'MONOCHROME+Ye FILTER', 'MONOCHROME+Ye FILTER', null]);
});

test('a recipe lands on the dials, and says what is only near', () => {
  const r = { filmSimulation: 'Reala Ace', dynamicRange: 'DR200', grain: { strength: 'Weak', size: 'Small' }, colorChrome: 'Strong', colorChromeBlue: 'Off',
    whiteBalance: { mode: 'Auto', kelvin: null, red: 1, blue: -2 }, highlight: -1, shadow: -1, color: 4, sharpness: -1, noiseReduction: -4, clarity: -2, exposureCompensation: { min: 0, max: 2 / 3 }, monochromatic: null };
  const e = edit(r, { shotWb: [5500, 10], noise0: 20 });
  assert.equal(e.film, 'REALA ACE');
  assert.deepEqual([e.values.Highlights, e.values.Whites, e.values.Shadows, e.values.Blacks], [-22, -4, 12, 4], 'softer highlights (and DR200), lifted shadows');
  assert.deepEqual([e.values.Saturation, e.values.Sharpening, e.values.Noise, e.values.Clarity, e.values.Grain], [24, 32, 0, -16, 18]);
  assert.deepEqual([e.values['Mix Red Lum'], e.values['Mix Green Lum'], e.values['Mix Blue Lum']], [-12, -12, 0]);
  assert.equal(e.wb, 'Custom');
  assert.ok(e.values.Temp > 5500 && e.values.Temp < 6000 && e.values.Temp % 50 === 0, `red up and blue down is warmer: ${e.values.Temp}`);
  assert.equal(e.values.Tint, 9, 'red +1 and blue −2: a little towards green');
  assert.deepEqual(e.left.map((s) => s.split(':')[0]), ['Dynamic Range DR200', 'Color Chrome', 'Grain Small', 'Exposure compensation']);
});

test('white balance: a light or a temperature of the recipe, else the shot; no shift and no setting leaves it As shot', () => {
  const shot = { shotWb: /** @type {[number, number]} */ ([4300, 22]), noise0: 0 };
  assert.deepEqual([edit({ whiteBalance: { mode: 'Auto', red: 0, blue: 0 } }, shot).wb, 'Temp' in edit({ whiteBalance: { mode: 'Auto', red: 0, blue: 0 } }, shot).values], ['As shot', false]);
  const day = edit({ whiteBalance: { mode: 'Daylight', red: 0, blue: 0 } }, shot);
  assert.deepEqual([day.wb, day.values.Temp, day.values.Tint], ['Custom', 5500, 10]);
  const k = edit({ whiteBalance: { mode: 'Kelvin', kelvin: 6300, red: -2, blue: 4 } }, shot);
  assert.ok(k.values.Temp < 6300 && k.values.Tint === 13, `blue up is cooler, and red less than blue a little magenta: ${k.values.Temp}, ${k.values.Tint}`);
  const cool = edit({ whiteBalance: { mode: 'Auto', red: -9, blue: 9 } }, shot), warm = edit({ whiteBalance: { mode: 'Auto', red: 9, blue: -9 } }, shot);
  assert.ok(cool.values.Temp < 4300 && warm.values.Temp > 4300 && cool.values.Temp >= 2000 && warm.values.Temp <= 15000);
});

test('nothing set is nothing moved; a hard recipe stays inside every dial', () => {
  const none = edit({}, { shotWb: [5500, 10], noise0: 25 });
  assert.deepEqual([none.values.Highlights, none.values.Shadows, none.values.Saturation, none.values.Sharpening, none.values.Noise, none.values.Clarity, none.values.Grain, none.wb, none.film, none.left], [0, 0, 0, 40, 25, 0, 0, 'As shot', '', []]);
  const hard = edit({ highlight: 4, shadow: 4, color: 4, sharpness: 4, noiseReduction: 4, clarity: 5, grain: { strength: 'Strong', size: 'Large' }, colorChrome: 'Strong', colorChromeBlue: 'Strong', dynamicRange: 'DR400', filmSimulation: 'Acros+R', monochromatic: { wc: 2, mg: -1 } }, { shotWb: [5500, 10], noise0: 90 });
  for (const [k, v] of Object.entries(hard.values)) assert.ok(v >= -150 && v <= 15000 && Number.isFinite(v), `${k} = ${v}`);
  assert.deepEqual([hard.values.Noise, hard.values.Grain, hard.values['Mix Blue Lum'], hard.film], [100, 44, -16, 'ACROS']);
  assert.ok(hard.left.some((s) => /toning/.test(s)) && hard.left.some((s) => /colour filter/.test(s)));
  // D-Range Priority takes the place of the two tones and of Dynamic Range; DR Auto is the camera's choice at the shot, nothing here
  const drp = edit({ dRangePriority: 'Strong', highlight: 2, shadow: 2, dynamicRange: '400' }, { shotWb: [5500, 10] });
  assert.deepEqual([drp.values.Highlights, drp.values.Shadows, drp.values.Whites, drp.values.Blacks, drp.left.map((s) => s.split(':')[0])], [-35, 25, 0, 0, ['D-Range Priority Strong']]);
  const auto = edit({ dynamicRange: 'Auto', highlight: -1.5 }, { shotWb: [5500, 10] });
  assert.deepEqual([auto.values.Highlights, auto.values.Whites, auto.left], [-18, -6, []]);
});

test('the list the card reads: every recipe has a name, a group and settings that land inside the dials; no address in it', async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('../frontend/lab/editor/assets/weekly-fuji-recipes.json', import.meta.url), 'utf8'), doc = JSON.parse(text);
  assert.ok(!/https?:/.test(text), 'the pages are kept as paths on the source site, never as addresses (tests/site.test.mjs)');
  const recipes = unpack(doc);
  assert.ok(recipes.length >= 390 && /Ritchie Roesch/.test(doc.author) && doc.source === 'fujixweekly.com');
  assert.equal(new Set(recipes.map((r) => r.id)).size, recipes.length, 'each has its own id');
  // one the page was read for by hand: 1960 Chrome (Eterna Bleach Bypass, DR400, grain Strong Large, Fluorescent 1 −2 Red −4 Blue, …)
  const one = recipes.find((r) => r.id === 'x-trans-v-1960-chrome');
  assert.deepEqual(one.set, { filmSimulation: 'Eterna Bleach Bypass', dynamicRange: 400, dRangePriority: null, grain: { strength: 'Strong', size: 'Large' }, colorChrome: 'Strong', colorChromeBlue: 'Off',
    whiteBalance: { mode: 'Fluorescent 1', kelvin: null, red: -2, blue: -4 }, highlight: -2, shadow: -1, color: 2, sharpness: -1, noiseReduction: -4, clarity: -2, exposureCompensation: { min: 0.33, max: 1 }, monochromatic: null });
  const groups = new Map();
  for (const r of recipes) {
    assert.ok(r.name && r.name === r.name.trim() && r.name.length <= 60 && r.sensor && /^[a-z0-9-]+$/.test(r.id) && typeof r.page === 'string' && !r.page.startsWith('/'), JSON.stringify(r).slice(0, 120));
    assert.ok(filmLabel(r.set.filmSimulation) || /^any/i.test(r.set.filmSimulation), `${r.name}: ${r.set.filmSimulation}`);
    const e = edit(r.set, { shotWb: [5500, 10], noise0: 20 });
    for (const [k, v] of Object.entries(e.values)) {
      const [lo, hi] = k === 'Temp' ? [2000, 15000] : k === 'Tint' ? [-150, 150] : ['Sharpening', 'Noise', 'Grain'].includes(k) ? [0, 100] : [-100, 100];
      assert.ok(Number.isFinite(v) && v >= lo && v <= hi, `${r.name}: ${k} = ${v}`);
    }
    groups.set(r.sensor, (groups.get(r.sensor) || 0) + 1);
  }
  assert.equal([...groups.keys()][0], 'X-Trans V', "the owner's camera's sensor comes first");
  assert.ok(groups.get('X-Trans V') >= 90 && groups.get('X-Trans IV') >= 190);
});
