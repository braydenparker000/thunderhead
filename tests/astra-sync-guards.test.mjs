// Astra the same on every phone, guarded (frontend/astra/src/app/sync-read.js, sync-merge.js, sync-addons.js,
// sync-senses.js; ASTRA.md §5.3), from the independent security read's probes (2026-11-19): far-future times taken
// as at most `AHEAD` from now and saved back fixed; a copy that cannot bloat or wedge a phone; a removed add-on that
// stays removed; watching here never hidden from the senses reader by a merge; a merge kept to Astra's own caps.
// Invented titles, add-ons and times.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCopies, readCopy, same } from '../frontend/astra/src/app/sync-merge.js';
import { AHEAD } from '../frontend/astra/src/app/sync-read.js';
import { hideFromSenses, spotsOf } from '../frontend/astra/src/app/sync-senses.js';
import { stampAfter } from '../frontend/astra/src/app/sync-record.js';
import { changes } from '../frontend/th/senses/watch.js';
import { T, MIN, H, addon, meta, film, episode, pkey, prog, lib, side, server } from './fixtures/astra-sync-data.mjs';

// The security read's far-future probes: a time read from a copy, or stamped here, is never taken as later than
// `AHEAD` from now (half the Worker's day), so an entry saved "in the year 287,000" cannot win every merge or leave
// a tombstone that never ends; a key where a time was brought back is saved back with it fixed.
const DAY = 864e5, FUTURE = 9e15;
test('far-future times are taken as AHEAD from now at most: entries, tombstones, stamps; and the copy is saved back fixed', () => {
  const read = readCopy({ astra: 'sync/1', keys: {
    progress: { at: FUTURE, value: prog(film('tt01', FUTURE, 30)), gone: { 'movie:tt02|tt02': FUTURE } },
    library: { at: T, value: lib('tt03', FUTURE) },
    watched: { at: T, value: { 'movie:tt04': FUTURE } },
    settings: { at: T, value: { hero: true } },
  } }, T).keys;
  assert.deepEqual([read.progress.at, read.progress.value['movie:tt01|tt01'].updated, read.progress.gone['movie:tt02|tt02']], [T + AHEAD, T + AHEAD, T + AHEAD]);
  assert.deepEqual([read.library.value['movie:tt03'].added, read.watched.value['movie:tt04']], [T + AHEAD, T + AHEAD]);
  assert.deepEqual([read.progress.clamped, read.library.clamped, read.watched.clamped, read.settings.clamped], [true, true, true, undefined]);
  // Nothing else changed, yet the merge saves the copy back with the fixed times (a far-future time left on the
  // server would be read as "just ahead" again at every fetch, and never fall into the past).
  const r = mergeCopies({ mine: side({ progress: read.progress.value, settings: { hero: true } }, { settings: T }), theirs: read, now: T });
  assert.equal(r.differs, true);
  assert.equal(r.copy.keys.progress.value['movie:tt01|tt01'].updated, T + AHEAD);
  assert.equal(r.copy.keys.progress.clamped, undefined, 'the mark never travels');
  // This phone's own far-future entry (its clock was far ahead) is brought back too, and written back healed.
  const own = mergeCopies({ mine: side({ progress: prog(film('tt05', FUTURE)) }), theirs: {}, now: T });
  assert.equal(own.copy.keys.progress.value['movie:tt05|tt05'].updated, T + AHEAD);
  assert.equal(own.apply.progress['movie:tt05|tt05'].updated, T + AHEAD);
  assert.ok(AHEAD < DAY, 'under the Worker’s own day, so a stamp made here is never refused there');
});

test('a far-future entry loses to real watching once its fixed time is past, and its removal does not delete later watching', () => {
  // Saved back fixed at T + AHEAD (above); past that, a real save wins.
  const fixed = readCopy({ astra: 'sync/1', keys: { progress: { at: T, value: prog(film('tt01', T + AHEAD, 30)) } } }, T + AHEAD + MIN).keys;
  const after = T + AHEAD + MIN;
  const r = mergeCopies({ mine: side({ progress: prog(film('tt01', after, 3000)) }), theirs: fixed, now: after });
  assert.equal(r.copy.keys.progress.value['movie:tt01|tt01'].time, 3000, 'the real save wins once the time is past');
  // Removed (its tombstone AHEAD at most), then watched again 400 days later: the watching stays.
  const later = T + 400 * DAY;
  const back = mergeCopies({ mine: side({ progress: prog(film('tt01', later, 1200)) }, {}, { progress: { 'movie:tt01|tt01': T + AHEAD + 1 } }), theirs: {}, now: later });
  assert.equal(back.copy.keys.progress.value['movie:tt01|tt01'].time, 1200);
  // Whole keys: a far-future `at` is taken as AHEAD, and a change made here after seeing it still wins, since its
  // stamp follows the time this phone saw (sync-record.js stampAfter), itself never past AHEAD.
  const theirs = readCopy({ astra: 'sync/1', keys: { settings: { at: FUTURE, value: { hero: false } } } }, later).keys;
  const stamp = stampAfter(theirs.settings.at, later + MIN);
  assert.ok(stamp <= later + MIN + AHEAD);
  const whole = mergeCopies({ mine: side({ settings: { hero: true } }, { settings: stamp }), theirs, now: later + MIN });
  assert.deepEqual(whole.copy.keys.settings.value, { hero: true });
});

