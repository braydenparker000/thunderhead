// th watch against the fake Worker (RUNTIME.md §3, §5.3): set at a time (ISO with its offset or
// +90m/+2h/+1d, at most 7 days ahead), on an event (a sense type or reminder.fired, with an
// optional ref) or a change (work, verb, proposal, prediction), each the watch.set verb checked
// against the contract before the network; cancel and list; the Worker's 20 cap; and a fired
// watch's reason in `th brief --claim`.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {watchArgs} from '../cli/lib/watch.mjs';
import {env, errCode, startFake, th} from './helpers.mjs';

const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WHY = 'to set up the evening drive';
const withFake = fn => async () => {
  const fake = await startFake();
  try { await fn(fake); } finally { await fake.stop(); }
};
const verbs = fake => fake.state.requests.filter(r => r.method === 'PUT' && r.path.startsWith('/v1/verbs/'));

test('watchArgs: a time, a sense type or a Worker event, a change kind; the contract checks the rest', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  assert.deepEqual(watchArgs('at', '+90m', {why: WHY, note: 'the drive'}, now), {kind: 'at', why: WHY, at: now + 90 * 60_000, note: 'the drive'});
  assert.deepEqual(watchArgs('event', 'guitar.session', {why: WHY, ref: 'tab:example'}, now), {kind: 'event', why: WHY, type: 'guitar.session', ref: 'tab:example'});
  assert.deepEqual(watchArgs('event', 'reminder.fired', {why: WHY}, now), {kind: 'event', why: WHY, type: 'reminder.fired'});
  assert.deepEqual(watchArgs('change', 'work', {why: WHY}, now), {kind: 'change', why: WHY, type: 'work'});
  const bad = [
    ['soon', '+1h', {why: WHY}, /a watch is at, event, change/],
    ['at', '+8d', {why: WHY}, /at most 7 days ahead/],
    ['at', 'tomorrow', {why: WHY}, /<when> must be/],
    ['at', '+1h', {why: WHY, ref: 'tab:x'}, /--ref goes with/],
    ['event', 'music.nothing', {why: WHY}, /names one of/],
    ['event', 'work', {why: WHY}, /names one of/],
    ['change', 'music.play', {why: WHY}, /names one of: work, verb, proposal, prediction/],
    ['at', '+1h', {why: 'short'}, /why: at least 8 characters/],
    ['at', '+1h', {why: WHY, note: 'x'.repeat(141)}, /note: at most 140 characters/],
    ['at', '+1h', {}, /--why/],
  ];
  for (const [kind, what, flags, re] of bad) assert.throws(() => watchArgs(kind, what, flags, now), re, `${kind} ${what}`);
});

test('th watch set, list and cancel: the watch.set and watch.cancel verbs, done at once', withFake(async fake => {
  const e = env(fake);
  const before = Date.now();
  const at = await th(['watch', 'set', 'at', '+90m', '--why', WHY, '--note', 'the drive at six'], e);
  assert.equal(at.code, 0, at.stderr);
  assert.match(at.json.id, UUIDV7);
  assert.deepEqual(Object.keys(at.json), ['id', 'state', 'until', 'ledger_id']);
  assert.equal(at.json.state, 'live');
  const [req] = verbs(fake);
  assert.equal(req.path, `/v1/verbs/${at.json.id}`);
  assert.deepEqual(Object.keys(req.body).sort(), ['args', 'schema', 'verb', 'why']);
  assert.deepEqual([req.body.verb, req.body.schema, req.body.why], ['watch.set', 1, WHY]);
  assert.deepEqual({...req.body.args, at: 0}, {kind: 'at', why: WHY, at: 0, note: 'the drive at six'});
  assert.ok(req.body.args.at >= before + 90 * 60_000 && req.body.args.at <= Date.now() + 90 * 60_000);
  const ev = await th(['watch', 'set', 'event', 'guitar.session', '--ref', 'tab:example-piece', '--why', WHY], e);
  const ch = await th(['watch', 'set', 'change', 'work', '--why', WHY], e);
  assert.deepEqual([ev.code, ch.code], [0, 0], ev.stderr + ch.stderr);
  assert.deepEqual(verbs(fake)[1].body.args, {kind: 'event', why: WHY, type: 'guitar.session', ref: 'tab:example-piece'});
  const list = await th(['watch', 'list'], e);
  assert.equal(list.code, 0, list.stderr);
  assert.equal(list.json.live, 3);
  assert.deepEqual(list.json.items.map(w => w.id).sort(), [at.json.id, ev.json.id, ch.json.id].sort());
  const gone = await th(['watch', 'cancel', ev.json.id], e);
  assert.equal(gone.code, 0, gone.stderr);
  assert.deepEqual([gone.json.id, gone.json.state], [ev.json.id, 'cancelled']);
  assert.deepEqual(verbs(fake).at(-1).body.args, {id: ev.json.id});
  assert.equal((await th(['watch', 'list'], e)).json.live, 2);
  // Cancelling it again: it no longer waits (the Worker's 410).
  assert.equal(errCode(await th(['watch', 'cancel', ev.json.id], e)), 'expired');
}));

test('th watch refuses before the network: a bad time, kind, type, ref, why or id', withFake(async fake => {
  const e = env(fake);
  const runs = [
    ['watch'],
    ['watch', 'set', 'at', '+1h'],
    ['watch', 'set', 'at', 'tomorrow', '--why', WHY],
    ['watch', 'set', 'at', '+8d', '--why', WHY],
    ['watch', 'set', 'event', 'music.nothing', '--why', WHY],
    ['watch', 'set', 'change', 'music', '--why', WHY],
    ['watch', 'set', 'at', '+1h', '--why', 'short'],
    ['watch', 'set', 'event', 'guitar.session', '--ref', 'not a ref', '--why', WHY],
    ['watch', 'cancel', 'not-an-id'],
  ];
  for (const args of runs) {
    const r = await th(args, e);
    assert.equal(r.code, 8, `${args.join(' ')}: ${r.stderr}`);
  }
  assert.equal(verbs(fake).length, 0, 'nothing reached the Worker');
}));

test('the Worker’s cap: a 21st waiting watch is refused with the reason (exit 8)', withFake(async fake => {
  const e = env(fake);
  for (let i = 0; i < 20; i++) assert.equal((await th(['watch', 'set', 'at', `+${i + 1}h`, '--why', WHY], e)).code, 0);
  const over = await th(['watch', 'set', 'at', '+30h', '--why', WHY], e);
  assert.equal(over.code, 8);
  assert.equal(errCode(over), 'validation');
  assert.match(over.stderr, /at most 20 watches wait at once/);
}));

test('a fired watch: th brief --claim binds its wake and prints why it woke', withFake(async fake => {
  const e = env(fake);
  const set = await th(['watch', 'set', 'at', '+2h', '--why', WHY, '--note', 'the drive at six'], e);
  fake.fireWatch(set.json.id);
  const b = await th(['brief', '--claim'], e);
  assert.equal(b.code, 0, b.stderr);
  assert.match(b.stdout, /^## 1\. Now/m);
  assert.ok(b.stdout.includes(`watch ${set.json.id} fired (at): ${WHY} · note: the drive at six`), b.stdout);
  assert.match(b.stdout, /wakes today: 1 of 12/);
  const j = await th(['brief', '--json'], e);
  assert.equal(j.code, 0, j.stderr);
  assert.equal(fake.state.wakes.find(w => w.id === `wake-${set.json.id}`).status, 'claimed');
}));
