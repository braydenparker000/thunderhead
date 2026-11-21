// frontend/th/guitar/progress.js and the ported store (frontend/guitar/store.js) against a fake
// Worker (GUITAR.md §1.1): two phones, each with its own storage and clock, sync Guitar's progress
// one record per song; the newer record wins both ways, on the phone and on the Worker; a phone with
// nothing local gets everything after sign-in; a sign-out's cleared ladder comes back with the same
// version; a push sends only the songs changed since the last, one record each; nothing goes up
// before a pull has come back. The limits agree with the contract. Invented songs only.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GUITAR_KEY, GUITAR_LIMITS } from '../shared/contract/guitar.ts';
import { createStore } from '../frontend/guitar/store.js';
import { KEY as LADDER, ladderOf, saveLadder } from '../frontend/th/guitar/practice.js';
import * as sync from '../frontend/th/guitar/progress.js';

const NOW = 1_800_000_000_000;
/** Real time: the Worker's clock is it; each phone's is it plus its skew. */
const world = { t: NOW };

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

/** The Worker's two routes: the newer `updated_at` wins record by record, pages by when it took each. */
function fakeWorker() {
  const w = { rows: new Map(), requests: [], pageSize: 100 };
  w.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    w.requests.push({ method: init.method, query: u.search, body, keepalive: init.keepalive });
    const json = (b) => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } });
    world.t += 1;
    w.clock = world.t;
    if (init.method === 'PUT') {
      let applied = 0;
      for (const p of body.items) {
        const had = w.rows.get(p.key);
        if (had && had.updated_at >= p.updated_at) continue;
        w.rows.set(p.key, { ...p, synced_at: w.clock });
        applied++;
      }
      return json({ applied, stale: body.items.length - applied, refused: [], at: w.clock });
    }
    const cursor = u.searchParams.get('cursor');
    const after = cursor ? JSON.parse(atob(cursor)) : [Number(u.searchParams.get('since')) - 0.5, ''];
    const all = [...w.rows.values()]
      .filter((r) => r.synced_at > after[0] || (r.synced_at === after[0] && r.key > after[1]))
      .sort((a, b) => a.synced_at - b.synced_at || (a.key < b.key ? -1 : 1));
    const page = all.slice(0, w.pageSize);
    const last = page.at(-1);
    return json({
      items: page.map(({ synced_at: _, ...p }) => p),
      next_since: w.clock,
      next: all.length > w.pageSize ? btoa(JSON.stringify([last.synced_at, last.key])) : null,
    });
  };
  return w;
}

/** A phone: its storage, its clock (`skew` ms off the Worker's) and the ported store on them. */
function phone(skew = 0) {
  const storage = memoryStorage();
  const p = { storage };
  p.now = () => world.t + skew;
  p.store = createStore(storage, p.now);
  return p;
}

let worker;
/** Runs `fn` as this phone (the module's deps point at it). */
async function as(p, fn) {
  sync.reset();
  Object.assign(sync.deps, { fetch: worker.fetch, now: p.now, storage: () => p.storage, token: async () => 'tok', framed: () => false, api: () => 'https://api.example', online: () => true });
  await fn();
  p.store.flush();
}
const song = (id, title = 'An invented song') => ({ source: 'songsterr', id, title, artist: 'A band' });
const practise = (p, key, sections) => {
  saveLadder(p.storage, null, key, sections);
  p.store.touch(key);
};
const sec = (best, day = '2026-11-20') => ({ day, passes: 5, clean: 4, ceiling: best, best, last: null });

beforeEach(() => {
  worker = fakeWorker();
  world.t = NOW;
});

test('the limits and the key rule agree with the contract', () => {
  for (const k of Object.keys(sync.L)) assert.equal(sync.L[k], GUITAR_LIMITS[k], k);
  assert.match('s123', GUITAR_KEY);
  assert.match('g:a-band/a-song', GUITAR_KEY);
});

