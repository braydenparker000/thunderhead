// Astra the same on every phone (frontend/astra/src/app/sync-merge.js, sync-senses.js; ASTRA.md §5.3): the
// merge of two phones over every key, removals that never come back, a first merge that loses nothing, a new
// phone taking the server's, clocks an hour apart, a damaged server copy, the title playing left alone, the
// size of a heavy real-shaped copy, and merged progress kept from the senses reader (th/senses/watch.js's own
// `changes`). Invented titles, add-ons and times.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCopies, readCopy, same, GONE_MS } from '../frontend/astra/src/app/sync-merge.js';
import { hideFromSenses, spotsOf } from '../frontend/astra/src/app/sync-senses.js';
import { stampAfter } from '../frontend/astra/src/app/sync-record.js';
import { changes } from '../frontend/th/senses/watch.js';
import { CINEMETA } from '../frontend/astra/src/addons/client.js';

const T = 1_763_600_000_000, MIN = 60_000, H = 3_600_000;
const addon = (n) => ({ url: `https://addon${n}.example/c/invented-${n}/manifest.json`, enabled: true, name: `Add-on ${n}` });
const meta = (id, type = 'movie') => ({ id, type, name: `Invented ${id}` });
const film = (id, updated, time = 600) => ({ type: 'movie', id, videoId: id, season: null, episode: null, time, duration: 6000, updated, completed: false, meta: meta(id) });
const episode = (id, s, e, updated, time = 300) => ({ type: 'series', id, videoId: `${id}:${s}:${e}`, season: s, episode: e, time, duration: 2400, updated, completed: false, meta: meta(id, 'series') });
const pkey = (x) => `${x.type}:${x.id}|${x.videoId}`;
const prog = (...xs) => Object.fromEntries(xs.map((x) => [pkey(x), x]));
const lib = (id, added, type = 'movie') => ({ [`${type}:${id}`]: { ...meta(id, type), added } });
/** A side as sync.js builds it: each key with its stamp, value and tombstones. */
const side = (values, at = {}, gone = {}) => Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { at: at[k] ?? T, value, gone: gone[k] ?? {} }]));
const server = (values, at, gone) => readCopy({ astra: 'sync/1', keys: side(values, at, gone) }).keys;

test('two phones, every key: entries of both survive, whole keys go to the newer change', () => {
  const a = { addons: [addon(1), addon(2)], library: lib('tt01', T), progress: prog(episode('tt10', 1, 3, T + MIN)), watched: { 'series:tt10|tt10:1:2': T }, settings: { hero: false }, recentSearches: ['first'] };
  const b = { addons: [addon(1), addon(3)], library: lib('tt02', T + 5), progress: prog(film('tt20', T + 2 * MIN)), watched: { 'movie:tt21': T + 9 }, settings: { posterWidth: 140 }, recentSearches: ['second'] };
  const r = mergeCopies({ mine: side(a, { addons: T + 10 * MIN, settings: T - MIN, recentSearches: T + MIN }), theirs: server(b, { addons: T, settings: T, recentSearches: T }), now: T + 20 * MIN });
  const k = r.copy.keys;
  assert.deepEqual(k.addons.value, a.addons, 'this phone changed its add-ons last');
  assert.deepEqual(k.settings.value, b.settings, 'the other phone changed settings last');
  assert.deepEqual(k.recentSearches.value, ['first']);
  assert.deepEqual(Object.keys(k.library.value).sort(), ['movie:tt01', 'movie:tt02']);
  assert.deepEqual(Object.keys(k.progress.value).sort(), ['movie:tt20|tt20', 'series:tt10|tt10:1:3'], 'an episode here and a film there both survive');
  assert.deepEqual(Object.keys(k.watched.value).sort(), ['movie:tt21', 'series:tt10|tt10:1:2']);
  assert.equal(r.copy.astra, 'sync/1');
  assert.deepEqual(Object.keys(r.apply).sort(), ['library', 'progress', 'settings', 'watched'], 'only what changes here is written');
  assert.equal(r.differs, true);
  // The same entry on both: the later save of it wins, whichever side.
  const later = mergeCopies({ mine: side({ progress: prog(film('tt30', T, 100)) }), theirs: server({ progress: prog(film('tt30', T + 1, 900)) }), now: T });
  assert.equal(later.copy.keys.progress.value['movie:tt30|tt30'].time, 900);
});

