// th issue against the fake Worker: add files the owner's complaint naming their message, in the
// forgiving form (trims, a kind in any case, a msg: id, each said once; every fault in one refusal
// before the network); note adds to an item; ls reads the open ones.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {uuidv7} from '../cli/lib/ids.mjs';
import {env, errCode, startFake, th} from './helpers.mjs';

const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const withFake = fn => async () => {
  const fake = await startFake();
  try { await fn(fake); } finally { await fake.stop(); }
};
const sent = (fake, method) => fake.state.requests.filter(r => r.method === method && r.path.startsWith('/v1/issues'));

test('th issue add files it under a new id, naming the owner’s message, and repairs what it can', withFake(async fake => {
  const said = fake.addOwnerMessage('music keeps skipping, so annoying', {id: uuidv7()});
  const e = env(fake);
  const r = await th(['issue', 'add', '--title', ' Music skips ', '--what', 'It skips the first second.', '--where', 'Music',
    '--kind', 'Broken', '--from', `msg:${said.id}`], e);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.json.id, UUIDV7);
  assert.equal(r.json.state, 'open');
  assert.equal(r.json.repaired.length, 3);
  const [req] = sent(fake, 'PUT');
  assert.deepEqual(req.body, {title: 'Music skips', what: 'It skips the first second.', where: 'Music', kind: 'broken', from_message_id: said.id});
  const list = await th(['issue', 'ls'], e);
  assert.equal(list.code, 0, list.stderr);
  assert.deepEqual(list.json.items.map(i => i.id), [r.json.id]);
  const noted = await th(['issue', 'note', r.json.id, 'It happened again.'], e);
  assert.equal(noted.code, 0, noted.stderr);
  assert.deepEqual(noted.json, {id: r.json.id, notes: 1});
  const piped = await th(['issue', 'note', r.json.id, '-'], e, 'Only on long songs.\n');
  assert.equal(piped.json.notes, 2);
  assert.equal(sent(fake, 'POST')[1].body.text, 'Only on long songs.');
}));

test('th issue refuses once with every fault, before the network', withFake(async fake => {
  const e = env(fake);
  const r = await th(['issue', 'add', '--title', 'x'.repeat(121), '--kind', 'awful'], e);
  assert.equal(r.code, 8);
  assert.equal(errCode(r), 'validation');
  const fields = JSON.parse(r.stderr.trim().split('\n').pop()).error.details.map(d => d.path);
  assert.deepEqual(fields, ['--title', '--what', '--kind', '--from']);
  assert.equal((await th(['issue', 'note', 'nope'], e)).code, 8);
  assert.equal((await th(['issue', 'ls', '--state', 'later'], e)).code, 8);
  assert.equal((await th(['issue'], e)).code, 8);
  assert.equal(sent(fake, 'PUT').length + sent(fake, 'POST').length + sent(fake, 'GET').length, 0);
}));

test('th issue add: a message that is not the owner’s is the Worker’s refusal', withFake(async fake => {
  const r = await th(['issue', 'add', '--title', 'Slow', '--what', 'Slow menu', '--from', uuidv7()], env(fake));
  assert.equal(errCode(r), 'validation');
  assert.match(r.stderr, /owner/);
}));
