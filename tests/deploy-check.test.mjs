// The deploy's smoke check (deploy.yml): deep health counts as ready only when every object runs
// the new code on its newest schema step, applied and expected (scripts/schema-version.mjs). Its
// automatic rollback undoes only the run's own deployment (scripts/rollback-guard.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { decide } from '../scripts/rollback-guard.mjs';
import { files, latestOf, ready } from '../scripts/schema-version.mjs';

const want = Object.fromEntries(['core', 'auth', 'music', 'senses', 'library'].map((c) => [c, latestOf(files(c).map((f) => readFileSync(f, 'utf8')))]));
const body = (core, auth, ok = true, music = [want.music, want.music]) =>
  ({ ok, objects: { core: { schema: core[0], expected: core[1] }, auth: { schema: auth[0], expected: auth[1] }, music: { schema: music[0], expected: music[1] }, senses: { schema: want.senses, expected: want.senses }, library: { schema: want.library, expected: want.library } } });

test('ready only when every object has its newest step applied and expected', () => {
  assert.ok(want.core >= 7 && want.auth >= 1 && want.music >= 1 && want.senses >= 1 && want.library >= 1);
  assert.equal(ready(body([want.core, want.core], [want.auth, want.auth]), want), null);
  assert.match(ready(body([want.core, want.core - 1], [want.auth, want.auth]), want), /core schema/, 'old code still running');
  assert.match(ready(body([want.core - 1, want.core], [want.auth, want.auth]), want), /core schema/, 'migration not applied');
  assert.equal(ready(body([want.core + 1, want.core], [want.auth, want.auth]), want), null, 'rollback: older code on a newer schema');
  assert.match(ready({ ok: true }, want), /core schema undefined/, 'a body without per-object schema is not ready');
  assert.match(ready(body([want.core, want.core], [want.auth, want.auth], true, [0, want.music]), want), /music schema/, 'the Music object not migrated');
  const noMusic = body([want.core, want.core], [want.auth, want.auth]);
  delete noMusic.objects.music;
  assert.match(ready(noMusic, want), /music schema undefined/, 'an older release without the Music object in deep health');
  assert.match(ready(body([want.core, want.core], [want.auth, want.auth], false), want), /ok is not true/);
  assert.match(ready(null, want), /ok is not true/);
});

test('the deploy workflow waits on it', () => {
  const yml = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(yml, /node scripts\/schema-version\.mjs --ready/);
  assert.match(yml, /if \[\[ -f scripts\/schema-version\.mjs \]\]/, 'older releases fall back to the ok check');
});

// A deployment as `wrangler deployments status --json` prints it (the API's own shape).
const deployment = (version_id, message, triggered_by = 'deployment', source = 'wrangler') => ({
  id: 'd-1',
  source,
  created_on: '2026-10-29T12:00:00Z',
  annotations: { ...(message ? { 'workers/message': message } : {}), 'workers/triggered_by': triggered_by },
  versions: [{ version_id, percentage: 100 }],
});
const run = { prev: 'v-prev', ours: 'v-ours', message: 'deploy abc123' };

test('the automatic rollback undoes only this run’s own deployment', () => {
  assert.equal(decide(deployment('v-ours', 'deploy abc123'), run), 'rollback');
  assert.equal(decide(deployment('v-ours', undefined), run), 'rollback', 'ours by version id alone');
  assert.equal(decide(deployment('v-other', 'deploy abc123'), { ...run, ours: '' }), 'rollback', 'ours by message when the id was not read');
  assert.equal(decide(deployment('v-prev', 'deploy 0ld'), run), 'live', 'the deploy never went live');
  const dash = decide(deployment('v-dash', undefined, 'secret', 'dash'), run);
  assert.match(dash, /^keep: the live deployment \(secret, 2026-10-29T12:00:00Z, version v-dash\) is not this run's$/);
  assert.match(decide(deployment('v-next', 'deploy fff999'), run), /^keep: /, 'another deploy made meanwhile');
  assert.equal(decide({ ...deployment('v-x'), versions: [{ version_id: 'v-prev', percentage: 10 }, { version_id: 'v-ours', percentage: 90 }] }, run), 'rollback', 'the biggest share decides');
  for (const unreadable of [null, '', {}, { versions: [] }, { versions: [{}] }, 'not json'])
    assert.equal(decide(unreadable, run), 'rollback', `unreadable status ${JSON.stringify(unreadable)}: roll back as before`);
});

test('its command line reads the status from stdin', () => {
  const cli = (input, ...args) => execFileSync('node', [new URL('../scripts/rollback-guard.mjs', import.meta.url).pathname, ...args], { input, encoding: 'utf8' });
  assert.equal(cli(JSON.stringify(deployment('v-ours', 'deploy abc123')), 'v-prev', 'v-ours', 'deploy abc123'), 'rollback');
  assert.match(cli(JSON.stringify(deployment('v-dash', undefined, 'secret', 'dash')), 'v-prev', 'v-ours', 'deploy abc123'), /^keep: /);
  assert.equal(cli('', 'v-prev', '', 'deploy abc123'), 'rollback', 'wrangler failed: no status');
  assert.equal(cli('{"versions":[{"version_id":"v-prev","percentage":100}]}', 'v-prev', '', 'deploy abc123'), 'live');
});

test('the deploy workflow asks it before rolling back', () => {
  const yml = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(yml, /--message "deploy \$\(git rev-parse HEAD\)"/, 'the deploy writes the message the guard looks for');
  assert.match(yml, /node scripts\/rollback-guard\.mjs "\$PREV" "\$OURS" "deploy \$\(git rev-parse HEAD\)"/);
  assert.match(yml, /OURS: \$\{\{ steps\.deploy\.outputs\.version \}\}/);
  assert.match(yml, /grep -oE 'Current Version ID: \[0-9a-f-\]\{36\}'/, 'the deploy step reads the new version id');
  assert.match(yml, /if \[\[ -f scripts\/rollback-guard\.mjs \]\]/, 'older releases roll back as before');
  assert.ok(yml.indexOf('rollback-guard.mjs "$PREV"') < yml.indexOf('npx wrangler rollback "$PREV"'), 'the check comes first');
});