test('nothing to do when both hold the same, whatever the order of their fields', () => {
  const v = { library: { ...lib('tt01', T), ...lib('tt02', T) }, settings: { hero: true, posterWidth: 120 } };
  const flipped = { library: { ...lib('tt02', T), ...lib('tt01', T) }, settings: { posterWidth: 120, hero: true } };
  const r = mergeCopies({ mine: side(v, { settings: T + 5 }), theirs: server(flipped), now: T });
  assert.deepEqual([r.apply, r.differs], [{}, false]);
  assert.equal(r.copy.keys.settings.at, T, 'the same value keeps the server’s time');
  assert.ok(same({ a: [1, { b: 2, c: 3 }] }, { a: [1, { c: 3, b: 2 }] }) && !same([1, 2], [2, 1]));
});

test('a removal never comes back from the other phone; a change after it does', () => {
  const now = T + 10 * MIN;
  // Removed here (tombstone newer than the entry), still on the server: gone from both.
  const here = mergeCopies({ mine: side({ library: {} }, {}, { library: { 'movie:tt01': T + MIN } }), theirs: server({ library: lib('tt01', T) }), now });
  assert.deepEqual(here.copy.keys.library.value, {});
  assert.deepEqual(here.copy.keys.library.gone, { 'movie:tt01': T + MIN });
  assert.equal(here.differs, true);
  // Removed on the other phone: this phone loses it too, progress and watched alike.
  const there = mergeCopies({
    mine: side({ progress: prog(film('tt05', T)), watched: { 'movie:tt06': T } }),
    theirs: server({ progress: {}, watched: {} }, {}, { progress: { 'movie:tt05|tt05': T + 1 }, watched: { 'movie:tt06': T + 1 } }), now });
  assert.deepEqual([there.apply.progress, there.apply.watched], [{}, {}]);
  // Saved again after the removal (added back to the library, watched again): it is back, the tombstone goes.
  const back = mergeCopies({ mine: side({ library: lib('tt01', T + 2 * MIN) }), theirs: server({ library: {} }, {}, { library: { 'movie:tt01': T + MIN } }), now });
  assert.deepEqual([Object.keys(back.copy.keys.library.value), back.copy.keys.library.gone], [['movie:tt01'], {}]);
  // Tombstones are kept 60 days.
  const old = mergeCopies({ mine: side({ watched: {} }, {}, { watched: { 'movie:tt07': now - GONE_MS - 1, 'movie:tt08': now - GONE_MS + MIN } }), theirs: {}, now });
  assert.deepEqual(Object.keys(old.copy.keys.watched.gone), ['movie:tt08']);
});

test('a first merge puts both together and loses nothing; a new phone takes the server’s', () => {
  const mine = side({ addons: [{ url: CINEMETA, enabled: true, name: 'Cinemeta' }, addon(1)], settings: { hero: false, hiddenRows: ['a'] }, recentSearches: ['Mine', 'both'], library: lib('tt01', T) });
  const theirs = server({ addons: [{ url: CINEMETA, enabled: true, name: 'Cinemeta' }, addon(2)], settings: { posterWidth: 140, hiddenRows: ['b'] }, recentSearches: ['BOTH', 'theirs'], library: lib('tt02', T) });
  const r = mergeCopies({ mine, theirs, first: true, now: T + H });
  assert.deepEqual(r.copy.keys.addons.value.map((a) => a.url), [CINEMETA, addon(2).url, addon(1).url]);
  assert.deepEqual(r.copy.keys.settings.value, { posterWidth: 140, hiddenRows: ['b', 'a'], hero: false });
  assert.deepEqual(r.copy.keys.recentSearches.value, ['Mine', 'both', 'theirs']);
  assert.deepEqual(Object.keys(r.copy.keys.library.value).sort(), ['movie:tt01', 'movie:tt02']);
  assert.ok(r.copy.keys.addons.at > T, 'stamped as changed at the first merge');
  // Nothing but defaults here (Cinemeta alone, nothing else saved): the server's, as it is.
  const fresh = mergeCopies({ mine: side({ addons: [{ url: CINEMETA, enabled: true, name: 'Cinemeta' }] }), theirs, first: true, now: T });
  assert.deepEqual(fresh.apply.addons, theirs.addons.value);
  assert.deepEqual(fresh.apply.settings, theirs.settings.value);
  assert.equal(fresh.differs, false, 'nothing to save back');
});

