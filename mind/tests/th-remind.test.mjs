// th remind against the fake Worker: an ISO time with its offset or +90m/+2h/+1d, the owner's
// message named with --from, a new UUIDv7 under which the same request is the same answer, the
// moved time reported as `shifted`; list and cancel; local refusals (exit 8) before the network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {uuidv7} from '../cli/lib/ids.mjs';
import {whenMs} from '../cli/lib/remind.mjs';
import {env, errCode, startFake, th} from './helpers.mjs';

const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const withFake = fn => async () => {
  const fake = await startFake();
  try { await fn(fake); } finally { await fake.stop(); }
};
const puts = fake => fake.state.requests.filter(r => r.method === 'PUT' && r.path.startsWith('/v1/reminders/'));

test('<when>: an ISO time with its offset, or now plus minutes, hours or days', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  assert.equal(whenMs('+90m', now), now + 90 * 60_000);
  assert.equal(whenMs('+2h', now), now + 2 * 3_600_000);
  assert.equal(whenMs('+1d', now), now + 86_400_000);
  assert.equal(whenMs('2026-10-31T19:00:00+02:00', now), Date.parse('2026-10-31T17:00:00Z'));
  assert.equal(whenMs('2026-10-31T19:00Z', now), Date.parse('2026-10-31T19:00:00Z'));
  for (const bad of ['2026-10-31T19:00:00', '2026-10-31', 'tomorrow', '19:00', '+0m', '+2w', '90m', '+1.5h'])
    assert.throws(() => whenMs(bad, now), /<when> must be/, bad);
});

test('th remind sets one from the owner’s message and says when it goes', withFake(async fake => {
  const asked = fake.addOwnerMessage('remind me in 90 minutes to call the garage', {id: uuidv7()});
  const e = env(fake);
  const before = Date.now();
  const r = await th(['remind', '+90m', 'Call', 'the', 'garage', '--from', asked.id], e);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.json.id, UUIDV7);
  assert.deepEqual(Object.keys(r.json), ['id', 'fire_at', 'shifted']);
  const [req] = puts(fake);
  assert.equal(req.path, `/v1/reminders/${r.json.id}`);
  assert.deepEqual(Object.keys(req.body).sort(), ['at', 'source_message_id', 'text']);
  assert.equal(req.body.text, 'Call the garage');
  assert.equal(req.body.source_message_id, asked.id);
  assert.ok(req.body.at >= before + 90 * 60_000 && req.body.at <= Date.now() + 90 * 60_000);
  assert.equal(r.json.shifted, r.json.fire_at !== req.body.at);

  // 23:30 UTC is inside the fake's quiet hours: the Worker moves it to 06:30 and th says so.
  const late = await th(['remind', '2030-01-15T23:30:00Z', '-', '--from', asked.id], e, 'Stretch\n');
  assert.equal(late.code, 0, late.stderr);
  assert.deepEqual({fire_at: late.json.fire_at, shifted: late.json.shifted}, {fire_at: Date.parse('2030-01-16T06:30:00Z'), shifted: true});
  assert.equal(puts(fake).at(-1).body.text, 'Stretch');
}));

test('th remind refuses before the network: a bad time, no words, too many, no owner message', withFake(async fake => {
  const asked = fake.addOwnerMessage('remind me', {id: uuidv7()});
  const e = env(fake);
  const runs = [
    ['remind', '2026-10-31T19:00:00', 'No offset', '--from', asked.id],
    ['remind', 'tomorrow', 'Vague', '--from', asked.id],
    ['remind', '+1h', '   ', '--from', asked.id],
    ['remind', '+1h', 'x'.repeat(201), '--from', asked.id],
    ['remind', '+1h', 'No source'],
    ['remind', '+1h', 'Not an id', '--from', 'msg-1'],
    ['remind', '+1h'],
    ['remind', 'cancel', 'not-an-id'],
    ['remind', 'cancel', uuidv7(), '--from', 'msg-1'],
  ];
  for (const args of runs) {
    const r = await th(args, e);
    assert.equal(r.code, 8, `${args.join(' ')}: ${r.stderr}`);
  }
  assert.equal(puts(fake).length, 0, 'nothing reached the Worker');
}));

test('the Worker’s refusals: not the owner’s message, a 4th from one (exit 8 with the reason)', withFake(async fake => {
  const asked = fake.addOwnerMessage('remind me three times', {id: uuidv7()});
  const mind = fake.addOwnerMessage('a mind line', {id: uuidv7(), author: 'mind', origin: 'mind'});
  const e = env(fake);
  const wrong = await th(['remind', '+1h', 'Water the plants', '--from', mind.id], e);
  assert.equal(wrong.code, 8);
  assert.equal(errCode(wrong), 'validation');
  assert.match(wrong.stderr, /not one of the owner's messages/);
  for (const n of [1, 2, 3]) assert.equal((await th(['remind', `+${n}h`, `Drink water ${n}`, '--from', asked.id], e)).code, 0);
  const fourth = await th(['remind', '+4h', 'Drink water 4', '--from', asked.id], e);
  assert.equal(fourth.code, 8);
  assert.match(fourth.stderr, /at most 3 reminders from one message/);
}));

test('th remind list and cancel', withFake(async fake => {
  const asked = fake.addOwnerMessage('remind me', {id: uuidv7()});
  const e = env(fake);
  // Midday tomorrow, outside the fake's quiet hours whatever the time now (inside them both would
  // move to 06:30 and tie).
  const noon = Date.parse(`${new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}T12:00:00Z`);
  const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const later = (await th(['remind', iso(noon + 3_600_000), 'Later', '--from', asked.id], e)).json;
  const sooner = (await th(['remind', iso(noon), 'Sooner', '--from', asked.id], e)).json;
  const list = await th(['remind', 'list'], e);
  assert.equal(list.code, 0, list.stderr);
  assert.deepEqual(list.json.items.map(i => i.id), [sooner.id, later.id]);
  assert.equal((await th(['remind', 'list'], env(fake, {TH_ROLE: 'night'}))).code, 0, 'the night shift reads them');
  const cancel = await th(['remind', 'cancel', sooner.id], e);
  assert.equal(cancel.code, 0, cancel.stderr);
  assert.deepEqual(cancel.json, {id: sooner.id, state: 'cancelled'});
  assert.deepEqual((await th(['remind', 'cancel', sooner.id], e)).json, cancel.json);
  const none = await th(['remind', 'cancel', uuidv7()], e);
  assert.equal(none.code, 8);
  assert.equal(errCode(none), 'not_found');
}));

test('th remind cancel --from: one the owner set goes only when the owner asked', withFake(async fake => {
  const asked = fake.addOwnerMessage('never mind the plants', {id: uuidv7()});
  const e = env(fake);
  const id = uuidv7();
  const at = Date.now() + 3_600_000;
  const value = {id, text: 'Water the plants', at, fire_at: at, state: 'set', origin: 'owner_device', created_at: Date.now(), fired_at: null, message_id: null};
  fake.state.reminders.set(id, {hash: '', source: null, value});
  const bare = await th(['remind', 'cancel', id], e);
  assert.equal(bare.code, 8);
  assert.match(bare.stderr, /the owner's message that asked/);
  const ok = await th(['remind', 'cancel', id, '--from', asked.id], e);
  assert.equal(ok.code, 0, ok.stderr);
  assert.deepEqual(ok.json, {id, state: 'cancelled'});
  const sent = fake.state.requests.filter(r => r.method === 'DELETE').at(-1);
  assert.deepEqual(sent.query, {source_message_id: asked.id});
}));
