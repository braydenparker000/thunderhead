// The injection fixtures (EVALS.md §4): their shape, and the twins the pre-tool hook carries (a
// fixture whose harm is a change to a protected path or a request to an outside host is denied by
// the hook in every role). The Worker's twins are backend/tests/evals/injection-twins.test.ts.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from './helpers.mjs';
import {decide} from '../hooks/lib/rules.mjs';

const DIR = join(ROOT, 'mind/evals/injection');
const fixtures = readdirSync(DIR).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(readFileSync(join(DIR, f), 'utf8')));
const ctx = role => ({role, cwd: '/work/repo', projectDir: '/work/repo', tmpDir: '/tmp/sess', allowedHosts: ['api.github.com', 'worker.example.test']});

test('25 fixtures, each with a channel, a synthetic payload, an innocent task and its checks', () => {
  assert.deepEqual(fixtures.map(f => f.id), Array.from({length: 25}, (_, i) => `INJ-${String(i + 1).padStart(2, '0')}`));
  for (const f of fixtures) {
    for (const k of ['channel', 'payload', 'task']) assert.ok(typeof f[k] === 'string' && f[k].length > 0, `${f.id} ${k}`);
    assert.ok(Array.isArray(f.checks) && f.checks.length > 0, f.id);
    // Outside text arrives as a file in the drop folder (reading it taints, RUNTIME.md §6.5) and the
    // task names it; Worker-side channels are seeded into the sandbox instead.
    if (f.file) {
      assert.match(f.file, /^[A-Za-z0-9._-]+$/, f.id);
      assert.ok(f.task.includes(`$TMPDIR/th/ext/${f.file}`), `${f.id} names its file`);
    }
    for (const row of f.seed ?? []) assert.ok(['muse', 'import', 'owner'].includes(row.t) && row.body, f.id);
    // Synthetic only: no real hosts but the reserved example domain.
    for (const m of JSON.stringify(f).matchAll(/https?:\/\/([a-z0-9.-]+)/g)) assert.match(m[1], /(^|\.)example$/, f.id);
  }
});

test('the hook twins: a protected-path change or a fetch from an outside host is denied in every role', () => {
  const twins = fixtures.filter(f => f.hook);
  assert.deepEqual(twins.map(f => f.id), ['INJ-12', 'INJ-13', 'INJ-25']);
  for (const f of twins)
    for (const role of ['chat', 'night', 'reflex'])
      assert.ok(decide({tool_name: f.hook.tool_name, tool_input: f.hook.tool_input}, ctx(role)), `${f.id} ${role}`);
});
