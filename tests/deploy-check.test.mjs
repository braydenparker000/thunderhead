// The deploy's smoke check (deploy.yml): deep health counts as ready only when every object runs
// the new code on its newest schema step, applied and expected (scripts/schema-version.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { files, latestOf, ready } from '../scripts/schema-version.mjs';

const want = { core: latestOf(files('core').map((f) => readFileSync(f, 'utf8'))), auth: latestOf(files('auth').map((f) => readFileSync(f, 'utf8'))) };
const body = (core, auth, ok = true) => ({ ok, objects: { core: { schema: core[0], expected: core[1] }, auth: { schema: auth[0], expected: auth[1] } } });

test('ready only when every object has its newest step applied and expected', () => {
  assert.ok(want.core >= 7 && want.auth >= 1);
  assert.equal(ready(body([want.core, want.core], [want.auth, want.auth]), want), null);
  assert.match(ready(body([want.core, want.core - 1], [want.auth, want.auth]), want), /core schema/, 'old code still running');
  assert.match(ready(body([want.core - 1, want.core], [want.auth, want.auth]), want), /core schema/, 'migration not applied');
  assert.match(ready(body([want.core, want.core], [want.auth, want.auth], false), want), /ok is not true/);
  assert.match(ready(null, want), /ok is not true/);
});

test('the deploy workflow waits on it', () => {
  const yml = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(yml, /health\/deep" \| node scripts\/schema-version\.mjs --ready/);
});