test('clocks an hour apart: distinct entries survive, and a removal still wins over what it removed', () => {
  const ahead = T + H; // phone A's clock runs an hour ahead
  const a = { progress: prog(episode('tt10', 2, 1, ahead)), library: lib('tt01', ahead) };
  // Phone B, an hour "earlier" by its clock, watches a film and removes the title A added
  // (sync.js stamps a removal later than the entry it removes: max(now, added + 1)).
  const b = mergeCopies({ mine: side({ progress: prog(film('tt20', T + 5 * MIN)), library: {} }, {}, { library: { 'movie:tt01': ahead + 1 } }), theirs: server(a), now: T + 5 * MIN });
  assert.deepEqual(Object.keys(b.copy.keys.progress.value).sort(), ['movie:tt20|tt20', 'series:tt10|tt10:2:1']);
  assert.deepEqual(b.copy.keys.library.value, {});
  // And A, reading B's copy, loses the title and gains the film.
  const back = readCopy(b.copy).keys;
  const onA = mergeCopies({ mine: side(a), theirs: back, now: ahead + 10 * MIN });
  assert.deepEqual(onA.apply.library, {});
  assert.ok(onA.apply.progress['movie:tt20|tt20']);
});

test('a damaged server copy never breaks the phone: a bad key is left out, a bad entry skipped', () => {
  assert.equal(readCopy(null), null);
  assert.equal(readCopy('x'), null);
  assert.equal(readCopy({ astra: 'backup/1', keys: {} }), null);
  assert.equal(readCopy({ astra: 'sync/2', keys: {} }), 'newer');
  const read = readCopy({ astra: 'sync/1', keys: {
    addons: { at: T, value: 'not a list' },
    library: { at: T, value: { x: { nonsense: true } } },
    settings: { at: 'yesterday', value: { hero: false } },
    progress: { at: T, value: { ...prog(film('tt01', T)), broken: { id: 'tt02' } }, gone: { a: 'soon', b: T } },
    watched: { at: T, value: { 'movie:tt03': T, bad: -5 } },
    player: { at: T, value: { volume: 1 } },
  } });
  assert.deepEqual(Object.keys(read.keys).sort(), ['progress', 'watched'], 'a key of the wrong shape, all damaged or without a time is as if not kept; a device key never');
  assert.deepEqual(Object.keys(read.keys.progress.value), ['movie:tt01|tt01']);
  assert.deepEqual(read.keys.progress.gone, { b: T });
  assert.deepEqual(read.keys.watched.value, { 'movie:tt03': T });
  const mine = side({ addons: [addon(1)], settings: { hero: true }, library: lib('tt09', T) });
  const r = mergeCopies({ mine, theirs: read.keys, now: T });
  assert.equal(r.apply.addons, undefined, 'this phone’s add-ons stay');
  assert.deepEqual(r.copy.keys.addons.value, [addon(1)], 'and the next save mends the server’s');
  assert.deepEqual(Object.keys(r.copy.keys.library.value), ['movie:tt09']);
});

test('the title playing keeps this phone’s progress; the copy still takes the newer', () => {
  const mineP = prog(episode('tt10', 1, 4, T, 100));
  const theirsP = prog(episode('tt10', 1, 4, T + MIN, 2000), episode('tt10', 1, 2, T), film('tt20', T));
  const r = mergeCopies({ mine: side({ progress: mineP }), theirs: server({ progress: theirsP }), playing: { type: 'series', id: 'tt10' }, now: T + MIN });
  assert.equal(r.apply.progress['series:tt10|tt10:1:4'].time, 100, 'the episode playing is left as it is here');
  assert.ok(r.apply.progress['series:tt10|tt10:1:2'] && r.apply.progress['movie:tt20|tt20'], 'others come in');
  assert.equal(r.copy.keys.progress.value['series:tt10|tt10:1:4'].time, 2000);
});

