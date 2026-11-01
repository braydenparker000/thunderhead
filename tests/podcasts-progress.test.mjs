// frontend/th/podcasts/progress.js against a fake Worker (NEXT-BATCH.md part 7): on open, the
// Worker's newer positions are written into the ported app's storage before it reads it (an
// episode's details kept, an unknown episode added, an older one left), page by page, and `since`
// moves on; a pull back too late writes nothing and keeps `since`. Then this phone's positions the
// Worker doesn't have go up, in requests of ≤ 100, and its follows and unfollows; a refusal no
// retry fixes is not sent again, an outage is. Signed out or in another site's frame, nothing is
// asked. The key check agrees with the Worker's. Synthetic shows and episodes only.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { progressKeyProblem } from '../shared/contract/podcasts.ts';
import * as sync from '../frontend/th/podcasts/progress.js';

const FEED = 'https://feeds.example.org/show.xml';
const key = (n) => `${FEED}#${n.toString(16).padStart(16, '0')}`;
const NOW = 1_800_000_000_000;
/** When the app stops waiting, in the page's time (`opened(by)`). */
const BY = 1700;

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

/** The Worker's two routes as the phone sees them: newer wins item by item, an item more than an
 * hour ahead of its clock refused by place, pages by when it took each row. `clock` is the Worker's
 * time (the phone's is NOW): every answer carries it. */
function fakeWorker() {
  const w = { rows: new Map(), follows: new Map(), requests: [], fail: null, clock: NOW, pageSize: 500 };
  w.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    w.requests.push({ method: init.method, path: u.pathname, query: u.search, body, auth: init.headers?.Authorization, keepalive: init.keepalive });
    if (w.fail) return new Response(JSON.stringify({ error: { code: 'x' } }), { status: w.fail });
    const json = (b) => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } });
    if (u.pathname === '/v1/podcasts/progress' && init.method === 'PUT') {
      let applied = 0;
      const refused = [];
      body.items.forEach((p, index) => {
        if (p.updated_at > w.clock + 3_600_000) return refused.push({ index, issue: 'updated_at: ahead' });
        const had = w.rows.get(p.key);
        if (had && had.updated_at >= p.updated_at) return;
        w.rows.set(p.key, { ...p, synced_at: w.clock });
        applied++;
      });
      return json({ applied, stale: body.items.length - applied - refused.length, refused, at: w.clock });
    }
    if (u.pathname === '/v1/podcasts/progress') {
      const cursor = u.searchParams.get('cursor');
      const after = cursor ? JSON.parse(atob(cursor)) : [Number(u.searchParams.get('since')) - 0.5, ''];
      const all = [...w.rows.values()].filter((r) => r.synced_at > after[0] || (r.synced_at === after[0] && r.key > after[1]))
        .sort((a, b) => a.synced_at - b.synced_at || (a.key < b.key ? -1 : 1));
      const page = all.slice(0, w.pageSize);
      const last = page.at(-1);
      return json({
        items: page.map(({ synced_at: _, ...p }) => p),
        next_since: w.clock,
        next: all.length > w.pageSize ? btoa(JSON.stringify([last.synced_at, last.key])) : null,
      });
    }
    if (u.pathname === '/v1/podcasts/follows' && init.method === 'PUT') {
      for (const f of body.items) if (!(w.follows.get(f.feed_url)?.updated_at >= f.updated_at)) w.follows.set(f.feed_url, f);
      return json({ applied: body.items.length, stale: 0, refused: [], at: w.clock });
    }
    return new Response('{}', { status: 404 });
  };
  return w;
}

let storage, worker, page;
const app = () => JSON.parse(storage.getItem(sync.APP_KEY));
const memory = () => JSON.parse(storage.getItem(sync.SYNC_KEY));
const setApp = (s) => storage.setItem(sync.APP_KEY, JSON.stringify({ version: 1, follows: [], queue: [], progress: {}, speed: 1, ...s }));
const entry = (position, updatedAt, extra = {}) => ({ position, duration: 1800, played: false, updatedAt, ...extra });

