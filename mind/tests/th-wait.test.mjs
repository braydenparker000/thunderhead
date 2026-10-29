// th wait: the ≤ 25 s take loop, exit codes 0/3/4/5, client abort, leases, acknowledgement and requeue.
// The fake holds a take for `timeout × holdUnitMs`, so a "25 s" take lasts 25 × 20 ms here.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {env, errCode, startFake, th} from './helpers.mjs';

const withFake = (options, fn) => async () => {
  const fake = await startFake({holdUnitMs: 20, ...options});
  try { await fn(fake); } finally { await fake.stop(); }
};
const later = (ms, fn) => setTimeout(fn, ms);

test('wait returns an owner message (exit 0) and remembers the sequence', withFake({}, async fake => {
  const e = env(fake);
  await th(['brief', '--claim'], e);
  later(150, () => fake.addOwnerMessage('play something calm'));
  const r = await th(['wait', '--minutes', '0.2'], e);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.messages[0].body, 'play something calm');
  assert.deepEqual(r.json.events, []);
  const next = await th(['wait', '--minutes', '0.01'], e);
  assert.equal(next.code, 3, 'the same message is not handed out twice to the same session');
  assert.ok(fake.state.takes.at(-1).after >= r.json.messages[0].seq);
}));

test('every take asks for min(25 s, time left); the loop runs takes until the deadline, then exits 3', withFake({}, async fake => {
  const e = env(fake);
  later(1200, () => fake.addOwnerMessage('hello'));
  const long = await th(['wait', '--minutes', '1'], {...e, TH_TAKE_S: '60'}); // asking for 60 s is clamped to 25
  assert.equal(long.code, 0, long.stderr);
  assert.ok(fake.state.takes.length >= 2, `takes: ${fake.state.takes.length}`);
  assert.ok(fake.state.takes.every(t => t.timeout === 25), JSON.stringify(fake.state.takes));
  fake.state.takes.length = 0;
  const r = await th(['wait', '--minutes', '0.03'], e); // 1.8 s: the takes shrink to what is left
  assert.equal(r.code, 3);
  assert.ok(r.json.timeout && Number.isInteger(r.json.timeout.idle_min));
  assert.ok(fake.state.takes.length >= 3, `takes: ${fake.state.takes.length}`);
  assert.equal(fake.state.takes[0].timeout, 2);
  for (const t of fake.state.takes) assert.ok(t.timeout >= 1 && t.timeout <= 2);
}));

test('wait exits 4 on Stop and 5 on day close, and returns events with exit 0', withFake({}, async fake => {
  const e = env(fake);
  later(100, () => fake.tapStop());
  const stop = await th(['wait', '--minutes', '0.2'], e);
  assert.equal(stop.code, 4);
  assert.ok(stop.json.stop);
  later(100, () => fake.addEvent('proposal.decided', 'proposal:0192f0c4-0000-7000-8000-00000000000a'));
  const ev = await th(['wait', '--minutes', '0.2'], e);
  assert.equal(ev.code, 0, ev.stderr);
  assert.equal(ev.json.events[0].type, 'proposal.decided');
  later(100, () => fake.closeDay());
  const closed = await th(['wait', '--minutes', '0.2'], e);
  assert.equal(closed.code, 5);
  assert.ok(closed.json.day_closed);
}));

test('a hung take is aborted by the client and retried; a dead Worker ends with exit 9', withFake({holdUnitMs: 60_000}, async fake => {
  const e = {...env(fake), TH_TAKE_ABORT_MS: '300'};
  const r = await th(['wait', '--minutes', '0.025'], e); // 1.5 s, takes cut at 0.3 s
  assert.equal(r.code, 9);
  assert.equal(errCode(r), 'timeout');
  assert.ok(fake.state.takes.length >= 2, `retried: ${fake.state.takes.length}`);
  assert.match(r.stderr, /take failed \(timeout\); retrying/);
  assert.ok(r.ms < 4000);
}));

test('wait retries through 5xx and exits at once on 401 (2) and 403 (6)', withFake({}, async fake => {
  fake.failNext('GET', '/v1/live/wait', 502, 'upstream', 2);
  later(400, () => fake.addOwnerMessage('still there?'));
  const ok = await th(['wait', '--minutes', '0.2'], env(fake));
  assert.equal(ok.code, 0, ok.stderr);
  const bad = await th(['wait', '--minutes', '0.2'], env(fake, {TH_TOKEN: 'thm_wrong_key_three'}));
  assert.equal(bad.code, 2);
  assert.ok(bad.ms < 2000);
  fake.failNext('GET', '/v1/live/wait', 403, 'forbidden');
  assert.equal((await th(['wait', '--minutes', '0.2'], env(fake))).code, 6);
}));

test('lease: a second session cannot claim while the first renews; it can after the lease lapses', withFake({leaseMs: 400}, async fake => {
  const a = env(fake, {CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_a'});
  const b = env(fake, {CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_b'});
  assert.equal((await th(['brief', '--claim'], a)).code, 0);
  const waiting = th(['wait', '--minutes', '0.02'], a); // renews the lease while it runs
  await new Promise(r => setTimeout(r, 300));
  assert.equal((await th(['brief', '--claim'], b)).code, 11);
  await waiting;
  await new Promise(r => setTimeout(r, 500));
  assert.equal((await th(['brief', '--claim'], b)).code, 0, 'lease lapsed');
}));

test('requeue: a handed-out message not acknowledged in time goes to the next session; an ack keeps it', withFake({leaseMs: 1000, ackMs: 1500}, async fake => {
  const a = env(fake, {CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_a'});
  const b = env(fake, {CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_b'});
  await th(['brief', '--claim'], a);
  const m = fake.addOwnerMessage('fix the podcast search');
  const got = await th(['wait', '--minutes', '0.05'], a);
  assert.equal(got.json.messages[0].id, m.id);
  // Session A vanishes without acknowledging. After the lease and ack window pass, B claims: the message is
  // requeued (a wake fires, since no lease is live) and handed to B in its briefing.
  await new Promise(r => setTimeout(r, 1700));
  const brief = await th(['brief', '--claim'], b);
  assert.equal(brief.code, 0);
  assert.match(brief.stdout, /fix the podcast search/);
  assert.equal(fake.state.messages.find(x => x.id === m.id).requeues, 1);
  assert.ok(fake.state.fires.some(f => f.reason === 'requeue' && f.message === m.id), 'requeue with no lease fires a wake');
  // B does not acknowledge either: after the ack window it is requeued again and B's wait hands it out.
  const again = await th(['wait', '--minutes', '0.1'], b);
  assert.equal(again.code, 0, again.stderr);
  assert.equal(again.json.messages[0].id, m.id);
  assert.equal(fake.state.messages.find(x => x.id === m.id).requeues, 2);
  // B acknowledges with status working; nothing is requeued afterwards.
  await th(['status', 'working', '--thread', m.thread_id], b);
  await new Promise(r => setTimeout(r, 1600));
  assert.equal((await th(['wait', '--minutes', '0.01'], b)).code, 3);
  assert.equal(fake.state.messages.find(x => x.id === m.id).requeues, 2);
}));
