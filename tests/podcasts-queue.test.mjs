// Up Next and the playback speed on every phone (th/podcasts/queue.js through th/podcasts/progress.js,
// PODCASTS.md §5.4) against a fake Worker that keeps them as the real one does (the newer stamp wins
// row by row; a member held as removed after the phone's `base` stays removed; the queue is the
// members at the newest stamp). Two phones edit both ways; a removal does not come back; a sign-out
// wipes Podcasts' store and the sync's memory (th/session.js) and signing in again brings the queue,
// the speed and the played marks back, without the empty phone writing over the account; a pull
// after the app runs goes into its state in memory. Synthetic shows and episodes only.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PODCAST_LIMITS, PODCAST_SPEEDS } from '../shared/contract/podcasts.ts';
import * as sync from '../frontend/th/podcasts/progress.js';
import * as q from '../frontend/th/podcasts/queue.js';

const FEED = 'https://feeds.example.org/up-next.xml';
const id = (n) => n.toString(16).padStart(16, '0');
const key = (n) => `${FEED}#${id(n)}`;
const ep = (n) => ({ id: id(n), title: `Episode ${n}`, description: 'd'.repeat(3000), audioUrl: `https://media.example.org/${n}.mp3`, show: { feedUrl: FEED, title: 'A show', description: 'about' } });
let clock = 1_800_000_000_000;
const BY = 1700;

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), keys: () => [...m.keys()], m };
}

/** All four routes, the Worker's rules; every answer carries its clock (the phones' clock too). */
function fakeWorker() {
  const w = { progress: new Map(), queue: new Map(), prefs: new Map(), requests: [] };
  const json = (b) => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } });
  w.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const route = u.pathname.split('/').pop();
    const body = init.body ? JSON.parse(init.body) : undefined;
    w.requests.push({ method: init.method, route, body });
    const at = ++clock;
    if (init.method === 'PUT') {
      let applied = 0;
      for (const it of body.items) {
        const map = w[route];
        const id = it.key ?? it.name ?? it.feed_url;
        const had = map?.get(id);
        if (had && had.updated_at >= it.updated_at) continue;
        if (route === 'queue' && it.queued && had && !had.queued && had.updated_at > it.base) continue;
        const { base: _, ...row } = it;
        map?.set(id, { ...row, synced_at: at });
        applied++;
      }
      return json({ applied, stale: body.items.length - applied, refused: [], at });
    }
    const since = Number(u.searchParams.get('since') ?? 0);
    const items = [...(w[route]?.values() ?? [])].filter((r) => r.synced_at >= since).map(({ synced_at: _, ...r }) => r);
    return json({ items, next_since: at, next: null });
  };
  return w;
}

/** One phone: its own storage; the sync module is one per page, so it is reset when phones change. */
const phone = () => ({ storage: memoryStorage() });
let worker;
/** @param {{ storage: ReturnType<typeof memoryStorage> }} p */
function on(p) {
  sync.reset();
  Object.assign(sync.deps, {
    fetch: worker.fetch,
    now: () => clock,
    sincePage: () => 200,
    storage: () => p.storage,
    token: async () => 'th1_session',
    framed: () => false,
    api: () => 'https://api.example.test',
    online: () => true,
    intents: async () => null,
  });
  return p;
}
const appOf = (p) => JSON.parse(p.storage.getItem(sync.APP_KEY) || 'null');
const setApp = (p, s) => p.storage.setItem(sync.APP_KEY, JSON.stringify({ version: 1, follows: [], queue: [], progress: {}, speed: 1, ...appOf(p), ...s }));
const queueOf = (p) => (appOf(p)?.queue ?? []).map((e) => Number.parseInt(e.id, 16));
/** A phone opening Podcasts, then using it and closing it (open, then a push). */
async function session(p, edit) {
  on(p);
  await sync.open(BY);
  if (edit) setApp(p, edit(appOf(p)));
  clock += 1000;
  await sync.push();
}

beforeEach(() => {
  worker = fakeWorker();
});

test('its limits and speeds are the Worker’s', () => {
  assert.equal(q.EPISODE_CHARS, PODCAST_LIMITS.episode_chars);
  assert.deepEqual([...q.SPEEDS], [...PODCAST_SPEEDS]);
});

test('an episode goes up slimmed: its show’s description out, its own cut; too long, only what plays it', () => {
  const s = q.slim(ep(1));
  assert.equal(s.description.length, 1000);
  assert.equal(s.show.description, undefined);
  assert.equal(s.audioUrl, ep(1).audioUrl);
  const long = q.slim({ ...ep(2), website: `https://x.example/${'w'.repeat(9000)}` });
  assert.deepEqual(Object.keys(long).sort(), ['audioUrl', 'id', 'show', 'title']);
});

