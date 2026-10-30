// The phone's registries against the contract (EXTENDING.md rules 3 and 9): every app has a ring
// entry with its colour and icon, deep links stay inside a shipped app, every device verb the
// Worker can queue has an executor here (anything else is answered unsupported_verb), and every
// surface kind and version is drawn by a renderer or falls back to the generic card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APPS, MEMORY, SURFACE_KINDS, VERBS } from '../frontend/th/contract.js';
import { GROUPS, groupOf, odds, SOURCES, sourceLabel, shelfOf } from '../frontend/th/registry/memory.js';
import { RING, apps, appFor, deepLink } from '../frontend/th/registry/apps.js';
import { hasRenderer, homeLine, place } from '../frontend/th/registry/surfaces.js';
import { EXECUTORS, canRun, run } from '../frontend/th/registry/verbs.js';

test('every app in the contract is on the ring, with a colour and an icon in the sprite', () => {
  const sprite = readFileSync(new URL('../frontend/ui/icons.svg', import.meta.url), 'utf8');
  assert.deepEqual([...RING].sort(), Object.keys(APPS).sort());
  for (const a of apps) {
    assert.match(a.color, /^#[0-9a-f]{6}$/, a.id);
    assert.ok(sprite.includes(`id="${a.icon}"`), `${a.id}: icon ${a.icon} in ui/icons.svg`);
    assert.equal(a.path, APPS[a.id].path);
  }
});

test('deep links: only inside a shipped app, never out of it', () => {
  assert.equal(deepLink('music', '/music/'), '/music/');
  assert.equal(deepLink('music', '/music/?q=calm'), '/music/?q=calm');
  assert.equal(deepLink('music', '/guitar/'), null);
  assert.equal(deepLink('music', '/music/../signin/'), null);
  assert.equal(deepLink('music', 'https://example.com/music/'), null);
  // Resolved as the browser would: an encoded dot segment or separator leaves the app.
  for (const path of ['/music/%2e%2e/settings/agents/?new=mind:chat', '/music/.%2E/settings/', '/music/%2f..%2fsettings/', '//example.com/music/', '/music/\\..\\settings/'])
    assert.equal(deepLink('music', path), null, path);
  // Study ships with its own page in P7 (step 2); its places are queries on /study/.
  assert.equal(deepLink('study', '/study/'), '/study/');
  assert.equal(deepLink('study', '/study/?book=0190&p=12'), '/study/?book=0190&p=12');
  assert.equal(deepLink('study', '/study/%2e%2e/settings/'), null);
  assert.equal(deepLink('mail', '/mail/'), null);
  assert.equal(appFor('constructor'), null);
});

test('every device verb the Worker can queue has an executor here; the rest are unsupported_verb', async () => {
  for (const [name, v] of Object.entries(VERBS)) {
    if (v.executor !== 'device') continue;
    for (const version of v.versions) assert.ok(canRun(name, version), `${name} v${version} has no executor`);
  }
  for (const name of Object.keys(EXECUTORS)) assert.ok(Object.hasOwn(VERBS, name), `${name} is not in the contract`);
  assert.deepEqual(await run({ verb: 'music.queue_add', schema: 1, args: {} }), { ok: false, error: { code: 'unsupported_verb' } });
  assert.deepEqual(await run({ verb: 'shell.appearance', schema: 9, args: { mode: 'day' } }), { ok: false, error: { code: 'unsupported_verb' } });
});

test('every surface kind and version is drawn, and anything else becomes the generic card', () => {
  const surface = (kind, schema, payload, app = 'home', slot = 'line.1') => ({ app, slot, kind, schema, payload, why: 'a test surface for the phone', topic_key: 't', ref: null, expires_at: null, written_at: 0, seq: 1, ledger_id: null });
  for (const [kind, k] of Object.entries(SURFACE_KINDS)) for (const v of k.versions) assert.ok(hasRenderer(kind, v), `${kind} v${v} has no renderer`);
  assert.deepEqual(place(surface('banner', 1, {})), { place: 'card', order: 0, text: 'a test surface for the phone', kind: 'banner' });
  assert.equal(place(surface('line', 7, { text: 'x' })).place, 'card', 'an unknown version falls back');
  const lines = [surface('line', 1, { text: 'Third.' }, 'home', 'line.3'), surface('line', 1, { text: 'First.' }, 'home', 'line.1')];
  assert.deepEqual(homeLine(lines), { place: 'voice', order: 1, text: 'First.', lang: null });
  assert.equal(place(surface('tile', 1, { label: 'Study', value: 'p. 212' }, 'briefing', 'study')), null, 'a Briefing tile is not drawn on home');
});

test('every fact kind and source in the contract has its place on the Memory page; anything else still renders', () => {
  const groups = GROUPS.map((g) => g.id);
  for (const kind of MEMORY.kinds) assert.ok(groups.includes(kind), `kind ${kind} has no group`);
  for (const source of MEMORY.sources) assert.ok(Object.hasOwn(SOURCES, source), `source ${source} has no label`);
  assert.equal(groupOf({ kind: 'telepathy', tags: [] }), 'other');
  assert.equal(groupOf({ kind: 'routine', tags: ['faith'] }), 'beliefs');
  assert.equal(groupOf({ kind: 'constructor', tags: [] }), 'other');
  assert.equal(sourceLabel('dreamed'), 'dreamed');
  assert.equal(sourceLabel('toString'), 'toString', 'no prototype lookups');
  const fact = (over) => ({ kind: 'fact', tags: [], source: 'user', pinned: false, confidence_now: 0.9, ...over });
  assert.equal(shelfOf(fact({ confidence_now: 0.05 })), 'fading');
  assert.equal(shelfOf(fact({ confidence_now: 0.05, pinned: true })), 'fact', 'pinned never fades');
  assert.equal(shelfOf(fact({ tags: ['imported'], source: 'inferred' })), 'review');
  assert.equal(shelfOf(fact({ tags: ['imported'], source: 'user' })), 'fact', 'reviewed: back in its group');
  assert.deepEqual([0.95, 0.8, 0.65, 0.5, 0.3, 0.05].map(odds), [
    'Almost certainly, about 9 in 10 or more', 'Pretty sure, about 8 in 10', 'Probably, about 7 in 10',
    'Maybe, maybe not, about 5 in 10', 'I doubt it, about 3 in 10', 'Very unlikely, 1 in 10 or less',
  ]);
});
