// The chat loop in one round trip per reply: th reply (send, then listen), th listen (quiet exit 3,
// closed exit 12 at the idle cut-off) and th wait with no --minutes running to the cut-off.
// The fake holds a "25 s" take for 25 × 20 ms; minuteMs/TH_MINUTE_MS shorten a minute for the cut-off.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {env, errCode, startFake, th} from './helpers.mjs';

const withFake = (options, fn) => async () => {
  const fake = await startFake({holdUnitMs: 20, ...options});
  try { await fn(fake); } finally { await fake.stop(); }
};
const later = (ms, fn) => setTimeout(fn, ms);
const lines = r => r.stdout.trim().split('\n').map(l => JSON.parse(l));
const mark = (e, key) => { try { return JSON.parse(readFileSync(join(e.TMPDIR, 'th', 'state', `${key}.json`), 'utf8')); } catch { return null; } };

test('th reply answers the newest message it was handed, then listens and prints the next one', withFake({}, async fake => {
  const e = env(fake);
  await th(['brief', '--claim'], e);
  later(100, () => fake.addOwnerMessage('what time is choir?'));
  const got = await th(['wait', '--minutes', '0.2'], e);
  assert.equal(got.code, 0, got.stderr);
  const asked = got.json.messages[0];
  later(600, () => fake.addOwnerMessage('and the car?'));
  const r = await th(['reply', '--minutes', '0.2'], e, 'Seven tonight 🎶 See you there!');
  assert.equal(r.code, 0, r.stderr);
  const [sent, next] = lines(r);
  const mine = fake.state.messages.find(m => m.id === sent.id);
  assert.equal(mine.reply_to, asked.id);
  assert.equal(mine.body, 'Seven tonight 🎶 See you there!', 'an emoji and an exclamation mark are not refused');
  assert.equal(next.messages[0].body, 'and the car?');
  assert.ok(fake.state.takes.at(-1).at > mine.created_at, 'it listened after the send');
}));

test('th reply --to names the message and passes th say options through', withFake({}, async fake => {
  const e = env(fake);
  const m = fake.addOwnerMessage('two things');
  const r = await th(['reply', '--to', m.id, '--minutes', '0.01', '--meta', '{"followups":["More"]}'], e, '- one\n- two');
  assert.equal(r.code, 3, r.stderr);
  const [sent, quiet] = lines(r);
  const mine = fake.state.messages.find(x => x.id === sent.id);
  assert.deepEqual([mine.reply_to, mine.body, mine.meta], [m.id, '- one\n- two', {followups: ['More']}]);
  assert.ok(Number.isInteger(quiet.quiet.idle_min) && Number.isInteger(quiet.quiet.closes_in_min), r.stdout);
}));

test('th reply with nothing to answer says so; a failed send exits with its error and does not listen', withFake({}, async fake => {
  const e = env(fake);
  const none = await th(['reply'], e, 'hello');
  assert.equal(none.code, 8);
  assert.match(none.stderr, /no owner message is waiting/);
  const m = fake.addOwnerMessage('still there?');
  fake.failNext('PUT', '/v1/messages/', 403, 'forbidden');
  const takes = fake.state.takes.length;
  const bad = await th(['reply', '--to', m.id], e, 'Yes.');
  assert.equal(bad.code, 6);
  assert.equal(errCode(bad), 'forbidden');
  assert.equal(fake.state.takes.length, takes, 'no listening after a failed send');
  assert.equal(bad.stdout, '');
}));

test('th listen: quiet after N minutes → exit 3 with idle and time left before the cut-off', withFake({cutoffMin: 45}, async fake => {
  const e = env(fake);
  await th(['brief', '--claim'], e);
  const r = await th(['listen', '--minutes', '0.02'], e);
  assert.equal(r.code, 3, r.stderr);
  assert.deepEqual(Object.keys(r.json), ['quiet']);
  assert.equal(r.json.quiet.idle_min, 0);
  assert.ok(r.json.quiet.closes_in_min >= 44 && r.json.quiet.closes_in_min <= 45, r.stdout);
  assert.equal(fake.state.statuses.length, 0, 'no stopping before the cut-off');
}));