// The security read's bloat and depth probes: a hostile or damaged copy must not bloat or wedge a phone.
test('a copy cannot bloat or wedge a phone: add-ons cut to their fields, deep values, big unknown settings, long searches', () => {
  const nest = (d) => { let v = 0; for (let i = 0; i < d; i++) v = [v]; return v; };
  const read = readCopy({ astra: 'sync/1', keys: {
    addons: { at: T, value: [{ ...addon(1), extra: 'x'.repeat(10_000), manifest: { deep: true } }, { url: `https://addon.example/${'p'.repeat(5000)}`, name: 'Long' }] },
    settings: { at: T, value: { hero: false, junk: 'x'.repeat(1_900_000), small: 'kept', hiddenRows: ['a'] } },
    recentSearches: { at: T, value: ['one', 'x'.repeat(201), ...Array.from({ length: 20 }, (_, i) => `q${i}`)] },
    library: { at: T, value: { 'movie:tt1': { ...meta('tt1'), added: T, genres: nest(3000) } } },
  } }, T).keys;
  assert.deepEqual(read.addons.value, [{ url: addon(1).url, enabled: true, name: 'Add-on 1' }], 'only url, enabled and name; an address past 4,096 characters is no add-on');
  assert.deepEqual(read.settings.value, { hero: false, small: 'kept', hiddenRows: ['a'] }, 'an unknown setting larger than 4 KB is dropped');
  assert.deepEqual(read.recentSearches.value, ['one', ...Array.from({ length: 9 }, (_, i) => `q${i}`)]);
  assert.equal(read.library, undefined, 'a value nested deeper than the bound is as if not kept');
  // 3,000 levels on both sides once threw RangeError in the merge (every phone wedged): no longer.
  const deep = readCopy({ astra: 'sync/1', keys: { settings: { at: 1, value: { x: nest(3000) } } } }, 2);
  assert.deepEqual(deep.keys.settings.value, {}, 'the deep unknown setting is dropped');
  assert.doesNotThrow(() => mergeCopies({ mine: { settings: { at: 0, value: { x: nest(3000) }, gone: {} } }, theirs: deep.keys, now: 2 }));
  assert.doesNotThrow(() => same({ x: nest(5000) }, { x: nest(5000) }));
});

// The security read's add-on probes: a removed add-on (perhaps because its key leaked) must not come back from a
// phone that still had it. Add-ons merge address by address; each address carries when it was had (re-)added, a
// removal is a tombstone, and an address comes back only when added again after its removal.
test('a removed add-on stays removed: after an offline change elsewhere, on a first merge, with the switch off and on', async () => {
  const { addressKey } = await import('../frontend/astra/src/app/sync-addons.js');
  const kept = { url: 'https://addon.example/invented-ok/manifest.json', enabled: true, name: 'Kept' };
  const removed = { url: 'https://addon.example/invented-leaked-key/manifest.json', enabled: true, name: 'Removed' };
  const fp = addressKey(removed.url);
  assert.match(fp, /^[0-9a-f]{16}$/);
  assert.ok(!fp.includes('leaked'), 'a tombstone names a fingerprint, never the address');
  // Phone A removed it at T: the server's copy has the tombstone.
  const theirs = readCopy({ astra: 'sync/1', keys: { addons: { at: T, value: [kept], gone: { [fp]: T } } } }, T + 2 * MIN).keys;
  // Phone B, offline, switched `kept` off at T + 1 min (its list is the newer): the removal still holds.
  const b = { addons: { at: T + MIN, value: [{ ...kept, enabled: false }, removed], times: {}, gone: {} } };
  const r = mergeCopies({ mine: b, theirs, now: T + 2 * MIN });
  assert.deepEqual(r.copy.keys.addons.value, [{ ...kept, enabled: false }]);
  assert.deepEqual(r.apply.addons, [{ ...kept, enabled: false }]);
  assert.deepEqual(r.copy.keys.addons.gone, { [fp]: T });
  // A first merge (B joining, or its switch turned off and on): a union, minus the removed address.
  assert.deepEqual(mergeCopies({ mine: b, theirs, first: true, now: T + 2 * MIN }).copy.keys.addons.value.map((a) => a.name), ['Kept']);
  // Added again on B after the removal: it comes back, everywhere.
  const again = { addons: { at: T + 3 * MIN, value: [kept, removed], times: { [fp]: T + 3 * MIN }, gone: {} } };
  const back = mergeCopies({ mine: again, theirs, now: T + 3 * MIN });
  assert.deepEqual([back.copy.keys.addons.value.map((a) => a.name), back.copy.keys.addons.gone], [['Kept', 'Removed'], {}]);
  // Addresses only the other side has are added after the newer side's own, in its order.
  const extra = { url: 'https://addon2.example/x/manifest.json', enabled: true, name: 'Extra' };
  const both = mergeCopies({ mine: { addons: { at: T + 4 * MIN, value: [removed, kept], times: { [fp]: T + 3 * MIN }, gone: {} } },
    theirs: readCopy({ astra: 'sync/1', keys: { addons: { at: T + MIN, value: [kept, extra] } } }, T).keys, now: T + 4 * MIN });
  assert.deepEqual(both.copy.keys.addons.value.map((a) => a.name), ['Removed', 'Kept', 'Extra']);
});

