// The pure parts of Astra's motion and settings (FEEL.md): the motion level, haptic patterns, the
// sheet's dismiss rule, the feel report's text, the durations matching tokens.css, and the
// settings registry's rows, search and storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { T, levelFor, hapticPattern, setHaptics, tick } from '../frontend/astra/src/ui/motion-core.js';
import { shouldDismiss, resist } from '../frontend/astra/src/ui/sheet-motion.js';
import { cleanName, reportText, timed, feelEntries, clearFeelLog } from '../frontend/astra/src/ui/feel-log.js';
import { define, rows, row, find, valid, readSetting, writeSetting } from '../frontend/astra/src/settings/registry.js';
import '../frontend/astra/src/settings/motion.js';

const TOKENS = readFileSync(new URL('../frontend/astra/src/styles/tokens.css', import.meta.url), 'utf8');

test('the level: System follows the phone, a choice wins over it', () => {
  assert.equal(levelFor('system', false), 'full');
  assert.equal(levelFor('system', true), 'reduced');
  assert.equal(levelFor('full', true), 'full');
  assert.equal(levelFor('reduced', false), 'reduced');
  assert.equal(levelFor('off', false), 'off');
  assert.equal(levelFor('nonsense', false), 'full');
});

test('haptics: the patterns of FEEL.md, Full-only ticks, Off silent', () => {
  assert.equal(hapticPattern('select', 'subtle'), 8);
  assert.equal(hapticPattern('toggle', 'subtle'), 10);
  assert.equal(hapticPattern('lift', 'full'), 12);
  assert.deepEqual(hapticPattern('success', 'subtle'), [8, 40, 8]);
  assert.equal(hapticPattern('warn', 'subtle'), 20);
  assert.equal(hapticPattern('snap', 'subtle'), null);
  assert.equal(hapticPattern('snap', 'full'), 4);
  assert.equal(hapticPattern('edge', 'full'), 6);
  assert.equal(hapticPattern('select', 'off'), null);
  assert.equal(hapticPattern('unknown', 'full'), null);
  setHaptics('off');
  assert.equal(tick('select'), false);
  setHaptics('subtle');
});

test('a sheet resists upward by a fifth and is dismissed past 30% or by a fling over 0.5 px/ms', () => {
  assert.equal(resist(50), 50);
  assert.equal(resist(-50), -10);
  assert.equal(shouldDismiss({ offset: 121, height: 400, velocity: 0 }), true);
  assert.equal(shouldDismiss({ offset: 119, height: 400, velocity: 0.2 }), false);
  assert.equal(shouldDismiss({ offset: 20, height: 400, velocity: 0.6 }), true);
  assert.equal(shouldDismiss({ offset: 200, height: 400, velocity: -1 }), true, 'past the line it goes, whatever the last flick');
  assert.equal(shouldDismiss({ offset: 10, height: 400, velocity: -1 }), false);
});

test('durations in ui/motion-core.js are the ones tokens.css gives', () => {
  for (const [name, ms] of Object.entries({ press: T.press, fast: T.fast, normal: T.normal, screen: T.screen, travel: T.travel, sheet: T.sheet, lively: T.lively }))
    assert.match(TOKENS, new RegExp(`--t-${name}: ${ms}ms;`), name);
  assert.ok(Math.max(...Object.values(T)) <= 450, 'nothing takes longer than 450 ms');
});

test('the feel log: names are cleaned, runs are timed, and the report is plain numbers and names', async () => {
  clearFeelLog();
  assert.equal(cleanName('Push: Details/Some Title?'), 'push:-details-some-title-');
  timed('test:sync', () => 1);
  await timed('test:async', () => ({ finished: Promise.resolve({ cancelled: true }) })).finished;
  const list = feelEntries();
  assert.deepEqual(list.map((e) => [e.name, e.interrupted]), [['test:sync', false], ['test:async', true]]);
  const text = reportText([{ name: 'push:details', ms: 330, frames: 20, worstGap: 18, interrupted: false }, { name: 'push:details', ms: 350, frames: 21, worstGap: 40, interrupted: true }],
    { motion: 'full (system)', haptics: 'subtle' }, { hz: 90, ms: 11.1 });
  assert.match(text, /^Astra feel report · screen 90 Hz \(median frame 11\.1 ms over a quiet second\)\nmotion full-system- · haptics subtle\n2 transitions\n/);
  assert.match(text, /^push:details\s+2\s+330\s+350\s+60\s+40\s+1$/m);
  assert.match(text, /^push:details 350 21 40 cut$/m);
  assert.doesNotMatch(text, /https?:/);
  // A press ends at its release: it is in the table only when it went badly; the screen not measured yet says so.
  const press = (worstGap) => ({ name: 'press', ms: 60, frames: 5, worstGap, interrupted: false });
  assert.doesNotMatch(reportText([press(20), press(44)]), /^press {20,}/m);
  assert.match(reportText([press(20), press(51)]), /^press {20,}2\s/m);
  assert.match(reportText([]), /^Astra feel report · screen not measured yet\n/);
});

test('the registry: rows by area, a search over every row, values checked, kept where they live', () => {
  assert.deepEqual(rows('motion').map((r) => r.id), ['motion', 'haptics']);
  assert.equal(row('motion').default, 'system');
  assert.deepEqual(find('haptic').map((r) => r.id), ['haptics']);
  assert.deepEqual(find('reduced').map((r) => r.id), ['motion'], 'an option label is searched');
  assert.deepEqual(find(''), []);
  assert.throws(() => define([{ id: 'motion', area: 'x', title: 'Again', kind: 'switch', where: 'astra', default: true }]), /twice/);
  assert.throws(() => define([{ id: 't-bad', area: 'x', title: 'Bad', kind: 'choice', where: 'astra', options: [['a', 'A']], default: 'b' }]), /default/);
  define([{ id: 't-size', area: 'test', title: 'Size', kind: 'steps', where: 'astra', options: { min: 1, max: 3, step: 1 }, default: 2 },
    { id: 't-on', area: 'test', title: 'On', kind: 'switch', where: 'astra', default: true }]);
  assert.equal(valid(row('t-size'), 4), false);
  assert.equal(valid(row('t-on'), 'yes'), false);
  // A tiny app: app.settings and saveSettings for 'astra', the store's 'device' key for 'device'.
  const kept = {};
  const app = { settings: {}, saveSettings(p) { Object.assign(this.settings, p); }, store: { get: (k, f) => kept[k] ?? f, set: (k, v) => { kept[k] = v; } } };
  assert.equal(readSetting(app, 'motion'), 'system');
  writeSetting(app, 'motion', 'reduced');
  assert.deepEqual(kept.device, { motion: 'reduced' });
  assert.equal(readSetting(app, 'motion'), 'reduced');
  writeSetting(app, 'haptics', 'off');
  assert.deepEqual(kept.device, { motion: 'reduced', haptics: 'off' }, "a device row keeps the others'");
  assert.throws(() => writeSetting(app, 'motion', 'wild'), /cannot hold/);
  app.settings['t-size'] = 9; // a damaged saved value reads as the default
  assert.equal(readSetting(app, 't-size'), 2);
  writeSetting(app, 't-size', 3);
  assert.equal(app.settings['t-size'], 3);
  setHaptics('subtle');
});
