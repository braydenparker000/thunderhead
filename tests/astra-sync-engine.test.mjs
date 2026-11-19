// Astra the same on every phone, the engine (frontend/astra/src/app/sync.js; ASTRA.md §5.3) on Astra's real
// store and worker-api.js, against an invented Worker that keeps one copy with conditional saves: signed out
// or switched off nothing is sent; a first start saves what the phone has (backup keys only); a change goes out
// a minute after the last; a removal travels as a tombstone; a fresh phone takes the other's; a conflict three
// times or a server that is down stays quiet and is tried again later; a keepalive save when the page hides,
// unless it is too big; back after five minutes it fetches; clocks an hour apart; a damaged or unreadable copy
// never changes the phone; removing the copy. Invented add-ons, titles, token and times.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, Library, Progress, PREFIX } from '../frontend/astra/src/app/store.js';
import { startSync, RECORD, SAVE_AFTER } from '../frontend/astra/src/app/sync.js';
import { api } from '../frontend/astra/src/addons/worker-api.js';

const T = 1_763_600_000_000, MIN = 60_000;
const ADDON = { url: 'https://addon.example/invented-config-0011/manifest.json', enabled: true, name: 'Invented' };
const film = (id, updated) => ({ type: 'movie', id, videoId: id, season: null, episode: null, time: 600, duration: 6000, updated, completed: false, meta: { id, type: 'movie', name: `Invented ${id}` } });
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The invented Worker: one copy, conditional saves, every request recorded. */
function worker() {
  let n = 0;
  const w = { kept: null, calls: [], down: 0, conflict: false, answer: null };
  w.fetch = async (url, init = {}) => {
    const method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : undefined;
    w.calls.push({ method, path: new URL(url).pathname, keepalive: init.keepalive === true, body, auth: init.headers?.Authorization });
    if (w.down) return json(w.down, { error: { code: 'unavailable', message: 'Down.' } });
    if (method === 'GET') return json(200, w.answer ?? (w.kept ? structuredClone(w.kept) : { version: null, saved_at: null, copy: null }));
    if (method === 'DELETE') { w.kept = null; return new Response(null, { status: 204 }); }
    if (w.conflict || (w.kept?.version ?? null) !== body.base) return json(409, { error: { code: 'conflict', message: 'Stale.', details: { reason: 'stale_base' } } });
    w.kept = { version: `v${++n}`, saved_at: new Date(T).toISOString(), copy: body.copy };
    return json(200, { version: w.kept.version, saved_at: w.kept.saved_at });
  };
  w.methods = () => w.calls.map((c) => c.method);
  return w;
}

function memory(entries = {}) {
  const m = new Map(Object.entries(entries));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}

/** A phone: Astra's store over its own storage, its clock (`offset` from true time), timers, page and window. */
async function phone(w, { data = {}, signedIn = true, offset = 0, record = null } = {}) {
  const area = memory(Object.fromEntries(Object.entries(data).map(([k, v]) => [PREFIX + k, JSON.stringify(v)])));
  if (record) area.setItem(RECORD, JSON.stringify(record));
  const win = new EventTarget();
  const store = createStorage(area, { events: win });
  const p = { area, store, t: T + offset, queue: [], toasts: [], doc: Object.assign(new EventTarget(), { visibilityState: 'visible' }), set: store.set, channel: new EventTarget() };
  p.library = new Library(store);
  p.app = { store, playing: null };
  const later = (fn, ms) => { const id = Symbol('timer'); p.queue.push({ id, at: p.t + ms, fn }); return id; };
  const cancel = (id) => { p.queue = p.queue.filter((x) => x.id !== id); };
  p.advance = async (ms) => { p.t += ms; for (const due of p.queue.filter((x) => x.at <= p.t)) { cancel(due.id); due.fn(); } await settle(); };
  p.read = (k) => JSON.parse(area.getItem(PREFIX + k) ?? 'null');
  p.record = () => JSON.parse(area.getItem(RECORD) ?? 'null');
  p.page = async (state) => { p.doc.visibilityState = state; p.doc.dispatchEvent(new Event('visibilitychange')); await settle(); };
  const session = async () => (signedIn ? { api: 'https://api.example.test', token: 'invented-session-token' } : null);
  p.sync = startSync(p.app, {
    api: (path, o = {}) => api(path, { ...o, read: session, fetchFn: o.fetchFn ?? w.fetch }), session, storage: area, now: () => p.t,
    later, cancel, idle: (fn) => fn(), win, doc: p.doc, toast: (t) => p.toasts.push(t), fetch: w.fetch, channel: () => p.channel,
    // Node has no StorageEvent: the same event's shape, which the store's own listener reads.
    announce: (k) => win.dispatchEvent(Object.assign(new Event('storage'), { key: PREFIX + k, storageArea: area })),
  });
  await p.sync.ready;
  await settle();
  return p;
}

