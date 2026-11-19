// Astra the same on every phone, the engine (frontend/astra/src/app/sync.js; ASTRA.md §5.3) on Astra's real
// store and worker-api.js, against an invented Worker that keeps one copy with conditional saves: signed out
// or switched off nothing is sent; a first start saves what the phone has (backup keys only); a change goes out
// a minute after the last; a removal travels as a tombstone; a fresh phone takes the other's; a conflict three
// times or a server that is down stays quiet and is tried again later; a keepalive save when the page hides,
// unless it is too big; back after five minutes it fetches; clocks an hour apart; a damaged or unreadable copy
// never changes the phone; removing the copy. Invented add-ons, titles, token and times.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAVE_AFTER } from '../frontend/astra/src/app/sync.js';
import { T, MIN, ADDON, film, settle, worker, phone } from './fixtures/astra-sync-phones.mjs';

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
  assert.deepEqual([w.calls[0].query, w.calls[1].query], ['', ''], 'nothing held yet, nothing kept: no version named');
  assert.deepEqual(Object.keys(put.keys).sort(), ['addons', 'progress'], 'what is saved; never a device key');
  assert.deepEqual(put.keys.addons.value, [ADDON]);
  assert.ok(put.keys.addons.at >= T, 'stamped at the first merge');
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
  assert.deepEqual(w.calls.map((c) => [c.method, c.keepalive, c.query]), [['PUT', true, '?base=v1']]);
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