test('a heavy real-shaped copy (2,000 progress entries, 500 library titles, 3,000 watched) fits under the 2 MiB cap', () => {
  const progress = {}, library = {}, watched = {};
  for (let i = 0; i < 2000; i++) {
    const e = episode(`tt${1_000_000 + i}`, 1 + (i % 9), 1 + (i % 24), T - i * MIN, 812.5);
    e.meta = { ...e.meta, name: `An Invented Series Number ${i}`, poster: `https://images.example/poster/${i}/w342-abcdefghijklmnopqrstuvwxyz0123456789.jpg`, background: `https://images.example/background/${i}/original-abcdefghijklmnopqrstuvwxyz.jpg`, logo: `https://images.example/logo/${i}/w500-abcdefghijkl.png`, releaseInfo: '2001–2004', genres: ['Drama', 'Mystery', 'Science Fiction'] };
    e.next = { videoId: `${e.id}:1:${2 + (i % 24)}`, season: 1, episode: 2 + (i % 24), title: `The Invented Episode Title ${i}`, thumbnail: `https://images.example/episode/${i}/thumb-abcdefghijklmnop.jpg` };
    progress[pkey(e)] = e;
  }
  for (let i = 0; i < 500; i++) Object.assign(library, { [`movie:tt${5_000_000 + i}`]: { id: `tt${5_000_000 + i}`, type: 'movie', name: `An Invented Film ${i}`, poster: `https://images.example/poster/f${i}/w342-abcdefghijklmnopqrstuvwxyz0123456789.jpg`, releaseInfo: '2003', genres: ['Drama'], added: T - i * H } });
  for (let i = 0; i < 3000; i++) watched[`series:tt${2_000_000 + (i >> 5)}|tt${2_000_000 + (i >> 5)}:1:${i & 31}`] = T - i;
  const r = mergeCopies({ mine: side({ addons: [addon(1), addon(2), addon(3)], library, progress, watched, settings: { hero: true }, recentSearches: ['x'] }), theirs: {}, now: T });
  const heavy = new TextEncoder().encode(JSON.stringify({ base: null, copy: r.copy })).length;
  assert.ok(heavy < 2 * 1024 * 1024, `${heavy} bytes`);
  // What Astra really keeps: at most 300 progress entries.
  const real = mergeCopies({ mine: side({ progress: Object.fromEntries(Object.entries(progress).slice(0, 300)), library, watched }), theirs: {}, now: T });
  const typical = new TextEncoder().encode(JSON.stringify({ base: null, copy: real.copy })).length;
  assert.ok(typical > 64 * 1024 && typical < heavy, `${typical} bytes: a full phone's copy needs the next start, not a keepalive`);
});

test('merged progress is invisible to the senses reader; this phone’s own watching still counts', () => {
  const look = T + 10 * MIN;
  const here = prog(film('tt01', T, 600));
  const area = new Map([['th.p.senses.watch', JSON.stringify({ look, spots: spotsOf(here) })]]);
  const storage = { getItem: (k) => area.get(k) ?? null, setItem: (k, v) => area.set(k, v) };
  // Another phone watched a series for 40 minutes, finished a film, and took tt01 off Continue Watching.
  const theirs = server({ progress: prog(episode('tt10', 1, 3, T + 20 * MIN, 2400), { ...film('tt20', T + 21 * MIN, 6000), completed: true }) }, {}, { progress: { 'movie:tt01|tt01': T + 22 * MIN } });
  const r = mergeCopies({ mine: side({ progress: here }), theirs, now: T + 30 * MIN });
  const at = T + 31 * MIN;
  const unhidden = changes(JSON.parse(area.get('th.p.senses.watch')), spotsOf(r.apply.progress), at);
  assert.deepEqual(unhidden.senses.map((s) => s[0]).sort(), ['media.drop', 'media.finish', 'media.watch', 'media.watch'], 'left alone, the merge would read as watching here');
  hideFromSenses(here, r.apply.progress, storage);
  assert.deepEqual(changes(JSON.parse(area.get('th.p.senses.watch')), spotsOf(r.apply.progress), at).senses, []);
  // Then this phone watches the merged episode on for five minutes: that is sent.
  const seen = JSON.parse(area.get('th.p.senses.watch'));
  const watchedHere = { ...r.apply.progress, 'series:tt10|tt10:1:3': episode('tt10', 1, 3, at + 5 * MIN, 2700) };
  assert.deepEqual(changes({ ...seen, look: at }, spotsOf(watchedHere), at + 5 * MIN).senses, [['media.watch', 'astra:series:tt10:1:3', { ms: 300_000 }]]);
  // Without a last look yet the reader's first look only remembers: nothing is written.
  const empty = new Map();
  hideFromSenses(here, r.apply.progress, { getItem: (k) => empty.get(k) ?? null, setItem: (k, v) => empty.set(k, v) });
  assert.equal(empty.size, 0);
});