beforeEach(() => {
  storage = memoryStorage();
  worker = fakeWorker();
  page = 200;
  sync.reset();
  Object.assign(sync.deps, {
    fetch: worker.fetch,
    now: () => NOW,
    sincePage: () => page,
    storage: () => storage,
    token: async () => 'th1_session',
    framed: () => false,
    api: () => 'https://api.example.test',
    online: () => true,
  });
});

test('the key check agrees with the Worker’s', () => {
  const keys = [key(1), `${FEED}?a=1&b=2#ep_1-x`, `${FEED}#frag#0123`, 'no-hash', `${FEED}#`, `#${'a'.repeat(16)}`, `ftp://x.example/f#1`,
    `https://user:pw@x.example/f#1`, `${FEED}#has space`, `${FEED}#${'a'.repeat(65)}`, `https://x.example/${'p'.repeat(2000)}#1`, 'https://bad host/#1'];
  for (const k of keys) assert.equal(sync.keyProblem(k) === null, progressKeyProblem(k) === null, k);
});

test('on open: newer positions written in before the app reads, its episode details kept; since moves on', async () => {
  setApp({ progress: { [key(1)]: entry(10, NOW - 5000, { episode: { id: 'e1', title: 'Kept details' } }), [key(2)]: entry(500, NOW - 100) } });
  worker.rows.set(key(1), { key: key(1), position_s: 720, duration_s: 1800, played: false, updated_at: NOW - 1000, synced_at: 10 });
  worker.rows.set(key(2), { key: key(2), position_s: 30, duration_s: 1800, played: false, updated_at: NOW - 9000, synced_at: 11 });
  worker.rows.set(key(3), { key: key(3), position_s: 0, duration_s: 900, played: true, updated_at: NOW - 2000, synced_at: 12 });
  worker.pageSize = 2;
  await sync.open(BY);
  const p = app().progress;
  assert.deepEqual(p[key(1)], { position: 720, duration: 1800, played: false, updatedAt: NOW - 1000, episode: { id: 'e1', title: 'Kept details' } });
  assert.deepEqual(p[key(2)], entry(500, NOW - 100), 'the phone’s newer one stays');
  assert.deepEqual(p[key(3)], { position: 0, duration: 900, played: true, updatedAt: NOW - 2000 });
  assert.equal(memory().since.progress, worker.clock);
  assert.deepEqual(worker.requests.map((r) => r.query.split('=')[0]), ['?since', '?cursor']);
  assert.ok(worker.requests.every((r) => r.auth === 'Bearer th1_session'));
  // Nothing new next time: the same `since`, nothing written.
  worker.requests = [];
  await sync.open(BY);
  assert.equal(worker.requests[0].query, `?since=${worker.clock}`);
});

test('a phone with no Podcasts storage yet gets the positions too', async () => {
  worker.rows.set(key(4), { key: key(4), position_s: 61, duration_s: 100, played: false, updated_at: NOW - 1, synced_at: 3 });
  await sync.open(BY);
  assert.equal(app().version, 1);
  assert.equal(app().progress[key(4)].position, 61);
});

test('a pull back too late writes nothing and keeps since; past the deadline nothing is asked', async () => {
  setApp({ progress: { [key(1)]: entry(10, NOW - 5000) } });
  worker.rows.set(key(1), { key: key(1), position_s: 720, duration_s: 1800, played: false, updated_at: NOW - 1000, synced_at: 10 });
  const slow = worker.fetch;
  sync.deps.fetch = async (...a) => {
    page = BY + 1;
    return slow(...a);
  };
  await sync.open(BY);
  assert.equal(app().progress[key(1)].position, 10);
  assert.equal(storage.getItem(sync.SYNC_KEY), null);
  worker.requests = [];
  await sync.open(BY);
  assert.deepEqual(worker.requests, []);
});