test('signed out, or switched off: nothing is hooked or sent, whatever happens', async () => {
  const w = worker();
  const out = await phone(w, { signedIn: false, data: { addons: [ADDON] } });
  assert.equal(out.store.set, out.set, 'the store is left as it is');
  out.library.toggle({ id: 'tt01', type: 'movie', name: 'Invented' });
  await out.page('hidden');
  await out.advance(10 * MIN);
  await out.sync.syncNow();
  assert.deepEqual([w.calls, out.record()], [[], null]);
  const off = await phone(w, { record: { off: true }, data: { addons: [ADDON] } });
  off.library.toggle({ id: 'tt02', type: 'movie', name: 'Invented' });
  await off.page('hidden');
  await off.advance(10 * MIN);
  await off.sync.syncNow();
  assert.deepEqual(w.calls, []);
});

test('a first start saves what the phone has, its backup keys only, and says nothing', async () => {
  const w = worker();
  const a = await phone(w, { data: { addons: [ADDON], progress: { 'movie:tt01|tt01': film('tt01', T) }, player: { volume: 0.5 }, librarySort: 'added' } });
  assert.deepEqual(w.methods(), ['GET', 'PUT']);
  assert.equal(w.calls[0].auth, 'Bearer invented-session-token');
  const put = w.calls[1].body;
  assert.equal(put.base, null);
  assert.deepEqual(Object.keys(put.copy.keys).sort(), ['addons', 'progress'], 'what is saved; never a device key');
  assert.deepEqual(put.copy.keys.addons.value, [ADDON]);
  assert.ok(put.copy.keys.addons.at >= T, 'stamped at the first merge');
  assert.deepEqual([a.record().joined, a.record().version, a.record().owed, a.sync.state().savedAt], [true, 'v1', false, T]);
  assert.deepEqual(a.toasts, []);
});

test('a change goes out a minute after the last; a removal travels as a tombstone; a fresh phone takes it all', async () => {
  const w = worker();
  const a = await phone(w, { data: { addons: [ADDON], library: { 'movie:tt01': { id: 'tt01', type: 'movie', name: 'Invented', added: T - MIN } } } });
  w.calls = [];
  a.library.toggle({ id: 'tt02', type: 'movie', name: 'Invented Two' });
  await a.advance(30_000);
  a.library.toggle({ id: 'tt01', type: 'movie', name: 'Invented' }); // removed
  await a.advance(SAVE_AFTER - 1);
  assert.deepEqual(w.calls, [], 'not before a minute after the last change');
  await a.advance(1);
  assert.deepEqual(w.methods(), ['GET', 'PUT']);
  const lib = w.kept.copy.keys.library;
  assert.deepEqual(Object.keys(lib.value), ['movie:tt02']);
  assert.ok(lib.gone['movie:tt01'] > T - MIN, 'the removal, with its time');
  // A fresh phone, nothing saved: it takes everything, and saves nothing back.
  w.calls = [];
  const b = await phone(w, { offset: 2 * MIN });
  assert.deepEqual(w.methods(), ['GET']);
  assert.deepEqual([b.read('addons'), Object.keys(b.read('library'))], [[ADDON], ['movie:tt02']]);
  // Removed on B: A loses it the next time it comes back to the front after five minutes.
  b.library.toggle({ id: 'tt02', type: 'movie', name: 'Invented Two' });
  await b.advance(SAVE_AFTER);
  await a.page('hidden');
  await a.advance(4 * MIN);
  await a.page('visible');
  assert.deepEqual(Object.keys(a.read('library')), ['movie:tt02'], 'back sooner than five minutes: nothing asked');
  await a.page('hidden');
  await a.advance(6 * MIN);
  await a.page('visible');
  assert.deepEqual(a.read('library'), {});
});

test('a conflict three times, or a server that is down, stays quiet and is tried again later, each wait longer', async () => {
  const w = worker();
  w.conflict = true;
  const a = await phone(w, { data: { addons: [ADDON] } });
  assert.deepEqual(w.methods(), ['GET', 'PUT', 'GET', 'PUT', 'GET', 'PUT']);
  assert.deepEqual([a.toasts, a.sync.state().problem, a.record().owed], [[], 'unreached', true]);
  w.conflict = false;
  w.down = 503;
  w.calls = [];
  await a.advance(MIN);
  assert.deepEqual(w.methods(), ['GET'], 'tried again after a minute');
  await a.advance(MIN);
  assert.deepEqual(w.methods(), ['GET'], 'then the wait is longer');
  await a.advance(MIN);
  assert.deepEqual(w.methods(), ['GET', 'GET']);
  w.down = 0;
  await a.advance(5 * MIN);
  assert.deepEqual([w.methods().at(-1), a.sync.state().problem, a.record().owed], ['PUT', '', false]);
});

