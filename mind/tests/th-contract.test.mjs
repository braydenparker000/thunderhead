// th and the contract (docs/engineering/EXTENDING.md rules 1 and 8): every route th can call is
// in mind/cli/contract.json, a route this build lacks exits 8 `not_built` before the network,
// verb args, surfaces and the phrase lint are checked locally, and `th help` and `th get` come
// from the contract, so new Worker features need no th change.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {CONTRACT, checkRoute, routeOf} from '../cli/lib/contract.mjs';
import {check} from '../cli/lib/schema.mjs';
import {ROOT, env, startFake, th} from './helpers.mjs';

const withFake = fn => async () => {
  const fake = await startFake({holdUnitMs: 20});
  try { await fn(fake); } finally { await fake.stop(); }
};

test('every route th calls is in the contract', () => {
  const dir = join(ROOT, 'mind/cli/lib');
  const calls = [];
  for (const f of readdirSync(dir)) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const [, method, path] of src.matchAll(/request\('(GET|POST|PUT|PATCH|DELETE)', [`']([^`']+)[`']/g))
      calls.push([method, path.replace(/\$\{[^}]+\}/g, 'x')]);
  }
  assert.ok(calls.length >= 30, `found ${calls.length} calls`);
  for (const [method, path] of calls) assert.ok(routeOf(method, path), `${method} ${path} is not in contract.json`);
});

test('a route this build lacks exits 8 not_built before the network', withFake(async fake => {
  const e = {...env(fake), TH_ALLOW_UNBUILT: undefined};
  delete e.TH_ALLOW_UNBUILT;
  // No GET route is deferred any more (the jobs routes were the last, built with the listening pass),
  // so the check itself is called with a deferred POST.
  assert.throws(() => checkRoute('POST', '/v1/ops/restore', {}), (err) =>
    err.exit === 8 && err.code === 'not_built' && /POST \/v1\/ops\/restore is deferred/.test(err.message));
  assert.doesNotThrow(() => checkRoute('POST', '/v1/ops/restore', {TH_ALLOW_UNBUILT: '1'}));
  assert.equal((await th(['pending'], e)).code, 0, 'built routes still work');
}));

test('surfaces, verbs and the phrase lint are checked locally', withFake(async fake => {
  const e = env(fake);
  const why = ['--why', 'a short morning greeting'];
  const put = (slot, payload, kind = 'line') => th(['surface', 'home', slot, '--kind', kind, '--payload', JSON.stringify(payload), '--topic', 'greeting', ...why], e);
  const before = fake.state.requests.length;
  for (const r of [await put('line.9', {text: 'Good morning.'}), await put('line.1', {text: 'x'.repeat(45)}), await put('line.1', {text: 'Hi.'}, 'banner'),
    await th(['say', 'today', 'Great question. Here it is.'], e), await th(['say', 'general', 'hello'], e)])
    assert.equal(r.code, 8, r.stderr);
  assert.equal(fake.state.requests.length, before, 'nothing reached the Worker');
  const ok = await put('line.1', {text: 'Good morning.'});
  assert.equal(ok.code, 0, ok.stderr);
  assert.ok(ok.json.ledger_id);
  assert.equal((await th(['say', 'today', 'Fixed. ```\nsay "great question"\n```'], e)).code, 0, 'code is exempt');
  const ls = await th(['surface', 'ls'], e);
  assert.equal(ls.json.items[0].slot, 'line.1');
  assert.equal((await th(['surface', 'rm', 'home', 'line.1'], e)).code, 0);
}));

test('th say sends a chat reply in any shape; the phrase lint still stops one locally (exit 8, nothing sent)', withFake(async fake => {
  const e = env(fake);
  assert.deepEqual(Object.keys(CONTRACT.lint), ['banned_phrases'], 'the shape lint is gone from the contract');
  for (const text of ['- the dentist\n- choir', 'Sure, the dentist at 9:30.', 'Moved to Friday. Want me to tell the choir?', 'Options: the train or the bus.'])
    assert.equal((await th(['say', 'today', text], e)).code, 0, text);
  const before = fake.state.requests.length;
  const r = await th(['say', 'today', 'Great question. The dentist at 9:30.'], e);
  assert.equal(r.code, 8);
  assert.match(r.stderr, /banned phrase/);
  assert.equal(fake.state.requests.length, before, 'nothing reached the Worker');
  assert.equal((await th(['say', 'today', '--kind', 'progress', '- Reading the calendar'], e)).code, 0);
}));

test('th get reads any built GET route; th help comes from the contract', withFake(async fake => {
  const e = env(fake);
  const today = await th(['get', '/v1/threads/today'], e);
  assert.equal(today.code, 0, today.stderr);
  assert.equal(today.json.thread.id, fake.today.id);
  await th(['get', '/v1/ledger', 'limit=5', 'kind=verb'], e);
  assert.deepEqual(fake.state.requests.at(-1).query, {limit: '5', kind: 'verb'});
  assert.equal((await th(['get', '/v1/nothing/here'], e)).code, 8);
  assert.equal((await th(['get', 'threads/today'], e)).code, 8);
  const help = await th(['help'], e);
  assert.equal(help.code, 0);
  for (const name of [...Object.keys(CONTRACT.verbs), ...Object.keys(CONTRACT.surfaces), 'GET /v1/threads/today'])
    assert.ok(help.stdout.includes(name), name);
  assert.ok(help.stdout.includes('POST /v1/memory/ops'), 'built P3 routes are offered');
  assert.ok(help.stdout.includes('GET /v1/work/orders'), 'built P4 routes are offered');
  assert.ok(!help.stdout.includes('POST /v1/ops/restore'), 'routes not built yet are not offered');
  assert.match((await th(['help', 'verb'], e)).stdout, /^th verb <app\.action>/);
}));

test('the local JSON Schema check agrees with the contract on the edges', () => {
  const line = CONTRACT.surfaces.line.versions['1'];
  assert.equal(check({text: 'Good morning.'}, line), null);
  assert.match(check({text: 'x'.repeat(45)}, line), /at most 44/);
  assert.match(check({}, line), /text: required/);
  assert.match(check({text: 'Hi.', lang: 'english'}, line), /lang: does not match/);
  const mode = CONTRACT.verbs['shell.appearance'].versions['1'].args;
  assert.equal(check({mode: 'night'}, mode), null);
  assert.match(check({mode: 'sepia'}, mode), /must be one of/);
});