test('signed out, offline or in another site’s frame: nothing is asked', async () => {
  sync.deps.token = async () => null;
  await sync.open(BY);
  await sync.push();
  sync.reset();
  sync.deps.token = async () => 'th1_session';
  sync.deps.framed = () => true;
  setApp({ progress: { [key(1)]: entry(10, NOW) } });
  await sync.open(BY);
  await sync.push();
  sync.reset();
  sync.deps.framed = () => false;
  sync.deps.online = () => false;
  await sync.push();
  assert.deepEqual(worker.requests, []);
});

test('push: what the Worker doesn’t have, ≤ 100 a request, cleaned; nothing again once it has it', async () => {
  const progress = {};
  for (let i = 0; i < 150; i++) progress[key(100 + i)] = entry(i + 0.123, NOW - 10_000 + i);
  progress[key(1)] = { position: Number.NaN, duration: Number.POSITIVE_INFINITY, played: true, updatedAt: NOW - 1 };
  progress['not a key'] = entry(1, NOW);
  setApp({ progress });
  await sync.push();
  const puts = worker.requests.filter((r) => r.method === 'PUT' && r.path.endsWith('/progress'));
  assert.deepEqual(puts.map((r) => r.body.items.length), [100, 51]);
  assert.equal(puts[0].keepalive, false, 'a big request goes without keepalive (its 64 KB are shared)');
  assert.deepEqual(worker.rows.get(key(1)), { key: key(1), position_s: 0, duration_s: 0, played: true, updated_at: NOW - 1, synced_at: worker.rows.get(key(1)).synced_at });
  assert.equal(worker.rows.get(key(100)).position_s, 0.1);
  assert.equal(worker.rows.has('not a key'), false);
  worker.requests = [];
  await sync.push();
  assert.deepEqual(worker.requests, []);
  // A new position goes alone.
  setApp({ ...app(), progress: { ...app().progress, [key(100)]: entry(99, NOW) } });
  await sync.push();
  assert.deepEqual(worker.requests.map((r) => r.body.items.map((p) => p.key)), [[key(100)]]);
  assert.equal(worker.requests[0].keepalive, true, 'a sync while playing outlives a closing page');
});

test('an outage, or a whole request refused, is sent again later', async () => {
  setApp({ progress: { [key(1)]: entry(5, NOW - 3) } });
  for (const status of [503, 422]) {
    worker.fail = status;
    await sync.push();
    worker.fail = null;
    await sync.push();
    assert.equal(worker.rows.get(key(1))?.position_s, 5, String(status));
    worker.rows.clear();
    setApp({ ...app(), progress: { [key(1)]: entry(5, NOW - 1) } });
  }
});

test('one item the Worker refuses stays unsent, and the rest of its request is kept', async () => {
  // This phone's clock runs two hours ahead of the Worker's for one save (before any answer set the offset).
  setApp({ progress: { [key(1)]: entry(5, NOW - 3), [key(2)]: entry(6, NOW + 2 * 3_600_000), [key(3)]: entry(7, NOW - 2) } });
  await sync.push();
  assert.deepEqual([...worker.rows.keys()].sort(), [key(1), key(3)]);
  assert.deepEqual(Object.keys(memory().sent).sort(), [key(1), key(3)]);
  worker.requests = [];
  await sync.push();
  assert.deepEqual(worker.requests.map((r) => r.body.items.map((p) => p.key)), [[key(2)]], 'the refused one is tried again');
  // Once it is due on the Worker's clock, it is taken.
  worker.clock = NOW + 2 * 3_600_000;
  await sync.push();
  assert.equal(worker.rows.get(key(2)).position_s, 6);
});

