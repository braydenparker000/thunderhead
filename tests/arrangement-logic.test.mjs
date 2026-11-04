// An app's arrangement on the phone (th/ported/arrangement.js; MIND-PLAN §3.7) against a mock
// Worker: the app's slot read from GET /v1/surfaces, `arrangement.seen` once a day per arrangement,
// the tap, and Dismiss (the sense, the owner's DELETE, and never again on this phone until a new one
// is placed). And Guitar's intent `guitar.start_practice` (th/guitar/intents.js). Everything is synthetic.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { current, deps, dismissed, seen, tapped } from '../frontend/th/ported/arrangement.js';
import { EXECUTORS, playHash, sectionAt } from '../frontend/th/guitar/intents.js';

const ROW = '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b';
const NEXT = '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2c';
const surface = (ledger_id, extra = {}) => ({
  app: 'guitar', slot: 'today', kind: 'section', schema: 1, why: 'the bridge is where it slipped yesterday', topic_key: 'guitar.today',
  ref: 'tab:s101', expires_at: null, written_at: 1, seq: 4, ledger_id, payload: { v: 1, tab: 'tab:s101', sections: [{ key: '4-8', bpm: 88 }] }, ...extra,
});
let calls, senses, items, store, now;

beforeEach(() => {
  calls = [];
  senses = [];
  items = [surface(ROW), { ...surface(NEXT), app: 'music', slot: 'tonight', kind: 'mix' }];
  store = new Map();
  now = Date.parse('2026-11-04T10:00:00');
  Object.assign(deps, {
    api: () => 'https://api.example.test',
    token: async () => 'th1_test',
    fetch: async (url, init) => {
      calls.push(`${init.method} ${url.replace('https://api.example.test', '')}`);
      assert.equal(init.headers.Authorization, 'Bearer th1_test');
      return init.method === 'GET' ? new Response(JSON.stringify({ items, seq: 4 })) : new Response(null, { status: 204 });
    },
    sense: async (type, ref) => senses.push([type, ref]),
    now: () => now,
    store: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
  });
});

test("reads its own app's slot, by the arrangement's ledger row; none when signed out", async () => {
  const a = await current('guitar', 'today');
  assert.deepEqual(a, { id: ROW, app: 'guitar', slot: 'today', kind: 'section', payload: items[0].payload, why: items[0].why, ref: 'tab:s101' });
  assert.equal(await current('podcasts', 'next'), null);
  assert.deepEqual(calls, ['GET /v1/surfaces', 'GET /v1/surfaces']);
  deps.token = async () => null;
  assert.equal(await current('guitar', 'today'), null);
  assert.equal(calls.length, 2, 'signed out: no call');
});

test('seen goes once a day for each arrangement; the tap goes each time', async () => {
  const a = await current('guitar', 'today');
  assert.equal(await seen(a), true);
  assert.equal(await seen(a), false);
  now += 86_400_000;
  assert.equal(await seen(a), true);
  await tapped(a);
  assert.deepEqual(senses, [['arrangement.seen', `ledger:${ROW}`], ['arrangement.seen', `ledger:${ROW}`], ['arrangement.tap', `ledger:${ROW}`]]);
});

test('Dismiss: the sense, the DELETE that rests its topic, and it never comes back here; a new one does', async () => {
  const a = await current('guitar', 'today');
  await dismissed(a);
  assert.deepEqual(senses, [['arrangement.dismiss', `ledger:${ROW}`]]);
  assert.deepEqual(calls.slice(1), ['DELETE /v1/surfaces/guitar/today']);
  // The DELETE not taken yet (offline): the same arrangement still is not shown.
  assert.equal(await current('guitar', 'today'), null);
  items[0] = surface(NEXT);
  assert.equal((await current('guitar', 'today'))?.id, NEXT, 'the Worker placed a new one');
});

test('an arrangement past its expiry is not drawn', async () => {
  items[0] = surface(ROW, { expires_at: now - 1 });
  assert.equal(await current('guitar', 'today'), null);
});

test('guitar.start_practice opens the reader at the section and tempo; an unknown song or a bad section is refused', async () => {
  assert.deepEqual(sectionAt('4-8', 88), { a: 4, b: 8, bpm: 88 });
  assert.equal(sectionAt('8-4'), null);
  assert.equal(playHash('g:band/song', { a: 4, b: 8, bpm: 88 }), '#play=g%3Aband%2Fsong&bars=4-8&bpm=88');
  const opened = [];
  const guitar = { open: (key, at) => (key === 's101' ? (opened.push([key, at]), true) : false) };
  const run = EXECUTORS['guitar.start_practice'][1];
  assert.deepEqual(await run(guitar, { tab: 'tab:s101', section: '4-8', bpm: 88 }), { ok: true, result: { opened: 'tab:s101#4-8' } });
  assert.deepEqual(opened, [['s101', { a: 4, b: 8, bpm: 88 }]]);
  assert.deepEqual(await run(guitar, { tab: 'tab:s999', section: '1-2' }), { ok: false, error: { code: 'song_unknown', message: 'open the song once in Guitar' } });
  assert.deepEqual((await run(guitar, { tab: 'tab:s101', section: '9-2' })).error, { code: 'bad_section' });
});
