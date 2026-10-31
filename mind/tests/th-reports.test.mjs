// th reports against the fake Worker: the phone's playback batches read back as one compact summary
// (events by type, time to first sound, waits from each page's newest batch, the last errors, one
// line per batch), the query from the flags, and local refusals (exit 8) before the network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarize} from '../cli/lib/reports.mjs';
import {env, errCode, startFake, th} from './helpers.mjs';

const withFake = fn => async () => {
  const fake = await startFake();
  try { await fn(fake); } finally { await fake.stop(); }
};
const gets = fake => fake.state.requests.filter(r => r.method === 'GET' && r.path === '/v1/ops/reports');

/** A playback batch as the phone sends it (frontend/th/music/report.js). */
const batch = (page, seq, events, decks = [{index: 0, waits: 0, waitSeconds: 0}]) =>
  ({v: 1, page, seq, why: 'minute', build: 80, t0: 1_793_000_000_000, skipped: 0, events, state: {decks}});

test('summarize: totals over the batches, waits from each page\'s newest batch, one line per batch', () => {
  const items = [
    {id: 'r3', at: 3000, kind: 'playback', device_id: 'session-aaaaaaaaaaaa', body: batch('p1', 2, [
      {t: 70_000, type: 'first sound', track: 'r2_native_b', ms: 2400},
      {t: 71_000, type: 'waiting', deck: 0, at: 12.5},
      {t: 72_000, type: 'error', deck: 1, code: 2, kind: 'network', message: 'host.example/…'},
    ], [{index: 0, waits: 3, waitSeconds: 4.25}, {index: 1, waits: 1, waitSeconds: 0.5}])},
    {id: 'r2', at: 2000, kind: 'playback', device_id: 'session-aaaaaaaaaaaa', body: batch('p1', 1, [
      {t: 1000, type: 'track', id: 'r2_native_a', format: 'opus', source: 'stream'},
      {t: 1100, type: 'first sound', track: 'r2_native_a', ms: 380},
    ], [{index: 0, waits: 1, waitSeconds: 1}])},
    {id: 'r1', at: 1000, kind: 'playback', device_id: 'session-bbbbbbbbbbbb', body: batch('p0', 1, [
      {t: 500, type: 'first sound', track: 'r2_native_c', ms: 900},
      {t: 600, type: 'stall', atMs: 3000, readyState: 2},
    ])},
  ];
  const s = summarize(items, 'playback', 'cursor-1');
  assert.deepEqual({...s, items: undefined}, {
    kind: 'playback', batches: 3, from: 1000, to: 3000, devices: 2, pages: 2,
    events: {'first sound': 3, waiting: 1, error: 1, track: 1, stall: 1},
    first_sound_ms: {n: 3, p50: 900, p90: 2400, max: 2400},
    waits: {count: 4, seconds: 4.8}, stalls: 1,
    errors: [{at: 3000, type: 'error', kind: 'network', code: 2}],
    items: undefined, next: 'cursor-1',
  });
  assert.deepEqual(s.items[0], {id: 'r3', at: 3000, device: 'session-', page: 'p1', seq: 2, why: 'minute', events: 3,
    types: {'first sound': 1, waiting: 1, error: 1}});
  assert.equal(s.items.length, 3);
  assert.deepEqual(summarize([]), {kind: 'all', batches: 0, from: null, to: null, devices: 0, pages: 0, events: {},
    first_sound_ms: null, waits: {count: 0, seconds: 0}, stalls: 0, errors: [], items: [], next: null});
});

test('th reports asks for the kind, the time and the count, and prints the summary', withFake(async fake => {
  const now = fake.now();
  fake.addReport(batch('p1', 1, [{t: 1, type: 'first sound', track: 'r2_native_a', ms: 640}]), {at: now - 120_000});
  fake.addReport(batch('p1', 2, [{t: 61_000, type: 'waiting', deck: 0, at: 61}]), {at: now - 60_000});
  const e = env(fake);
  const r = await th(['reports', '--kind', 'playback', '--since', String(now - 3_600_000), '--limit', '20'], e);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(gets(fake).at(-1).query, {kind: 'playback', since: String(now - 3_600_000), limit: '20'});
  assert.equal(r.json.batches, 2);
  assert.deepEqual(r.json.first_sound_ms, {n: 1, p50: 640, p90: 640, max: 640});
  assert.deepEqual(r.json.items.map(i => i.seq), [2, 1]);
  assert.equal(r.json.next, null);
  assert.equal(r.stdout.trim().split('\n').length, 1, 'one line of JSON');

  // An ISO time works as --since; no --kind reads every kind; the night role may read them too.
  const iso = await th(['reports', '--since', new Date(now - 90_000).toISOString()], {...env(fake, {TH_ROLE: 'night'})});
  assert.equal(iso.code, 0, iso.stderr);
  assert.equal(iso.json.kind, 'all');
  assert.equal(iso.json.batches, 1);
  assert.equal(gets(fake).at(-1).query.limit, '50');

  // A page at a time: --limit 1, then the cursor it gave.
  const one = await th(['reports', '--limit', '1'], e);
  assert.equal(one.json.items.length, 1);
  const two = await th(['reports', '--limit', '1', '--cursor', one.json.next], e);
  assert.notEqual(two.json.items[0].id, one.json.items[0].id);
}));

test('th reports refuses before the network: an unknown kind, a bad count or time, stray words', withFake(async fake => {
  const e = env(fake);
  const before = gets(fake).length;
  for (const args of [['reports', '--kind', 'diary'], ['reports', '--limit', '0'], ['reports', '--limit', '201'],
    ['reports', '--since', 'yesterday'], ['reports', 'playback']]) {
    const r = await th(args, e);
    assert.equal(r.code, 8, `${args.join(' ')}: ${r.stderr}`);
    assert.equal(errCode(r), 'validation');
  }
  assert.equal(gets(fake).length, before, 'nothing reached the Worker');
}));
