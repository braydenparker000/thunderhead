// The reflex's commands (RUNTIME.md §3, OPERATIONS.md §8.2): `th reflex` prints the procedure from
// the contract and each tripped watchdog with its handling; `th handled` reports one; `th drill`
// (chat, when the owner asks) trips one by hand; the Stop hook
// keeps a reflex session going until each tripped watchdog that wakes it has a report, at most 3
// times. Against the fake Worker; everything is synthetic.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT, env, errCode, hook, startFake, th} from './helpers.mjs';

const CONTRACT = JSON.parse(readFileSync(join(ROOT, 'mind/cli/contract.json'), 'utf8')).watchdogs;
const withFake = fn => async () => {
  const fake = await startFake();
  try { await fn(fake); } finally { await fake.stop(); }
};
const item = (name, state, extra = {}) => ({name, state, severity: 'S3', slo: 'x', trips: 'y', since: state === 'tripped' ? 1 : null,
  detail: state === 'tripped' ? '25 new server errors in 60 min' : null, handled: null, waits: state === 'later' ? 'later' : null, ...extra});
const reflexEnv = fake => env(fake, {TH_ROLE: 'reflex'});

test('th reflex: the procedure, each tripped watchdog with what to do, and what is still unreported', withFake(async fake => {
  fake.state.watchdogs = [item('errors.spike', 'tripped'), item('roll.stuck', 'tripped', {handled: {at: 2, outcome: 'reported', note: 'n'}}),
    item('db.size', 'ok'), item('muse.silent', 'tripped'), item('backup.stale', 'later')];
  const r = await th(['reflex'], reflexEnv(fake));
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.json.procedure, CONTRACT.reflex_procedure);
  assert.ok(r.json.procedure.some(s => s.includes('th handled')) && r.json.procedure.some(s => s.includes('git revert')));
  assert.deepEqual(r.json.tripped.map(t => t.name), ['errors.spike', 'roll.stuck', 'muse.silent']);
  assert.equal(r.json.tripped[0].handle, CONTRACT.items['errors.spike'].handle);
  // muse.silent wakes nobody, and roll.stuck has its report.
  assert.deepEqual(r.json.unreported, ['errors.spike']);
  assert.deepEqual(r.json.ok, ['db.size']);
  assert.equal(r.json.later, 1);
}));

test('th handled: checks the name, the outcome and the note, then reports it', withFake(async fake => {
  fake.state.watchdogs = [item('errors.spike', 'tripped'), item('db.size', 'ok')];
  const e = reflexEnv(fake);
  const note = 'Reverted abc1234; errors stopped.';
  for (const args of [['nope', '--outcome', 'fixed', '--note', note], ['errors.spike', '--outcome', 'solved', '--note', note],
    ['errors.spike', '--outcome', 'fixed', '--note', 'short'], ['errors.spike', '--outcome', 'fixed']]) {
    const bad = await th(['handled', ...args], e);
    assert.equal(bad.code, 8, args.join(' '));
  }
  assert.equal(fake.state.requests.filter(r => r.path.includes('/handled')).length, 0, 'nothing sent');
  const ok = await th(['handled', 'errors.spike', '--outcome', 'fixed', '--note', note], e);
  assert.equal(ok.code, 0, ok.stderr);
  assert.deepEqual(fake.state.requests.find(r => r.path === '/v1/ops/watchdogs/errors.spike/handled').body, {outcome: 'fixed', note});
  assert.equal(ok.json.handled.outcome, 'fixed');
  const notTripped = await th(['handled', 'db.size', '--outcome', 'nothing', '--note', note], e);
  assert.equal(errCode(notTripped), 'conflict');
}));

test('Stop: a reflex session goes on while a tripped watchdog that woke it has no report, at most 3 times', withFake(async fake => {
  const e = reflexEnv(fake);
  const stop = () => hook('stop', {hook_event_name: 'Stop', session_id: 'reflex-1', stop_hook_active: false}, e);
  fake.state.watchdogs = [item('errors.spike', 'tripped'), item('muse.silent', 'tripped')];
  for (let k = 0; k < 3; k++) {
    const r = await stop();
    const out = JSON.parse(r.stdout);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /^Watchdog errors\.spike has no report yet\. Say what you did: th handled errors\.spike --outcome/);
  }
  assert.equal((await stop()).stdout, '', 'the 4th stop is allowed');
  // Reported: it may end.
  const done = reflexEnv(fake);
  fake.state.watchdogs[0].handled = {at: 1, outcome: 'reported', note: 'Told the owner.'};
  assert.equal((await hook('stop', {hook_event_name: 'Stop', session_id: 'reflex-2'}, done)).stdout, '');
  // The Worker down: never trap a session we can't see.
  const down = env(null, {TH_ROLE: 'reflex'});
  assert.equal((await hook('stop', {hook_event_name: 'Stop', session_id: 'reflex-3'}, down)).stdout, '');
}));

test('th drill: the chat role trips one watchdog by hand; the reflex role may not', withFake(async fake => {
  fake.state.watchdogs = [item('db.size', 'ok')];
  assert.equal((await th(['drill', 'nope'], env(fake))).code, 8);
  const r = await th(['drill', 'db.size'], env(fake));
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual({fired: r.json.fired, state: r.json.item.state}, {fired: 'fired', state: 'tripped'});
  assert.equal(errCode(await th(['drill', 'db.size'], env(fake))), 'conflict');
  assert.equal((await th(['drill', 'db.size'], reflexEnv(fake))).code, 6, 'not a reflex route (the contract)');
}));
