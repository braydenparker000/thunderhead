// th routine propose|list|cancel (API.md §11.11 "Routines"): a routine is proposed as a card of class
// routine whose spec carries the plan and its one condition, checked against the contract before the
// network (the steps as th plan checks them, no now-only verb, one condition, odds); list shows what
// the owner approved; cancel switches one off, or takes back a card still waiting. Against the fake
// Worker; synthetic.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {days} from '../cli/lib/routine.mjs';
import {env, freshTmp, startFake, th} from './helpers.mjs';

const withFake = fn => async () => {
  const fake = await startFake({holdUnitMs: 20});
  try { await fn(fake); } finally { await fake.stop(); }
};
const file = (value) => {
  const path = join(freshTmp(), 'routine.json');
  writeFileSync(path, JSON.stringify(value));
  return path;
};
const morning = {what: 'Morning music is queued.', steps: [{verb: 'music.queue', args: {refs: ['music:r2_song00000001'], at: 'end'}}]};
const card = ['--name', 'Morning music', '--why', 'the owner plays music most weekday mornings', '--question', 'Queue music on weekday mornings?',
  '--if-ignored', 'Nothing is set up.', '--odds', '0.7'];
const last = (fake, method, path) => fake.state.requests.filter(r => r.method === method && r.path.startsWith(path)).at(-1);

test('th routine propose raises a routine card with the plan and its condition, the routine id its own', withFake(async fake => {
  const r = await th(['routine', 'propose', file(morning), ...card, '--at', '07:30', '--days', 'weekdays'], env(fake));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.routine_id, r.json.proposal_id);
  const body = last(fake, 'PUT', '/v1/proposals/').body;
  assert.equal(body.class, 'routine');
  assert.equal(body.odds, 0.7);
  assert.deepEqual(body.options, ['Set it up', 'Not now']);
  assert.equal(body.spec.op, 'routine.propose');
  const a = body.spec.args;
  assert.deepEqual([a.id, a.name, a.what], [r.json.routine_id, 'Morning music', 'Morning music is queued.']);
  assert.deepEqual(a.condition, {at: '07:30', days: ['mon', 'tue', 'wed', 'thu', 'fri']});
  assert.deepEqual(a.steps, [{verb: 'music.queue', schema: 1, args: {refs: ['music:r2_song00000001'], at: 'end'}}]);
  // An event, and an observed fact's usual time.
  const after = await th(['routine', 'propose', file(morning), ...card, '--after', 'study.read'], env(fake));
  assert.equal(after.code, 0, after.stderr);
  assert.deepEqual(last(fake, 'PUT', '/v1/proposals/').body.spec.args.condition, {after: 'study.read'});
}));

test('th routine propose refuses before the network: one condition, odds, a known verb, nothing now-only', withFake(async fake => {
  const e = env(fake);
  const sent = () => fake.state.requests.filter(r => r.method === 'PUT').length;
  const before = sent();
  for (const [extra, words] of [
    [['--at', '07:30', '--after', 'study.read'], /exactly one of/],
    [[], /exactly one of/],
    [['--at', '7:30'], /HH:MM/],
    [['--at', '07:30', '--days', 'someday'], /--days must be/],
  ]) {
    const r = await th(['routine', 'propose', file(morning), ...card, ...extra], e);
    assert.equal(r.code, 8, extra.join(' '));
    assert.match(r.stderr, words);
  }
  const noOdds = await th(['routine', 'propose', file(morning), ...card.slice(0, -2), '--at', '07:30'], e);
  assert.equal(noOdds.code, 8);
  const unknown = await th(['routine', 'propose', file({what: 'x', steps: [{verb: 'nothing.here', args: {}}]}), ...card, '--at', '07:30'], e);
  assert.equal(unknown.code, 8);
  const nowOnly = await th(['routine', 'propose', file({what: 'Noted.', steps: [{verb: 'memory.note', args: {text: 'a', kind: 'fact', evidence: []}}]}), ...card, '--at', '07:30'], e);
  assert.equal(nowOnly.code, 8);
  assert.match(nowOnly.stderr, /never on its own/);
  assert.equal(sent(), before);
  assert.deepEqual(days('weekends'), ['sat', 'sun']);
  assert.deepEqual(days('fri,mon'), ['mon', 'fri']);
}));

test('th routine list shows the approved ones; cancel switches one off, or takes back a waiting card', withFake(async fake => {
  const e = env(fake);
  const id = '01900000-0000-7000-8000-000000000001';
  fake.state.routines = new Map([[id, {id, name: 'Morning music', when: 'Weekdays at 07:30', on: true, steps: ['music.queue'], next_at: 1,
    last_run_at: null, last_ledger_id: null, last_undone: false, last_error: null}]]);
  const listed = await th(['routine', 'list'], e);
  assert.equal(listed.code, 0, listed.stderr);
  assert.deepEqual(listed.json.items.map(r => [r.name, r.when, r.on]), [['Morning music', 'Weekdays at 07:30', true]]);
  const off = await th(['routine', 'cancel', id], e);
  assert.deepEqual(off.json, {id, status: 'off'});
  assert.deepEqual(last(fake, 'POST', `/v1/routines/${id}/switch`).body, {on: false});
  // Not stored yet: the card waiting for the owner is cancelled instead.
  const p = await th(['routine', 'propose', file(morning), ...card, '--at', '07:30'], e);
  const back = await th(['routine', 'cancel', p.json.routine_id], e);
  assert.equal(back.code, 0, back.stderr);
  assert.deepEqual(back.json, {id: p.json.routine_id, status: 'cancelled'});
  assert.equal((await th(['routine', 'cancel', 'nope'], e)).code, 8);
}));