// The security read's far-future probes (2026-11-19): a time read from a copy, or stamped here, is never taken as later
// than a day from now, so an entry saved "in the year 287,000" cannot win every merge or leave a tombstone that never ends.
const DAY = 864e5, FUTURE = 9e15;
test('far-future times are taken as a day from now at most: entries, tombstones, stamps', () => {
  const read = readCopy({ astra: 'sync/1', keys: {
    progress: { at: FUTURE, value: prog(film('tt01', FUTURE, 30)), gone: { 'movie:tt02|tt02': FUTURE } },
    library: { at: T, value: lib('tt03', FUTURE) },
    watched: { at: T, value: { 'movie:tt04': FUTURE } },
  } }, T).keys;
  assert.deepEqual([read.progress.at, read.progress.value['movie:tt01|tt01'].updated, read.progress.gone['movie:tt02|tt02']], [T + DAY, T + DAY, T + DAY]);
  assert.deepEqual([read.library.value['movie:tt03'].added, read.watched.value['movie:tt04']], [T + DAY, T + DAY]);
  // This phone's own far-future entry (its clock was far ahead) is brought back too, and written back healed.
  const own = mergeCopies({ mine: side({ progress: prog(film('tt05', FUTURE)) }), theirs: {}, now: T });
  assert.equal(own.copy.keys.progress.value['movie:tt05|tt05'].updated, T + DAY);
  assert.equal(own.apply.progress['movie:tt05|tt05'].updated, T + DAY);
});

test('a far-future entry loses to real watching after a day, and its removal does not delete later watching for ever', () => {
  const hostile = readCopy({ astra: 'sync/1', keys: { progress: { at: T, value: prog(film('tt01', FUTURE, 30)) } } }, T).keys;
  const dayOn = T + DAY + MIN;
  const r = mergeCopies({ mine: side({ progress: prog(film('tt01', dayOn, 3000)) }), theirs: hostile, now: dayOn });
  assert.equal(r.copy.keys.progress.value['movie:tt01|tt01'].time, 3000, 'the real save wins once the day is past');
  // Removed (its tombstone at most a day ahead), then watched again 400 days later: the watching stays.
  const later = T + 400 * DAY;
  const back = mergeCopies({ mine: side({ progress: prog(film('tt01', later, 1200)) }, {}, { progress: { 'movie:tt01|tt01': T + DAY + 1 } }), theirs: {}, now: later });
  assert.equal(back.copy.keys.progress.value['movie:tt01|tt01'].time, 1200);
  // Whole keys: a far-future `at` is taken as a day ahead, and a change made here after seeing it still wins, since
  // its stamp follows the time this phone saw (sync-record.js stampAfter), itself never past a day ahead.
  const theirs = readCopy({ astra: 'sync/1', keys: { settings: { at: FUTURE, value: { hero: false } } } }, later).keys;
  const stamp = stampAfter(theirs.settings.at, later + MIN);
  assert.ok(stamp <= later + MIN + DAY);
  const whole = mergeCopies({ mine: side({ settings: { hero: true } }, { settings: stamp }), theirs, now: later + MIN });
  assert.deepEqual(whole.copy.keys.settings.value, { hero: true });
});