test('hidden with changes: a keepalive save, unless it is larger than a keepalive may carry', async () => {
  const w = worker();
  const a = await phone(w, { data: { addons: [ADDON] } });
  w.calls = [];
  a.library.toggle({ id: 'tt01', type: 'movie', name: 'Invented' });
  await a.page('hidden');
  assert.deepEqual(w.calls.map((c) => [c.method, c.keepalive, c.body?.base]), [['PUT', true, 'v1']]);
  assert.deepEqual([a.record().owed, a.record().version, a.queue.length], [false, 'v2', 0]);
  // Larger than 63 KiB: nothing is sent now; the next start sends it.
  w.calls = [];
  await a.page('visible');
  a.store.set('recentSearches', Array.from({ length: 10 }, (_, i) => `${i}`.padEnd(7000, 'x')));
  await a.page('hidden');
  assert.deepEqual([w.calls, a.record().owed], [[], true]);
});

test('clocks an hour apart: a change made after seeing the other phone’s still wins', async () => {
  const w = worker();
  const ahead = await phone(w, { offset: 60 * MIN, data: { addons: [ADDON] } });
  const b = await phone(w, { offset: 5 * MIN });
  assert.deepEqual(b.read('addons'), [ADDON]);
  // B, by its clock 55 minutes "before" A's save, removes the add-on ten minutes later.
  await b.advance(10 * MIN);
  b.store.set('addons', []);
  await b.advance(SAVE_AFTER);
  assert.deepEqual(w.kept.copy.keys.addons.value, []);
  await ahead.sync.syncNow();
  assert.deepEqual(ahead.read('addons'), [], 'A follows B');
});

test('a damaged or unreadable copy never changes the phone; a newer Astra’s is left alone', async () => {
  const w = worker();
  w.kept = { version: 'v9', saved_at: null, copy: { astra: 'sync/1', keys: { addons: { at: T, value: 'not a list' }, settings: { at: T, value: { hero: false } } } } };
  const a = await phone(w, { data: { addons: [ADDON] } });
  assert.deepEqual([a.read('addons'), a.read('settings')], [[ADDON], { hero: false }], 'the damaged key is not used; the good one is');
  assert.deepEqual([w.kept.version, w.kept.copy.keys.addons.value], ['v1', [ADDON]], 'the next save mends it');
  // An answer that is no copy at all (another server, a mock): nothing is merged or saved.
  const odd = worker();
  odd.answer = { accepted: 1, rejected: [] };
  const b = await phone(odd, { data: { addons: [ADDON] } });
  assert.deepEqual([odd.methods(), b.read('addons'), b.sync.state().problem], [['GET'], [ADDON], 'unreached']);
  const newer = worker();
  newer.kept = { version: 'v5', saved_at: null, copy: { astra: 'sync/2', keys: {} } };
  const c = await phone(newer, { data: { addons: [ADDON] } });
  assert.deepEqual([newer.methods(), c.sync.state().problem], [['GET'], 'newer']);
});

test('removing the copy on the server: a DELETE, then this phone stops keeping one', async () => {
  const w = worker();
  const a = await phone(w, { data: { addons: [ADDON] } });
  w.calls = [];
  assert.deepEqual(await a.sync.removeCopy(), { ok: true });
  assert.deepEqual([w.methods(), w.kept, a.sync.state().on], [['DELETE'], null, false]);
  a.library.toggle({ id: 'tt01', type: 'movie', name: 'Invented' });
  await a.advance(10 * MIN);
  await a.page('hidden');
  assert.deepEqual(w.methods(), ['DELETE']);
  // On again: merged as a first time (nothing lost), and saved.
  a.sync.setOn(true);
  await settle();
  assert.deepEqual(w.methods(), ['DELETE', 'GET', 'PUT']);
  assert.deepEqual(Object.keys(w.kept.copy.keys).sort(), ['addons', 'library']);
});

test('the session ends: in step, nothing of the copy stays or is written back; a phone that never joined keeps its own', async () => {
  // The server ends the session (signed out from another device): this phone's copy goes, as th/session.js wipe() does.
  const w = worker();
  const a = await phone(w, { data: { addons: [ADDON], library: { 'movie:tt01': { id: 'tt01', type: 'movie', name: 'Invented', added: T } }, player: { volume: 1 } } });
  assert.equal(a.record().joined, true);
  w.down = 401;
  await a.sync.syncNow();
  assert.deepEqual([a.area.length, a.sync.state().signedIn], [0, false], 'every astra.v2 key and the record are gone');
  assert.equal(a.store.set('addons', [ADDON]), false, 'and nothing this page holds is written back');
  // Never joined (its first exchange was refused): its data is its own and stays.
  const w2 = worker();
  w2.down = 401;
  const b = await phone(w2, { data: { addons: [ADDON] } });
  assert.deepEqual([b.read('addons'), b.store.set('settings', { hero: false })], [[ADDON], true]);
  // Signed out in another tab: th/session.js has removed the data and says so on its channel; this page stops writing.
  const c = await phone(worker(), { data: { addons: [ADDON] } });
  c.channel.dispatchEvent(new MessageEvent('message', { data: 'signed_out' }));
  assert.equal(c.store.set('settings', { hero: false }), false);
  const off = await phone(worker(), { data: { addons: [ADDON] }, record: { joined: true, off: true } });
  off.channel.dispatchEvent(new MessageEvent('message', { data: 'signed_out' }));
  assert.equal(off.store.set('settings', { hero: false }), true, 'switched off, the data is the phone’s own');
});

