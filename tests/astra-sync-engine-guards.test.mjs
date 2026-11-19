// Astra the same on every phone, the engine guarded (frontend/astra/src/app/sync.js; ASTRA.md §5.3), from the
// independent security read's probes (2026-11-19): a far-future copy taken in at most `AHEAD` ahead and saved back
// fixed; a hostile copy that cannot fill the phone; a removed add-on that stays removed; an add-on from elsewhere
// named once; `same` when nothing changed there; a copy too large for the Worker not sent. Invented data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Progress } from '../frontend/astra/src/app/store.js';
import { SAVE_AFTER } from '../frontend/astra/src/app/sync.js';
import { AHEAD } from '../frontend/astra/src/app/sync-read.js';
import { T, MIN, ADDON, film, settle, worker, phone } from './fixtures/astra-sync-phones.mjs';

test('a far-future copy: taken in AHEAD at most and saved back fixed; removing it leaves a tombstone that ends; watching later stays', async () => {
  const DAY = 864e5, FUTURE = 9e15;
  const w = worker();
  w.kept = { version: 'v0', saved_at: null, copy: { astra: 'sync/1', keys: { progress: { at: FUTURE, value: { 'movie:tt1|tt1': { ...film('tt1', FUTURE), time: 30 } } } } } };
  const a = await phone(w, { data: { addons: [ADDON] } });
  assert.equal(a.read('progress')['movie:tt1|tt1'].updated, T + AHEAD, 'taken in, AHEAD at most');
  assert.ok(a.record().at.progress <= T + AHEAD, 'the key’s time too');
  assert.equal(w.kept.copy.keys.progress.value['movie:tt1|tt1'].updated, T + AHEAD, 'and saved back fixed, so it falls into the past');
  // Past that time, real watching here wins over it, on the phone and on the server.
  await a.advance(AHEAD + MIN);
  const p = new Progress(a.store, () => a.t);
  p.save({ type: 'movie', id: 'tt1', videoId: 'tt1', time: 3000, duration: 6000, meta: { id: 'tt1', type: 'movie', name: 'Invented' } });
  p.flush(true);
  await a.advance(SAVE_AFTER);
  assert.equal(w.kept.copy.keys.progress.value['movie:tt1|tt1'].time, 3000);
  // Cleared, then 400 days later watched again: the tombstone ended, the watching stays.
  a.store.remove('progress'); // Clear Continue Watching
  await a.advance(SAVE_AFTER);
  assert.ok(w.kept.copy.keys.progress.gone['movie:tt1|tt1'] <= a.t + AHEAD, 'its tombstone ends like any other');
  await a.advance(400 * DAY);
  const q = new Progress(a.store, () => a.t);
  q.save({ type: 'movie', id: 'tt1', videoId: 'tt1', time: 1200, duration: 6000, meta: { id: 'tt1', type: 'movie', name: 'Invented' } });
  q.flush(true);
  await a.advance(SAVE_AFTER);
  assert.equal(a.read('progress')['movie:tt1|tt1'].time, 1200, 'the watching stays on this phone');
  assert.equal(w.kept.copy.keys.progress.value['movie:tt1|tt1'].time, 1200, 'and on the server');
  // A record poisoned by an earlier far-future stamp: the next change is stamped AHEAD at most.
  const b = await phone(worker(), { data: { addons: [ADDON] }, record: { joined: true, at: { addons: FUTURE } } });
  b.store.set('addons', []);
  assert.ok(b.record().at.addons <= b.t + AHEAD);
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

// The security read's plant probe: anyone holding a device session can write the copy, so an add-on that arrives
// from elsewhere is said once, by name and host, never silently (a new phone's first merge included).
test('an add-on this phone did not have is said once, by name and host', async () => {
  const w = worker();
  const a = await phone(w, { data: { addons: [ADDON] } });
  const planted = { url: 'https://tracker.example/invented/manifest.json', enabled: true, name: 'Cinemeta' };
  w.kept = { version: 'v9', saved_at: null, copy: { astra: 'sync/1', keys: { ...w.kept.copy.keys, addons: { at: T + 10 * MIN, value: [ADDON, planted] } } } };
  a.toasts.length = 0;
  await a.page('hidden');
  await a.advance(6 * MIN);
  await a.page('visible');
  assert.deepEqual(a.read('addons').map((x) => x.url), [ADDON.url, planted.url]);
  assert.deepEqual(a.toasts, ['Added from your other phones: Cinemeta (tracker.example)']);
  await a.sync.syncNow();
  assert.equal(a.toasts.length, 1, 'once');
  // A new phone's first merge: every add-on it gets is named, by count and hosts when there are several.
  const two = worker();
  two.kept = { version: 'v1', saved_at: null, copy: { astra: 'sync/1', keys: { addons: { at: T, value: [ADDON, { url: 'https://addon2.example/x/manifest.json', enabled: true, name: 'Two' }] } } } };
  const b = await phone(two);
  assert.deepEqual(b.toasts, ['Added from your other phones: 2 add-ons (addon.example, addon2.example)']);
});

// The Free plan's CPU and the phone's mobile data: a phone names the version it holds, so an unchanged copy is
// answered `same` from the object's head and never sent again; a copy larger than the Worker takes is not sent.
test('nothing changed there: asked with the version held, answered `same`, and only this phone’s own changes are saved', async () => {
  const w = worker();
  const a = await phone(w, { data: { addons: [ADDON] } });
  w.calls = [];
  await a.sync.syncNow();
  assert.deepEqual(w.calls.map((c) => [c.method, c.query]), [['GET', '?known=v1']], 'same: nothing downloaded, nothing saved');
  // A restart of this phone: the same.
  const again = await phone(w, { data: { addons: [ADDON] }, record: a.record() });
  assert.deepEqual(w.calls.slice(1).map((c) => [c.method, c.query]), [['GET', '?known=v1']]);
  assert.deepEqual(again.toasts, []);
  // A change here, nothing there: saved on the version held, without taking the copy in.
  w.calls = [];
  a.library.toggle({ id: 'tt01', type: 'movie', name: 'Invented' });
  await a.advance(SAVE_AFTER);
  assert.deepEqual(w.calls.map((c) => [c.method, c.query]), [['GET', '?known=v1'], ['PUT', '?base=v1']]);
  assert.deepEqual(Object.keys(w.kept.copy.keys.library.value), ['movie:tt01']);
  // Another phone saved meanwhile: the version held is no longer kept, so the whole copy comes and is merged.
  w.kept = { ...w.kept, version: 'v9', copy: { ...w.kept.copy, keys: { ...w.kept.copy.keys, settings: { at: a.t, value: { hero: false } } } } };
  await a.sync.syncNow();
  assert.deepEqual(a.read('settings'), { hero: false });
});

test('a copy larger than the Worker takes is not sent, and Settings is told', async () => {
  const w = worker();
  const library = {};
  for (let i = 0; i < 7000; i++) library[`movie:tt${1_000_000 + i}`] = { id: `tt${1_000_000 + i}`, type: 'movie', name: `An Invented Film Number ${i}`, poster: `https://images.example/poster/${i}/w342-abcdefghijklmnopqrstuvwxyz0123456789.jpg`, added: T - i };
  const a = await phone(w, { data: { addons: [ADDON], library } });
  assert.deepEqual([w.methods(), a.sync.state().problem], [['GET'], 'too-big']);
});
