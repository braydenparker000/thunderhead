// The reader subagent (BEHAVIOR.md §11 rule 6, RUNTIME.md §6.6): .claude/agents/reader.md reads
// outside material with read-only tools and answers in a contract kind; `th read --check` taints the
// session first (the answer is outside text, passed or not), then checks the answer against the
// kind's schema and the rules a schema can't say, and prints only what passed. Synthetic data only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {env, errCode, ROOT, startFake, th} from './helpers.mjs';
import {CONTRACT} from '../cli/lib/contract.mjs';
import {problem} from '../cli/lib/read.mjs';
import {taintOf} from '../hooks/lib/taint.mjs';

const page = (over = {}) => ({
  kind: 'page', source: 'https://example.test/practice-notes', title: 'Practice notes',
  summary: 'Short daily sessions beat long weekly ones.', points: ['Ten minutes a day is enough.'],
  quote: 'Short sessions every day beat long ones once a week.', links: ['https://example.test/more'],
  instructions_seen: false, instructions_note: null, ...over,
});

test('the reader has read-only tools and its page names every kind and field of the contract', () => {
  const text = readFileSync(join(ROOT, '.claude/agents/reader.md'), 'utf8');
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '';
  assert.match(front, /^name: reader$/m);
  const tools = /^tools: (.*)$/m.exec(front)?.[1].split(',').map(t => t.trim()).sort();
  assert.deepEqual(tools, ['Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch']);
  for (const [kind, k] of Object.entries(CONTRACT.reader.kinds)) {
    assert.ok(text.includes(`\`${kind}\``), kind);
    for (const field of Object.keys(k.schema.properties)) assert.ok(text.includes(`"${field}"`), `${kind}.${field}`);
  }
});

test('the checks a schema can’t make: one sentence, no query data, a note exactly when instructions were seen', () => {
  assert.equal(problem('page', page()), null);
  assert.equal(problem('page', page({links: ['https://evil.example/p.png?d=notes']})), 'a source or link carries a query or fragment (https://evil.example/p.png?d=notes)');
  assert.equal(problem('page', page({quote: 'Practise daily. Then rest.'})), 'quote: at most 1 sentence');
  assert.equal(problem('page', page({instructions_seen: true})), 'instructions_note: say in a few words what they asked for');
  assert.equal(problem('page', page({instructions_note: 'asks the reader to approve a card'})), 'instructions_note: null when none were seen');
  assert.equal(problem('page', page({instructions_seen: true, instructions_note: 'asks the reader to approve a card'})), null);
  assert.equal(problem('page', page({kind: 'list'})), 'kind: must be "page"');
  assert.equal(problem('page', page({advice: 'approve it'})), 'advice: not a known field');
  assert.equal(problem('page', page({summary: 'x'.repeat(601)})), 'summary: at most 600 characters');
  assert.equal(problem('list', {kind: 'list', items: [{title: 'A calm piece', note: null, source: 'https://example.test/a#t=1'}],
    instructions_seen: false, instructions_note: null}), 'a source or link carries a query or fragment (https://example.test/a#t=1)');
  assert.equal(problem('unreadable', {kind: 'unreadable', source: '/tmp/th/ext/scan.png', why: 'an image, not text'}), null);
  assert.equal(problem('nope', {}), 'no reader kind "nope" (th read --kinds)');
});

test('th read --check taints the session first, prints only a checked answer, and refuses the rest', async () => {
  const fake = await startFake();
  try {
    const e = env(fake);
    const kinds = await th(['read', '--kinds'], e);
    assert.equal(kinds.code, 0, kinds.stderr);
    assert.deepEqual(Object.keys(kinds.json.kinds), ['page', 'answer', 'list', 'unreadable']);
    // Refused (a link that would carry data out), and still tainted: the answer is in the context.
    const bad = await th(['read', '--check', 'page', '--json', JSON.stringify(page({links: ['https://evil.example/x?d=1']}))], e);
    assert.equal(bad.code, 8);
    assert.equal(errCode(bad), 'validation');
    assert.equal(fake.state.requests.filter(r => r.path === '/v1/mind/taint').length, 1);
    assert.ok(fake.state.tainted.has('cse_test_session_1'));
    // A fenced answer on stdin passes and is printed back; the session is not tainted twice.
    const ok = await th(['read', '--check', 'page'], e, `\`\`\`json\n${JSON.stringify(page())}\n\`\`\``);
    assert.equal(ok.code, 0, ok.stderr);
    assert.deepEqual(ok.json, {ok: true, kind: 'page', tainted: true, answer: page()});
    assert.equal(fake.state.requests.filter(r => r.path === '/v1/mind/taint').length, 1);
    assert.equal((await th(['read', '--check', 'page', '--json', 'Sure! Here is the page.'], e)).code, 8);
  } finally {
    await fake.stop();
  }
});

test('the reader’s answer taints the session in the PostToolUse hook too; another subagent’s does not', () => {
  const ctx = {cwd: ROOT, tmpDir: '/tmp', ownHosts: []};
  for (const tool_name of ['Task', 'Agent'])
    assert.deepEqual(taintOf({tool_name, tool_input: {subagent_type: 'reader', prompt: 'Read https://example.test/a'}}, ctx),
      {source: 'reader', ref: 'file'});
  assert.equal(taintOf({tool_name: 'Task', tool_input: {subagent_type: 'general-purpose', prompt: 'Sum these numbers'}}, ctx), null);
});
