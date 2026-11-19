// Settings on the registry (FEEL.md "Settings"): every setting Astra had keeps its id and where it is
// stored (nothing the owner set is lost, a backup keeps its shape), areas list only when they have
// rows, and the accent keeps its contrast whatever colour is chosen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { define, rows, row, areas, readSetting, resetArea } from '../frontend/astra/src/settings/registry.js';
import '../frontend/astra/src/settings/general.js';
import '../frontend/astra/src/settings/appearance.js';
import '../frontend/astra/src/settings/motion.js';
import { contrast, readableAccent, onColour } from '../frontend/astra/src/settings/colour.js';
import { SWATCHES } from '../frontend/astra/src/settings/appearance.js';

test('every setting from before is a row with its old id, where and default', () => {
  const before = { hero: ['astra', true], showCatalogType: ['astra', true], posterWidth: ['astra', 126], posterRadius: ['astra', 12], recentSearches: ['astra', true],
    openSubtitles: ['astra', true], readyAhead: ['astra', true], findIntros: ['astra', true], skipLookup: ['astra', false],
    gestures: ['player', true], holdSpeed: ['player', 2], pauseOverlay: ['player', true], aspect: ['player', 'fit'], orientation: ['player', 'auto'], autoPip: ['player', true], dataSaver: ['player', 'auto'] };
  for (const [id, [where, value]] of Object.entries(before)) assert.deepEqual([row(id)?.where, row(id)?.default], [where, value], id);
});

test('a stored value is read as it was; a damaged one reads as the default; reset puts a page back', () => {
  const app = { settings: { posterWidth: 134, hero: false, accent: 'red' }, saveSettings(p) { Object.assign(this.settings, p); }, store: { get: () => ({}), set() {} } };
  assert.equal(readSetting(app, 'posterWidth'), 134);
  assert.equal(readSetting(app, 'hero'), false);
  assert.equal(readSetting(app, 'accent'), '#f5f5f5', 'not a colour: the default');
  resetArea(app, 'home');
  assert.equal(app.settings.hero, true);
  assert.equal(app.settings.posterWidth, 134, 'another page is left alone');
});

test('areas: described ones with rows or a page of their own, then any other area rows name, in order', () => {
  const ids = () => areas().map((a) => a.id);
  assert.deepEqual(ids(), ['appearance', 'motion', 'home', 'player', 'playback', 'addons', 'data', 'about']);
  assert.ok(!ids().includes('streams'), 'no rows yet: not listed');
  define([{ id: 't-sort', area: 'streams', title: 'Starting sort', kind: 'choice', where: 'astra', options: [['addon', 'As sent']], default: 'addon' },
    { id: 't-extra', area: 'invented-area', title: 'Invented', kind: 'switch', where: 'device', default: false }]);
  assert.deepEqual(ids(), ['appearance', 'motion', 'home', 'streams', 'player', 'playback', 'addons', 'data', 'about', 'invented-area']);
  assert.equal(areas().at(-1).title, 'Invented area');
  assert.deepEqual(rows('streams').map((r) => r.id), ['t-sort']);
});

test('the accent: every swatch reads on the page; a dark custom colour is lightened until it does; text on it reads', () => {
  for (const [hex] of SWATCHES) {
    assert.equal(readableAccent(hex), hex, hex);
    assert.ok(contrast(hex, onColour(hex)) >= 4.5, `text on ${hex}`);
  }
  const dark = readableAccent('#202080');
  assert.notEqual(dark, '#202080');
  assert.ok(contrast(dark, '#0d0d0d') >= 4.5);
  assert.ok(contrast(readableAccent('#202080', '#000000'), '#000000') >= 4.5);
  assert.equal(onColour('#f5f5f5'), '#111111');
  assert.equal(onColour('#3a0ca3'), '#ffffff');
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
});

test('what start-up applies (settings/look.js) agrees with the rows: same place, same default, same values', async () => {
  const { LOOK, lookSetting } = await import('../frontend/astra/src/settings/look.js');
  for (const [id, [where, def, ok]] of Object.entries(LOOK)) {
    const r = row(id);
    assert.deepEqual([r.where, r.default], [where, def], id);
    if (Array.isArray(r.options)) for (const [v] of r.options) assert.ok(ok(v), `${id}: ${v}`);
  }
  const app = { settings: { accent: '#123456', navStyle: 'sideways' }, store: { get: () => ({ motion: 'off' }) } };
  assert.deepEqual([lookSetting(app, 'accent'), lookSetting(app, 'navStyle'), lookSetting(app, 'motion'), lookSetting(app, 'haptics')], ['#123456', 'floating', 'off', 'subtle']);
});
