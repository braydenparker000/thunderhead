// The phone's registries against the contract (EXTENDING.md rules 3 and 9): every app has a ring
// entry with its colour and icon, deep links stay inside a shipped app, every device verb the
// Worker can queue has an executor here (anything else is answered unsupported_verb), and every
// surface kind and version is drawn by a renderer or falls back to the generic card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APPS, SURFACE_KINDS, VERBS } from '../frontend/th/contract.js';
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
  assert.equal(deepLink('study', '/study/'), null, 'Study ships in P7');
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
});