test('th listen at the idle cut-off: says stopping, writes the closed mark, exit 12', withFake({minuteMs: 50, cutoffMin: 20}, async fake => {
  const e = {...env(fake), TH_MINUTE_MS: '50'};
  await th(['brief', '--claim'], e);
  const r = await th(['listen', '--minutes', '1'], e);
  assert.equal(r.code, 12, r.stderr);
  assert.ok(r.json.closed && r.json.closed.idle_min >= 20, r.stdout);
  assert.ok(r.ms < 4000, `${r.ms} ms`);
  assert.equal(fake.state.statuses.at(-1).state, 'stopping');
  assert.equal(mark(e, 'closed'), true);
  const again = await th(['listen', '--minutes', '0.01'], {...e, TH_MINUTE_MS: '60000'});
  assert.equal(again.code, 12, 'still past the cut-off');
}));

test('background th wait runs past 24 minutes to the cut-off (exit 12); an unanswered message keeps it open (exit 3)', withFake({minuteMs: 40, cutoffMin: 45}, async fake => {
  const e = {...env(fake), TH_MINUTE_MS: '40'};
  await th(['brief', '--claim'], e);
  const r = await th(['wait'], e);
  assert.equal(r.code, 12, r.stderr);
  assert.ok(r.ms > 24 * 40 * 1.2, `ran ${r.ms} ms: past 24 fake minutes`);
  assert.ok(r.json.closed.idle_min >= 45);
  assert.equal(fake.state.statuses.at(-1).state, 'stopping');
  const f2 = await startFake({holdUnitMs: 20, minuteMs: 40, cutoffMin: 10});
  try {
    const e2 = {...env(f2), TH_MINUTE_MS: '40'};
    await th(['brief', '--claim'], e2);
    const m = f2.addOwnerMessage('one more');
    f2.state.messages.find(x => x.id === m.id).acked_at = Date.now(); // handed and acknowledged, not answered
    const open = await th(['wait'], e2);
    assert.equal(open.code, 3, open.stderr);
    assert.deepEqual(open.json.unanswered, [m.id]);
    assert.equal(f2.state.statuses.length, 0);
  } finally { await f2.stop(); }
}));

test('th wait --minutes N keeps its meaning: exit 3 after N, no cut-off read', withFake({}, async fake => {
  const e = env(fake);
  const r = await th(['wait', '--minutes', '0.01'], e);
  assert.equal(r.code, 3);
  assert.ok(r.json.timeout);
  assert.equal(fake.state.pendingReads ?? 0, 0);
}));

test('a message handed over is acknowledged by th itself, and the lease is kept while the mind works, until the next listener', withFake({}, async fake => {
  const e = env(fake, {TH_KEEPALIVE: undefined, TH_KEEPALIVE_MS: '60', TH_KEEPALIVE_MAX_MS: '3000'});
  await th(['brief', '--claim'], e);
  const working = () => fake.state.requests.filter(r => r.method === 'POST' && r.path === '/v1/mind/status' && r.body?.state === 'working').length;
  later(100, () => fake.addOwnerMessage('a long question'));
  const got = await th(['listen', '--minutes', '0.2'], e);
  assert.equal(got.code, 0, got.stderr);
  assert.ok(working() >= 1, 'th reported working when it handed the message over');
  assert.equal(mark(e, 'status')?.state, 'working');
  // No th command runs while the mind composes: the detached keep-alive goes on reporting.
  const before = working();
  await new Promise(r => setTimeout(r, 400));
  assert.ok(working() >= before + 2, `the keep-alive reported ${working() - before} times in 400 ms`);
  // The next listener's own takes renew the lease: the keep-alive ends.
  const r = await th(['reply', '--minutes', '0.01'], e, 'Here is the long answer.');
  assert.equal(r.code, 3, r.stderr);
  assert.equal(mark(e, 'keepalive'), null);
  await new Promise(res => setTimeout(res, 200));
  const settled = working();
  await new Promise(res => setTimeout(res, 300));
  assert.equal(working(), settled, 'no report after the listener started');
}));