test('a phone with nothing local gets everything after sign-in', async () => {
  const a = phone();
  a.store.open(song(101));
  a.store.practice('s101', 300);
  practise(a, 's101', { '3-6': sec(84) });
  a.store.open(song(102));
  await as(a, async () => {
    await sync.pull(a.store);
    await sync.push(a.store);
  });
  assert.equal(worker.rows.size, 2);

  const b = phone(-7_000);
  await as(b, () => sync.pull(b.store));
  assert.deepEqual(b.store.songs().map((s) => s.key).sort(), ['s101', 's102']);
  assert.equal(b.store.song('s101').seconds, 300);
  assert.equal(b.store.stats(b.now()).today, 300);
  assert.equal(ladderOf(b.storage, 's101')['3-6'].best, 84);
});

test('two phones: the newer record wins both ways', async () => {
  const a = phone(0);
  const b = phone(90_000); // its clock 90 s ahead
  a.store.open(song(7, 'First'));
  await as(a, async () => {
    await sync.pull(a.store);
    await sync.push(a.store);
  });
  await as(b, () => sync.pull(b.store));
  assert.equal(b.store.song('s7').title, 'First');

  // B practises later: its record wins on the Worker and on A.
  world.t += 60_000;
  b.store.update('s7', { status: 'practicing', speed: 80 });
  practise(b, 's7', { '1-4': sec(70) });
  await as(b, () => sync.push(b.store));
  await as(a, () => sync.pull(a.store));
  assert.equal(a.store.song('s7').status, 'practicing');
  assert.equal(a.store.song('s7').speed, 80);
  assert.equal(ladderOf(a.storage, 's7')['1-4'].best, 70);

  // Then A changes it later still: A's wins back, on the Worker and on B.
  world.t += 120_000;
  a.store.update('s7', { status: 'canplay' });
  await as(a, () => sync.push(a.store));
  await as(b, () => sync.pull(b.store));
  assert.equal(b.store.song('s7').status, 'canplay');

  // A phone's newer song stays when an older record comes in (the Worker's own rule is
  // backend/tests/integration/guitar-sync.test.ts's).
  world.t += 1000;
  b.store.update('s7', { bar: 12 });
  const older = { ...worker.rows.get('s7'), song: { ...worker.rows.get('s7').song, bar: 3 } };
  sync.apply(b.store, b.storage, sync.loadMemory(b.storage), [older]);
  assert.equal(b.store.song('s7').bar, 12);
});

test('a push sends only the changed songs, one record each, and nothing before a pull', async () => {
  const a = phone();
  for (const id of [1, 2, 3]) a.store.open(song(id));
  await as(a, () => sync.push(a.store));
  assert.equal(worker.requests.length, 0, 'no push before a pull came back');
  await as(a, async () => {
    await sync.pull(a.store);
    await sync.push(a.store);
  });
  assert.equal(worker.requests.filter((r) => r.method === 'PUT').at(-1).body.items.length, 3);
  world.t += 5000;
  a.store.practice('s2', 5);
  worker.requests.length = 0;
  await as(a, () => sync.push(a.store));
  assert.deepEqual(worker.requests.map((r) => r.body?.items.map((i) => i.key)), [['s2']]);
  assert.equal(worker.requests[0].keepalive, true);
  worker.requests.length = 0;
  await as(a, () => sync.push(a.store));
  assert.equal(worker.requests.length, 0, 'nothing changed: nothing sent');
});

test("after a sign-out, the same version brings the ladder back; a ladder's own sections are kept", async () => {
  const a = phone();
  a.store.open(song(5));
  practise(a, 's5', { '2-3': sec(90) });
  await as(a, async () => {
    await sync.pull(a.store);
    await sync.push(a.store);
  });
  // Sign-out: `th.p.*` goes (the ladder and the sync's memory); the library stays.
  a.storage.removeItem(LADDER);
  a.storage.removeItem(sync.SYNC_KEY);
  await as(a, () => sync.pull(a.store));
  assert.equal(ladderOf(a.storage, 's5')['2-3'].best, 90);

  // Practised signed out, then signed in: this phone's newer record stays, the Worker's sections join it.
  a.storage.removeItem(LADDER);
  a.storage.removeItem(sync.SYNC_KEY);
  world.t += 10_000;
  practise(a, 's5', { '7-9': sec(60) });
  await as(a, async () => {
    await sync.pull(a.store);
    await sync.push(a.store);
  });
  assert.deepEqual(Object.keys(ladderOf(a.storage, 's5')).sort(), ['2-3', '7-9']);
  assert.deepEqual(Object.keys(worker.rows.get('s5').ladder).sort(), ['2-3', '7-9']);
});