test('a far-future copy: taken in a day ahead at most; removing it leaves a tombstone that ends; watching later stays', async () => {
  const DAY = 864e5, FUTURE = 9e15;
  const w = worker();
  w.kept = { version: 'v0', saved_at: null, copy: { astra: 'sync/1', keys: { progress: { at: FUTURE, value: { 'movie:tt1|tt1': film('tt1', FUTURE) } } } } };
  const a = await phone(w, { data: { addons: [ADDON] } });
  assert.equal(a.read('progress')['movie:tt1|tt1'].updated, T + DAY, 'taken in, a day ahead at most');
  assert.ok(a.record().at.progress <= T + DAY, 'the key’s time too');
  a.store.remove('progress'); // Clear Continue Watching
  await a.advance(SAVE_AFTER);
  assert.ok(w.kept.copy.keys.progress.gone['movie:tt1|tt1'] <= a.t + DAY, 'its tombstone ends like any other');
  await a.advance(400 * DAY);
  const p = new Progress(a.store, () => a.t);
  p.save({ type: 'movie', id: 'tt1', videoId: 'tt1', time: 1200, duration: 6000, meta: { id: 'tt1', type: 'movie', name: 'Invented' } });
  p.flush(true);
  await a.advance(SAVE_AFTER);
  assert.equal(a.read('progress')['movie:tt1|tt1'].time, 1200, 'the watching stays on this phone');
  assert.equal(w.kept.copy.keys.progress.value['movie:tt1|tt1'].time, 1200, 'and on the server');
  // A record poisoned by an earlier far-future stamp: the next change is stamped a day ahead at most.
  const b = await phone(worker(), { data: { addons: [ADDON] }, record: { joined: true, at: { addons: FUTURE } } });
  b.store.set('addons', []);
  assert.ok(b.record().at.addons <= b.t + DAY);
});

test('a hostile copy does not fill the phone’s storage', async () => {
  const w = worker();
  w.kept = { version: 'v0', saved_at: null, copy: { astra: 'sync/1', keys: { settings: { at: T, value: { hero: false, junk: 'x'.repeat(1_900_000) } } } } };
  const a = await phone(w, { data: { addons: [ADDON] } });
  assert.deepEqual(a.read('settings'), { hero: false });
});

test('a removed add-on does not come back from a phone that changed its list offline, nor from one switched off and on', async () => {
  const w = worker();
  const OTHER = { url: 'https://addon.example/invented-leaked-key/manifest.json', enabled: true, name: 'Leaked' };
  const a = await phone(w, { data: { addons: [ADDON, OTHER] } });
  const b = await phone(w, { offset: MIN });
  const c = await phone(w, { offset: MIN });
  assert.deepEqual([b.read('addons'), c.read('addons')], [[ADDON, OTHER], [ADDON, OTHER]]);
  c.sync.setOn(false); // C stops keeping in step before the removal
  // A removes the add-on whose key leaked; B, offline meanwhile, switches the other one off.
  a.store.set('addons', [ADDON]);
  await a.advance(SAVE_AFTER);
  w.down = 503;
  b.store.set('addons', [{ ...ADDON, enabled: false }, OTHER]);
  await b.advance(SAVE_AFTER);
  w.down = 0;
  await b.advance(SAVE_AFTER);
  assert.deepEqual([b.read('addons'), w.kept.copy.keys.addons.value], [[{ ...ADDON, enabled: false }], [{ ...ADDON, enabled: false }]]);
  // C turns its switch on again: what it has and the server's are put together, minus the removed address.
  c.sync.setOn(true);
  await settle();
  assert.deepEqual([c.read('addons'), w.kept.copy.keys.addons.value.map((x) => x.name)], [[{ ...ADDON, enabled: false }], ['Invented']]);
  // Added again after the removal (here on A): it comes back, everywhere.
  a.store.set('addons', [{ ...ADDON, enabled: false }, OTHER]);
  await a.advance(SAVE_AFTER);
  await c.sync.syncNow();
  assert.deepEqual(c.read('addons').map((x) => x.name), ['Invented', 'Leaked']);
});
