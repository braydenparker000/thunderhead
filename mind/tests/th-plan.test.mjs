// th plan, th verb --at, th verb cancel and th verbs scheduled (API.md §11.11): each step is checked
// against the contract before the network (its verb, its args, the plan's size, its line and the
// phrase lint, no now-only verb put off), the plan reaches the Worker with one id, its why and line,
// and what waits for its time is listed and taken back. Against the fake Worker; synthetic.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fireAt} from '../cli/lib/plan.mjs';
import {env, freshTmp, startFake, th} from './helpers.mjs';

const withFake = fn => async () => {
  const fake = await startFake({holdUnitMs: 20});
  try { await fn(fake); } finally { await fake.stop(); }
};
const SONG = 'music:r2_song00000001';
const file = (value) => {
  const path = join(freshTmp(), 'plan.json');
  writeFileSync(path, JSON.stringify(value));
  return path;
};
const evening = {what: 'Set up your evening.', steps: [
  {verb: 'music.queue', args: {refs: [SONG], at: 'end'}},
  {verb: 'settings.set', args: {key: 'briefing.units', value: 'f'}},
]};
const why = ['--why', 'the owner asked to set up the evening'];
const last = (fake, method, path) => fake.state.requests.filter(r => r.method === method && r.path === path).at(-1);

test('th plan sends the steps in order with one why and its line, and prints the plan', withFake(async fake => {
  const e = env(fake);
  const r = await th(['plan', file(evening), ...why], e);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.status, 'done');
  assert.ok(r.json.plan_id && r.json.ledger_id);
  assert.deepEqual(r.json.steps.map(s => s.verb), ['music.queue', 'settings.set']);
  const body = last(fake, 'POST', '/v1/verbs/plan').body;
  assert.deepEqual([body.id, body.what, body.why], [r.json.plan_id, 'Set up your evening.', 'the owner asked to set up the evening']);
  assert.deepEqual(body.steps, [{verb: 'music.queue', schema: 1, args: {refs: [SONG], at: 'end'}}, {verb: 'settings.set', schema: 1, args: {key: 'briefing.units', value: 'f'}}]);
  // The steps alone, with --what, from stdin.
  const piped = await th(['plan', '-', ...why, '--what', 'Get the drive ready.'], e, JSON.stringify(evening.steps));
  assert.equal(piped.code, 0, piped.stderr);
  assert.equal(last(fake, 'POST', '/v1/verbs/plan').body.what, 'Get the drive ready.');
}));

test('th plan refuses before the network: size, an unknown verb, bad args, the line, a now-only step later', withFake(async fake => {
  const e = env(fake);
  const before = fake.state.requests.length;
  const step = evening.steps[1];
  for (const [value, extra] of [
    [{what: 'One step.', steps: [step]}, []],
    [{what: 'Too many.', steps: Array.from({length: 9}, () => step)}, []],
    [{what: 'Unknown.', steps: [step, {verb: 'music.nothing', args: {}}]}, []],
    [{what: 'Bad args.', steps: [step, {verb: 'music.queue', args: {refs: ['not a song']}}]}, []],
    [{what: 'An owner tap.', steps: [step, {verb: 'app.open', args: {app: 'music', path: '/music/'}}]}, []],
    [{steps: [step, step]}, []],
    [{what: 'x'.repeat(81), steps: [step, step]}, []],
    [{what: 'Great question, here is your evening.', steps: [step, step]}, []],
    [{what: 'Later.', steps: [step, {verb: 'memory.note', args: {text: 'Likes rain', kind: 'preference', evidence: ['msg:m1']}}]}, ['--at', '+2h']],
  ]) {
    const r = await th(['plan', file(value), ...why, ...extra], e);
    assert.equal(r.code, 8, `${JSON.stringify(value).slice(0, 60)}: ${r.stderr}`);
  }
  assert.equal((await th(['plan', file(evening)], e)).code, 8, 'a why is required');
  assert.equal((await th(['plan', join(freshTmp(), 'none.json'), ...why], e)).code, 8);
  assert.equal(fake.state.requests.length, before, 'nothing reached the Worker');
}));

test('th verb --at schedules, th verbs scheduled lists, th verb cancel takes it back', withFake(async fake => {
  const e = env(fake);
  const at = await th(['verb', 'settings.set', '{"key":"briefing.units","value":"f"}', ...why, '--at', '+2h'], e);
  assert.equal(at.code, 0, at.stderr);
  assert.equal(at.json.status, 'scheduled');
  assert.equal(at.json.shifted, false);
  const sent = last(fake, 'PUT', `/v1/verbs/${at.json.verb_id}`).body.fire_at;
  assert.ok(Math.abs(Date.parse(sent) - Date.now() - 2 * 3_600_000) < 60_000, sent);
  const p = await th(['plan', file(evening), ...why, '--at', '2026-11-04T18:00'], e);
  assert.equal(p.json.status, 'scheduled');
  assert.equal(last(fake, 'POST', '/v1/verbs/plan').body.fire_at, '2026-11-04T18:00', 'an owner-local time goes as written');
  const ls = await th(['verbs', 'scheduled'], e);
  assert.equal(ls.code, 0, ls.stderr);
  const plan = ls.json.items.find(v => v.id === p.json.plan_id);
  assert.deepEqual([plan.verb, plan.what, plan.steps], ['plan.run', 'Set up your evening.', ['music.queue', 'settings.set']]);
  const c = await th(['verb', 'cancel', at.json.verb_id], e);
  assert.deepEqual([c.code, c.json.status], [0, 'cancelled']);
  assert.equal((await th(['verbs', 'scheduled'], e)).json.items.some(v => v.id === at.json.verb_id), false);
  // Before the network: a bad time, too far ahead, a now-only verb, a bad id.
  const before = fake.state.requests.length;
  for (const args of [
    ['verb', 'settings.set', '{"key":"briefing.units","value":"f"}', ...why, '--at', 'tomorrow'],
    ['verb', 'settings.set', '{"key":"briefing.units","value":"f"}', ...why, '--at', '+8d'],
    ['verb', 'reminder.move', '{"id":"0192f0c4-0000-7000-8000-00000000a002","at":1}', ...why, '--at', '+1h'],
    ['verb', 'cancel', 'nope'],
    ['verbs', 'pending'],
  ]) assert.equal((await th(args, e)).code, 8, args.join(' '));
  assert.equal(fake.state.requests.length, before);
}));

test('th help lists plan, verb cancel and verbs scheduled', withFake(async fake => {
  const help = (await th(['help'], env(fake))).stdout;
  for (const s of ['th plan <file.json|->', 'th verbs scheduled', '| cancel <id>', '--at <time>']) assert.ok(help.includes(s), s);
}));

test('--at: an ISO time as given, a span as UTC, within 7 days', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  assert.equal(fireAt('+90m', now), '2026-11-03T13:30:00.000Z');
  assert.equal(fireAt('2026-11-04T18:00', now), '2026-11-04T18:00');
  assert.equal(fireAt('2026-11-04T18:00+01:00', now), '2026-11-04T18:00+01:00');
  assert.throws(() => fireAt('2026-11-20T18:00Z', now), /within the next 7 days/);
  assert.throws(() => fireAt('2026-11-04 18:00', now), /ISO time/);
});