test('two phones, both ways: the queue’s order and members, and the speed', async () => {
  const a = phone();
  const b = phone();
  setApp(a, { queue: [ep(1), ep(2), ep(3)], speed: 1.5 });
  await session(a);
  // A's first look had the account empty: its queue and speed went up.
  assert.deepEqual([...worker.queue.values()].filter((r) => r.queued).map((r) => r.pos), [0, 1, 2]);
  assert.equal(worker.prefs.get('speed').value, 1.5);
  // B, a new phone, gets both; then moves 3 first, takes 2 out and plays at 2×.
  await session(b, (s) => ({ queue: [s.queue[2], s.queue[0]], speed: 2 }));
  assert.equal(appOf(b).speed, 2);
  assert.equal(appOf(b).queue[1].description.length, 1000, 'an episode B never had comes with its details');
  // A gets B's version and speed; its own copy of an episode stays (the full description).
  await session(a, (s) => ({ queue: [...s.queue, ep(4)] }));
  assert.deepEqual(queueOf(a), [3, 1, 4]);
  assert.equal(appOf(a).speed, 2);
  assert.equal(appOf(a).queue[0].description.length, 3000);
  // And B gets A's.
  await session(b);
  assert.deepEqual(queueOf(b), [3, 1, 4]);
  // Nothing new: nothing goes up again.
  worker.requests = [];
  await session(b);
  assert.deepEqual(worker.requests.filter((r) => r.method === 'PUT'), []);
});

test('a removal does not come back: another phone’s newer version made without seeing it', async () => {
  const a = phone();
  const b = phone();
  setApp(a, { queue: [ep(1), ep(2)] });
  await session(a);
  await session(b);
  assert.deepEqual(queueOf(b), [1, 2]);
  // A takes 1 out; B, which has not seen that, adds 5 later (its version is newer).
  await session(a, (s) => ({ queue: s.queue.slice(1) }));
  on(b);
  setApp(b, { queue: [...appOf(b).queue, ep(5)] });
  clock += 1000;
  await sync.push();
  await session(b);
  assert.deepEqual(queueOf(b), [2, 5], 'B drops 1 too');
  await session(a);
  assert.deepEqual(queueOf(a), [2, 5]);
});

test('a sign-out wipes Podcasts’ store; signing in again brings the queue, speed and played marks back', async () => {
  // What th/session.js removes at a sign-out: the app's store and every `th.p.*` key (the sync's memory).
  const wipe = readFileSync(new URL('../frontend/th/session.js', import.meta.url), 'utf8');
  assert.match(wipe, /SYNCED_KEYS = \[[^\]]*'jarvis\.podcasts\.v1'/);
  assert.match(wipe, /key\.startsWith\('th\.p\.'\)/);
  assert.ok(sync.SYNC_KEY.startsWith('th.p.'));
  const a = phone();
  setApp(a, { queue: [ep(1), ep(2)], speed: 1.75, progress: { [key(9)]: { position: 0, duration: 60, played: true, updatedAt: clock - 5 } } });
  await session(a);
  for (const k of a.storage.keys()) if (k.startsWith('th.p.') || k === sync.APP_KEY) a.storage.removeItem(k);
  assert.equal(appOf(a), null);
  // Signed in again, the phone's first push runs before any pull: its empty Podcasts writes nothing over the account.
  on(a);
  setApp(a, {});
  await sync.push();
  assert.equal(worker.prefs.get('speed').value, 1.75);
  assert.equal([...worker.queue.values()].filter((r) => r.queued).length, 2);
  await session(a);
  assert.deepEqual(queueOf(a), [1, 2]);
  assert.equal(appOf(a).speed, 1.75);
  assert.equal(appOf(a).progress[key(9)].played, true);
});

test('a pull after the app runs goes into its state in memory, and says what changed', async () => {
  const a = phone();
  const b = phone();
  setApp(a, { queue: [ep(1)] });
  await session(a);
  on(b);
  await sync.open(BY);
  const state = { version: 1, follows: [], progress: {}, ...appOf(b) };
  const told = [];
  sync.attach({ state: () => state, commit: () => (b.storage.setItem(sync.APP_KEY, JSON.stringify(state)), true), pulled: (k) => told.push(...k) });
  // Meanwhile A plays at 1.25× and queues 2.
  const bs = sync.deps.storage;
  await session(a, (s) => ({ queue: [...s.queue, ep(2)], speed: 1.25 }));
  on(b);
  sync.deps.storage = bs;
  sync.attach({ state: () => state, commit: () => true, pulled: (k) => told.push(...k) });
  await sync.refresh();
  assert.deepEqual(state.queue.map((e) => Number.parseInt(e.id, 16)), [1, 2]);
  assert.equal(state.speed, 1.25);
  assert.ok(told.includes('queue') && told.includes('speed'));
});

test('a version that came in two requests is completed when the rest arrives', () => {
  const mem = {};
  const app = { queue: [] };
  q.noteQueue(app, mem, 10);
  const row = (n, pos) => ({ key: key(n), pos, queued: true, episode: ep(n), updated_at: 500 });
  q.applyQueue(app, mem, [row(1, 0), row(3, 2)]);
  q.applyQueue(app, mem, [row(2, 1)]);
  assert.deepEqual(app.queue.map((e) => Number.parseInt(e.id, 16)), [1, 2, 3]);
  assert.equal(q.noteQueue(app, mem, 600), false, 'nothing of its own to send');
});
