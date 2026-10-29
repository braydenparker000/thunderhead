// The contract's generated copies are current, and the registries in shared/contract obey the
// guardrails of docs/engineering/EXTENDING.md rule 9: every verb has a class, an executor, schemas
// and a doc line; every surface kind has slots, versions and a doc line; every route names its
// principals; every shipped app has its folder. The phone-side half (renderers and executors)
// arrives with the home chat UI and is checked with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as z from 'zod/mini';
import { stale } from '../scripts/contract.mjs';
import * as c from '../shared/contract/index.ts';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const sentence = (s) => typeof s === 'string' && s.length >= 12 && /[.)]$/.test(s.trim());

test('the generated contract copies are current (run node scripts/contract.mjs)', () => {
  assert.deepEqual(stale(), []);
});

test('every verb has a class, an executor, versioned schemas and a doc line', () => {
  for (const [name, v] of Object.entries(c.VERBS)) {
    assert.match(name, /^[a-z]+\.[a-z_]+$/, name);
    assert.ok(['reversible', 'ask_first'].includes(v.class), `${name}: class`);
    assert.ok(['device', 'worker'].includes(v.executor), `${name}: executor`);
    assert.ok(['reported', 'none'].includes(v.undo), `${name}: undo`);
    assert.ok(v.queueable || v.executor === 'device', `${name}: an owner-tap verb runs on the device`);
    assert.ok(sentence(v.doc), `${name}: doc line`);
    const versions = Object.keys(v.versions).map(Number);
    assert.ok(versions.length > 0 && versions.every((n) => Number.isInteger(n) && n >= 1), `${name}: versions`);
    for (const [ver, s] of Object.entries(v.versions)) {
      assert.equal(z.toJSONSchema(s.args).type, 'object', `${name} v${ver}: args schema`);
      assert.ok(z.toJSONSchema(s.result), `${name} v${ver}: result schema`);
    }
  }
});

test('every surface kind has slots, versions and a doc line', () => {
  for (const [name, k] of Object.entries(c.SURFACE_KINDS)) {
    assert.ok(Object.keys(k.slots).length > 0, `${name}: slots`);
    for (const re of Object.values(k.slots)) assert.ok(re instanceof RegExp && re.source.startsWith('^'), `${name}: anchored slot`);
    assert.ok(Object.keys(k.versions).length > 0, `${name}: versions`);
    for (const s of Object.values(k.versions)) assert.equal(z.toJSONSchema(s).type, 'object', `${name}: payload schema`);
    assert.ok(sentence(k.doc), `${name}: doc line`);
  }
});

test('every route names a method, a /v1 path, its principals and a phase', () => {
  for (const [key, r] of Object.entries(c.ROUTES)) {
    assert.match(key, /^(GET|POST|PUT|PATCH|DELETE) \/v1\/[a-z0-9/:_-]+$/, key);
    assert.ok(r.who === 'P' || (Array.isArray(r.who) && r.who.length > 0), `${key}: who`);
    assert.ok(r.phase, `${key}: phase`);
  }
});

test('every shipped app has its folder; chips may open only those', () => {
  for (const [id, a] of Object.entries(c.APPS)) {
    const built = c.BUILT_PHASES.includes(a.phase);
    assert.equal(c.appBuilt(id), built, id);
    if (built) assert.ok(existsSync(`${REPO}frontend${a.path}index.html`), `${id}: frontend${a.path}index.html`);
  }
});

test('every change kind, frame type and search source is a plain lowercase word', () => {
  for (const k of [...c.CHANGE_KINDS, ...c.FRAME_TYPES, ...Object.keys(c.SEARCH_SOURCES)]) assert.match(k, /^[a-z_]+$/);
  assert.equal(new Set(c.CHANGE_KINDS).size, c.CHANGE_KINDS.length);
});