// The security read's senses probe: watching done here and not yet looked at must still be reported when a merge
// changes the same title. The reader's last look is written over only where it equals what this phone had.
test('watching here that the reader has not looked at yet is not hidden by a merge', () => {
  const area = new Map();
  const storage = { getItem: (k) => area.get(k) ?? null, setItem: (k, v) => area.set(k, v) };
  // The reader looked at T: tt1 at 0 s. This phone then watched 20 minutes (saved T + 20 min); the other phone's is newer.
  area.set('th.p.senses.watch', JSON.stringify({ look: T, spots: { 'astra:movie:tt1': { t: 0, d: 6_000_000, done: false, at: T - 864e5 } } }));
  hideFromSenses(prog(film('tt1', T + 20 * MIN, 1200)), prog(film('tt1', T + 21 * MIN, 1500)), storage);
  const c = changes(JSON.parse(area.get('th.p.senses.watch')), spotsOf(prog(film('tt1', T + 21 * MIN, 1500))), T + 25 * MIN);
  assert.equal(c.senses.length, 1);
  assert.equal(c.senses[0][0], 'media.watch');
  assert.ok(c.senses[0][2].ms >= 1_200_000, 'the 20 minutes watched here are reported');
});

// The security read's size probe: a merge must not grow a phone past Astra's own caps, and a full phone's copy stays
// well under the Worker's 1 MiB (its CPU on the Free plan).
test('merged progress is Astra’s own 300 newest; the copy carries the newest 3,000 watched marks; a full phone’s copy is small', () => {
  const a = {}, b = {};
  for (let i = 0; i < 300; i++) { a[`movie:ta${i}|ta${i}`] = film(`ta${i}`, T - 2 * i); b[`movie:tb${i}|tb${i}`] = film(`tb${i}`, T - 2 * i - 1); }
  const r = mergeCopies({ mine: side({ progress: a }), theirs: server({ progress: b }), now: T });
  assert.equal(Object.keys(r.apply.progress).length, 300);
  assert.equal(Object.keys(r.copy.keys.progress.value).length, 300);
  assert.ok(r.apply.progress['movie:ta0|ta0'] && r.apply.progress['movie:tb0|tb0'] && !r.apply.progress['movie:ta299|ta299'], 'the newest of both');
  const watched = {};
  for (let i = 0; i < 5000; i++) watched[`series:tt${2_000_000 + (i >> 5)}|tt${2_000_000 + (i >> 5)}:1:${i & 31}`] = T - i;
  const w = mergeCopies({ mine: side({ watched }), theirs: {}, now: T });
  assert.equal(Object.keys(w.copy.keys.watched.value).length, 3000);
  assert.equal(w.copy.keys.watched.value['series:tt2000000|tt2000000:1:0'], T, 'the newest');
  assert.equal(w.apply.watched, undefined, 'this phone keeps all of its own');
  // A full phone: 300 progress entries, 500 library titles, 5,000 watched marks, a few add-ons.
  const progress = {}, library = {};
  for (let i = 0; i < 300; i++) {
    const e = episode(`tt${1_000_000 + i}`, 1, 1 + (i % 24), T - i * MIN, 812.5);
    e.meta = { ...e.meta, poster: `https://images.example/poster/${i}/w342-abcdefghijklmnopqrstuvwxyz0123456789.jpg`, background: `https://images.example/background/${i}/original-abcdefghijklmnopqrstuvwxyz.jpg`, releaseInfo: '2001–2004', genres: ['Drama', 'Mystery'] };
    e.next = { videoId: `${e.id}:1:${2 + (i % 24)}`, season: 1, episode: 2 + (i % 24), title: `The Invented Episode Title ${i}`, thumbnail: `https://images.example/episode/${i}/thumb.jpg` };
    progress[pkey(e)] = e;
  }
  for (let i = 0; i < 500; i++) Object.assign(library, lib(`tt${5_000_000 + i}`, T - i));
  const full = mergeCopies({ mine: side({ addons: [addon(1), addon(2), addon(3)], progress, library, watched, settings: { hero: true } }), theirs: {}, now: T });
  const bytes = new TextEncoder().encode(JSON.stringify(full.copy)).length;
  assert.ok(bytes < 0.6 * 1024 * 1024, `${bytes} bytes`);
});
