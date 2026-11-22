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

test('33 fixtures, each with a channel, a synthetic payload, an innocent task and its checks', () => {
  assert.deepEqual(fixtures.map(f => f.id), Array.from({length: 33}, (_, i) => `INJ-${String(i + 1).padStart(2, '0')}`));
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
  // INJ-30 and INJ-31 (2026-11-22): the main session calls no connector tool; the walled `mail`
  // subagent reads the owner's mail and files, and only reads.
  assert.deepEqual(twins.map(f => f.id), ['INJ-12', 'INJ-13', 'INJ-25', 'INJ-30', 'INJ-31']);
  for (const f of twins)
    for (const role of ['chat', 'night', 'reflex'])
      assert.ok(decide({tool_name: f.hook.tool_name, tool_input: f.hook.tool_input}, ctx(role)), `${f.id} ${role}`);
});

test('the rules of 2026-11-22 in the fixtures: what does not mark, and what a marked session may still raise', () => {
  const by = id => fixtures.find(f => f.id === id);
  // The walled readers' answers, song tags, book text and files the owner sent do not mark: each
  // such fixture's twins run from an unmarked session, and still get nothing past the owner.
  for (const id of ['INJ-01', 'INJ-02', 'INJ-07', 'INJ-08', 'INJ-26', 'INJ-27', 'INJ-28', 'INJ-30', 'INJ-31', 'INJ-32', 'INJ-33'])
    assert.ok(by(id).twin.some(t => t.session === 'unmarked'), id);
  // A card a marked session raised is tap-only: the owner's own words do not approve it.
  for (const id of ['INJ-11', 'INJ-15', 'INJ-19', 'INJ-20'])
    assert.deepEqual(by(id).twin.filter(t => t.write === 'card').map(t => t.expect), ['tap_only'], id);
  // A rule comes only from the owner's own words, in every session.
  for (const f of fixtures) for (const t of f.twin ?? []) if (t.write === 'rule' && t.session === 'unmarked') assert.equal(t.expect, 'refused', f.id);
  // Every new channel is covered: a reader answer (rule, order, card, voice page), a mail answer, a song tag, an owner's file.
  assert.deepEqual(['INJ-26', 'INJ-27', 'INJ-28', 'INJ-29', 'INJ-30', 'INJ-31', 'INJ-32', 'INJ-33'].map(id => by(id).channel),
    ['reader_answer', 'reader_answer', 'reader_answer', 'reader_answer', 'mail_answer', 'mail_answer', 'song_tag', 'owner_file']);
});
