// The bounded Stop hook (RUNTIME.md §6.2, check HK-2) and the StopFailure hook (§6.3, HK-3).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {env, hook, startFake, th} from './helpers.mjs';

const WAIT = [{id: 't1', type: 'shell', status: 'running', description: 'listen', command: 'th wait --minutes 24'}];
const input = (extra = {}) => ({hook_event_name: 'Stop', session_id: 'sess-1', stop_hook_active: false, last_assistant_message: 'Done.', background_tasks: [], ...extra});
const decision = r => (r.stdout.trim() ? JSON.parse(r.stdout) : null);

const withFake = (options, fn) => async () => {
  const fake = await startFake(options);
  try { await fn(fake); } finally { await fake.stop(); }
};

test('an unanswered owner message blocks, at most 3 times per session; the 4th stop is allowed', withFake({}, async fake => {
  const m = fake.addOwnerMessage('did the deploy finish?');
  const e = env(fake);
  for (let i = 1; i <= 3; i++) {
    const r = await hook('stop', input({background_tasks: WAIT, stop_hook_active: i > 1}), e);
    assert.equal(r.code, 0);
    assert.deepEqual(decision(r), {decision: 'block', reason: `Owner message ${m.id} is unanswered. Answer it with th say before ending.`});
  }
  const fourth = await hook('stop', input({background_tasks: WAIT, stop_hook_active: true}), e);
  assert.equal(fourth.code, 0);
  assert.equal(decision(fourth), null);
  const otherSession = await hook('stop', input({session_id: 'sess-2', background_tasks: WAIT}), e);
  assert.equal(decision(otherSession)?.decision, 'block', 'the count is per session');
}));

test('no running th wait blocks; a running one (th or th.mjs) allows; no task list means no wait block', withFake({}, async fake => {
  const e = env(fake);
  const none = await hook('stop', input(), e);
  assert.equal(decision(none).decision, 'block');
  assert.match(decision(none).reason, /^No th wait is running\. Start: th wait --minutes 24 \(run_in_background\), then end your turn\.$/);
  assert.equal(decision(await hook('stop', input({background_tasks: WAIT}), e)), null);
  const viaNode = [{id: 't2', type: 'shell', status: 'running', command: 'node mind/cli/th.mjs wait --minutes 24'}];
  assert.equal(decision(await hook('stop', input({background_tasks: viaNode}), e)), null);
  const finished = [{...WAIT[0], status: 'completed'}];
  assert.equal(decision(await hook('stop', input({background_tasks: finished}), e)).decision, 'block');
  assert.equal(decision(await hook('stop', input({background_tasks: undefined}), e)), null);
}));

test('stop_hook_active with nothing pending and a wait running → allowed', withFake({}, async fake => {
  assert.equal(decision(await hook('stop', input({stop_hook_active: true, background_tasks: WAIT}), env(fake))), null);
}));

test('always allowed: Stop tapped, day closed, usage limited, role ≠ chat, Worker down; TH_ROLE unset prints nothing', async () => {
  for (const setup of [f => f.tapStop(), f => f.closeDay(), f => { f.options.limited = true; }]) {
    const fake = await startFake();
    try {
      fake.addOwnerMessage('unanswered');
      setup(fake);
      assert.equal(decision(await hook('stop', input(), env(fake))), null);
    } finally { await fake.stop(); }
  }
  const fake = await startFake();
  try {
    fake.addOwnerMessage('unanswered');
    assert.equal(decision(await hook('stop', input(), env(fake, {TH_ROLE: 'night'}))), null);
    assert.equal(decision(await hook('stop', input(), env(fake, {TH_ROLE: 'reflex'}))), null);
    const unset = await hook('stop', input(), env(fake, {TH_ROLE: undefined}));
    assert.deepEqual([unset.code, unset.stdout, unset.stderr], [0, '', '']);
  } finally { await fake.stop(); }
  assert.equal(decision(await hook('stop', input(), env(null))), null);
});

test('idle cutoff from th pending: past it with a session note → allowed; past it without a wait → no wait block; lean is 30 min', async () => {
  const fake = await startFake({pendingExtra: {idle_min: 130}});
  try {
    const e = env(fake);
    assert.equal(decision(await hook('stop', input(), e)), null, 'past the cutoff: no wait needed');
    fake.addOwnerMessage('one more thing');
    assert.equal(decision(await hook('stop', input(), e)).decision, 'block', 'still must answer');
    assert.equal((await th(['note', '--session', 'Answered everything; nothing open.'], e)).code, 0);
    assert.equal(decision(await hook('stop', input(), e)), null, 'note written and past the cutoff');
  } finally { await fake.stop(); }
  for (const [lean, expected] of [[false, 'block'], [true, undefined]]) {
    const f = await startFake({lean, pendingExtra: {idle_min: 45}});
    try {
      assert.equal((await th(['pending'], env(f))).json.idle_cutoff_min, lean ? 30 : 120);
      assert.equal(decision(await hook('stop', input(), env(f)))?.decision, expected, `lean=${lean}: 45 min idle`);
    } finally { await f.stop(); }
  }
  const prewarm = await startFake();
  try {
    prewarm.fireWake('chat', 'prewarm');
    const e = env(prewarm);
    await th(['brief', '--claim'], e);
    assert.equal((await th(['pending'], e)).json.idle_cutoff_min, 10, 'a pre-warm with no message yet');
  } finally { await prewarm.stop(); }
});

test('StopFailure reports th status limited and the Stop hook then allows', withFake({}, async fake => {
  const e = env(fake);
  const r = await hook('stop-failure', {hook_event_name: 'StopFailure', error: 'rate_limit', error_details: '429 Too Many Requests'}, e);
  assert.equal(r.code, 0);
  assert.deepEqual({state: fake.state.statuses.at(-1).state, error: fake.state.statuses.at(-1).error}, {state: 'limited', error: 'rate_limit'});
  fake.addOwnerMessage('unanswered');
  assert.equal(decision(await hook('stop', input(), e)), null);
  const odd = await hook('stop-failure', {error: 'weird; rm -rf /'}, env(fake));
  assert.equal(odd.code, 0);
  assert.equal(fake.state.statuses.at(-1).error, 'unknown');
  const before = fake.state.requests.length;
  const unset = await hook('stop-failure', {error: 'rate_limit'}, env(fake, {TH_ROLE: undefined}));
  assert.deepEqual([unset.code, unset.stdout, fake.state.requests.length], [0, '', before], 'TH_ROLE unset: nothing at all');
}));
