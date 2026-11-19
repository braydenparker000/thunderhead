// Astra's browse screens, the pure parts: the art host's small copies (app/content.js artAt), a picture's
// colours read from its pixels and the title's tint made readable (ui/art.js), and Settings › Browse's
// rows (settings/browse.js) with their designed defaults, each changing what it says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artAt } from '../frontend/astra/src/app/content.js';
import { readPixels, tintFrom, contrast } from '../frontend/astra/src/ui/art.js';
import { rows, readSetting } from '../frontend/astra/src/settings/registry.js';
import '../frontend/astra/src/settings/browse.js';

test('artAt: the small copy where the host offers one, nothing elsewhere', () => {
  assert.equal(artAt('https://images.metahub.space/poster/medium/tt0000001/img'), 'https://images.metahub.space/poster/small/tt0000001/img');
  assert.equal(artAt('https://images.metahub.space/background/large/tt0000001/img', 'medium'), 'https://images.metahub.space/background/medium/tt0000001/img');
  assert.equal(artAt('https://image.tmdb.org/t/p/w500/invented.jpg'), 'https://image.tmdb.org/t/p/w92/invented.jpg');
  assert.equal(artAt('https://image.tmdb.org/t/p/original/invented.jpg', 'medium'), 'https://image.tmdb.org/t/p/w342/invented.jpg');
  assert.equal(artAt('https://img.example/poster.jpg'), null);
  assert.equal(artAt('http://images.metahub.space/poster/small/tt1/img'), null, 'https only');
  assert.equal(artAt(undefined), null);
});

/** An RGBA picture `w` wide whose rows are the given colours. */
const picture = (w, rowsOf) => rowsOf.flatMap((c) => Array.from({ length: w }, () => [...c, 255])).flat();

test('readPixels: four bands top to bottom, their average, and the most vivid colour (none for greys)', () => {
  const red = [200, 30, 30], dark = [10, 10, 10];
  const out = readPixels(picture(2, [red, red, red, red, dark, dark, dark, dark]), 2);
  assert.deepEqual(out.bands, ['#c81e1e', '#c81e1e', '#0a0a0a', '#0a0a0a']);
  assert.equal(out.vivid, '#c81e1e');
  assert.match(out.average, /^#[0-9a-f]{6}$/);
  assert.equal(readPixels(picture(2, [[90, 90, 90], [140, 140, 140], [90, 90, 90], [20, 20, 20]]), 2).vivid, null);
  const clear = readPixels(new Array(16).fill(0), 2);
  assert.equal(clear.average, '#1a1a1a', 'a transparent picture: the surface colour');
});

test('tintFrom: a calm colour that dark text reads on at 4.5:1 or better', () => {
  for (const c of ['#ff0000', '#0a2a6a', '#203020', '#e0c020', '#5500aa', '#00ffcc']) {
    const t = tintFrom(c);
    assert.match(t, /^#[0-9a-f]{6}$/);
    assert.ok(contrast(t, '#111111') >= 4.5, `${c} -> ${t}`);
  }
  assert.equal(tintFrom(null), null);
});

test('Settings › Browse: every row with its designed default, and values it refuses', () => {
  const byId = Object.fromEntries([...rows('appearance'), ...rows('home')].map((r) => [r.id, r]));
  assert.deepEqual(Object.fromEntries(Object.values(byId).map((r) => [r.id, r.default])), {
    posterTitles: true, posterYears: true, artPlaceholder: 'blur', rowEntrance: true, rowSnap: true, heroTurn: true, heroSeconds: 8, cwSize: 'standard', tint: true, spoilerBlur: false,
  });
  for (const r of Object.values(byId)) assert.equal(r.where, 'astra', `${r.id} travels with the owner`);
  const app = { settings: { heroSeconds: 99, cwSize: 'huge', spoilerBlur: true } };
  assert.equal(readSetting(app, 'heroSeconds'), 8, 'out of range: the default');
  assert.equal(readSetting(app, 'cwSize'), 'standard');
  assert.equal(readSetting(app, 'spoilerBlur'), true);
});

test('Settings › Browse: a change says so on the root, and Colour from artwork gives the app tintOf', () => {
  const classes = new Set();
  globalThis.document = { documentElement: { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } } };
  try {
    const row = (id) => [...rows('appearance'), ...rows('home')].find((r) => r.id === id);
    row('posterTitles').apply(false); row('posterYears').apply(false); row('rowSnap').apply(false); row('cwSize').apply('large'); row('artPlaceholder').apply('plain');
    assert.deepEqual([...classes].sort(), ['b-art-plain', 'b-cw-large', 'b-no-snap', 'b-no-titles', 'b-no-years']);
    row('posterTitles').apply(true); row('artPlaceholder').apply('colour');
    assert.ok(!classes.has('b-no-titles') && classes.has('b-art-flat') && !classes.has('b-art-plain'));
    const app = { stack: [] };
    row('tint').apply(false, app);
    assert.equal(app.tintOf({ poster: 'https://image.tmdb.org/t/p/w500/x.jpg' }), null, 'off: no tint');
    row('tint').apply(true, app);
    assert.equal(typeof app.tintOf, 'function');
  } finally { delete globalThis.document; }
});