test('times go on the Worker’s clock: a phone 5 minutes behind sends and reads them right', async () => {
  worker.clock = NOW + 5 * 60_000;
  // Another phone saved key(1) on the Worker 2 minutes ago (Worker time); this phone saved it 4
  // minutes ago by its own clock, which is 1 minute ago in real time: this phone's is newer.
  worker.rows.set(key(1), { key: key(1), position_s: 100, duration_s: 1800, played: false, updated_at: worker.clock - 2 * 60_000, synced_at: worker.clock });
  // key(2): the other phone's is newer (1 minute ago against this phone's 10 minutes ago, real time).
  worker.rows.set(key(2), { key: key(2), position_s: 200, duration_s: 1800, played: false, updated_at: worker.clock - 60_000, synced_at: worker.clock });
  setApp({ progress: { [key(1)]: entry(40, NOW - 4 * 60_000 + 3 * 60_000), [key(2)]: entry(20, NOW - 10 * 60_000) } });
  await sync.open(BY);
  assert.equal(memory().offset, 5 * 60_000);
  assert.equal(app().progress[key(1)].position, 40, 'this phone’s newer one stays');
  assert.deepEqual([app().progress[key(2)].position, app().progress[key(2)].updatedAt], [200, NOW - 60_000], 'read onto the phone’s clock');
  await sync.push();
  assert.deepEqual([worker.rows.get(key(1)).position_s, worker.rows.get(key(1)).updated_at], [40, NOW - 60_000 + 5 * 60_000]);
  assert.equal(worker.rows.get(key(2)).position_s, 200, 'not sent back');
});

test('a refused session is asked for again', async () => {
  let asked = 0;
  sync.deps.token = async () => `th1_${++asked}`;
  setApp({ progress: { [key(1)]: entry(5, NOW - 3) } });
  worker.fail = 401;
  await sync.push();
  worker.fail = null;
  await sync.push();
  assert.equal(asked, 2);
  assert.equal(worker.requests.at(-1).auth, 'Bearer th1_2');
});

test('follows go up once each, an unfollow too, stamped when noticed', async () => {
  const show = (n) => ({ feedUrl: `https://feeds.example.org/${n}.xml`, title: `Show ${n}`, author: 'A host', artwork: 'https://img.example.org/a.jpg', genres: ['x'] });
  setApp({ follows: [show('a'), show('b'), { feedUrl: 'javascript:alert(1)', title: 'bad' }] });
  await sync.push();
  assert.deepEqual([...worker.follows.values()], [
    { feed_url: 'https://feeds.example.org/a.xml', title: 'Show a', author: 'A host', artwork: 'https://img.example.org/a.jpg', followed: true, updated_at: NOW },
    { feed_url: 'https://feeds.example.org/b.xml', title: 'Show b', author: 'A host', artwork: 'https://img.example.org/a.jpg', followed: true, updated_at: NOW },
  ]);
  worker.requests = [];
  await sync.push();
  assert.deepEqual(worker.requests, []);
  sync.deps.now = () => NOW + 60_000;
  setApp({ ...app(), follows: [show('a')] });
  await sync.push();
  assert.deepEqual(worker.requests.map((r) => r.body.items.map((f) => [f.feed_url, f.followed, f.updated_at])), [[['https://feeds.example.org/b.xml', false, NOW + 60_000]]]);
  assert.equal(worker.follows.get('https://feeds.example.org/b.xml').title, 'Show b');
});

test('what it remembers stays small: positions the app no longer keeps are forgotten', async () => {
  setApp({ progress: { [key(1)]: entry(5, NOW - 3), [key(2)]: entry(5, NOW - 3) } });
  await sync.push();
  assert.deepEqual(Object.keys(memory().sent).sort(), [key(1), key(2)]);
  setApp({ ...app(), progress: { [key(2)]: entry(5, NOW - 3) } });
  await sync.push();
  assert.deepEqual(Object.keys(memory().sent), [key(2)]);
});

test('the app’s edit asks once a page: one pull, however often it is called', async () => {
  const a = sync.opened(BY);
  assert.equal(sync.opened(BY), a);
  await a;
  assert.equal(worker.requests.filter((r) => r.method === 'GET').length, 1);
});
