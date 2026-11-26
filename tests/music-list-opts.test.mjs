// Music's list sort belongs to the list (frontend/music/src/list/entry-opts.js; owner audit
// 2026-11-26): an album's, artist's, playlist's or folder's sort is its own, over its kind's (the
// sort saved before, per kind, stays every entry's default), kept for at most ENTRY_CAP lists by
// last use, while the zoom is the kind's (every album's songs, every artist page …); the statistics lists cut their own ranking and nothing else (list/stat-lists.js); and an
// entry's albums are the shelves' albums, its other songs Singles (library/shelves.js entryShelf).
// Every name is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseKey, dropStale, ENTRY_CAP, ENTRY_MAP, entryId, entryKey, ownOpts, putOpts, readOpts, touchOpts, writeOpts,
} from '../frontend/music/src/list/entry-opts.js';
import { DEFAULT_LIMIT, NO_LIMIT, ownRanking, STAT_LISTS, statTracks } from '../frontend/music/src/list/stat-lists.js';
import { entryShelf } from '../frontend/music/src/library/shelves.js';

const REVERSE = 0x40000000;
const kite = { kind: 'album', title: 'Kite Weather', artist: 'Orchard Lamps', tracks: [] };
const moss = { kind: 'album', title: 'Moss Lanterns', artist: 'Orchard Lamps', tracks: [] };

test('an entry key names the list: kind key, "@", the entry\'s stable id', () => {
  assert.equal(entryKey('tracks:album', kite), 'tracks:album@kite weather|orchard lamps');
  assert.equal(entryKey('sub:artist', { kind: 'artist', title: 'Orchard Lamps' }), 'sub:artist@orchard lamps');
  assert.equal(entryKey('tracks:folder', { kind: 'folder', title: 'Demos', path: '/Moss/Demos' }), 'tracks:folder@/Moss/Demos');
  assert.equal(entryId({ kind: 'playlist', title: 'Rainy Mix', pl: { id: 'p7' } }), 'p7');
  assert.equal(entryKey('cat:folders_hier', ''), 'cat:folders_hier', 'no entry: the kind key');
  assert.equal(baseKey('tracks:album@kite weather|orchard lamps'), 'tracks:album');
  assert.equal(baseKey('cat:albums'), 'cat:albums');
});

test("sorting one album's songs leaves the other albums on the kind's sort; zooming one zooms them all", () => {
  // Saved before per kind: every album by title, zoom 3 (the old format, kept as it is).
  const all = { 'tracks:album': { sort: 1, zoom: 3, zv: 2, titlesOnly: true } };
  const a = entryKey('tracks:album', kite), b = entryKey('tracks:album', moss);
  assert.deepEqual(readOpts(all, a), { sort: 1, zoom: 3, zv: 2, titlesOnly: true }, 'no options of its own: the kind\'s');
  writeOpts(all, a, { sort: 13 | REVERSE });
  assert.deepEqual(readOpts(all, a), { sort: 13 | REVERSE, zoom: 3, zv: 2, titlesOnly: true });
  assert.deepEqual(readOpts(all, b), { sort: 1, zoom: 3, zv: 2, titlesOnly: true }, 'the other album keeps the kind\'s sort');
  // The zoom follows the kind: every album's songs take it.
  writeOpts(all, a, { zoom: 5, zv: 2 });
  assert.deepEqual(readOpts(all, a), { sort: 13 | REVERSE, zoom: 5, zv: 2, titlesOnly: true });
  assert.deepEqual(readOpts(all, b), { sort: 1, zoom: 5, zv: 2, titlesOnly: true }, 'the other album zooms with it');
  assert.deepEqual(all['tracks:album'], { sort: 1, zoom: 5, zv: 2, titlesOnly: true }, 'the kind keeps its sort, takes the zoom');
  assert.deepEqual(all[ENTRY_MAP][a], { sort: 13 | REVERSE }, 'the entry keeps only its sort');
  // Another kind is untouched.
  assert.equal(readOpts(all, entryKey('sub:artist', { kind: 'artist', title: 'Wren' })).zoom, undefined);
  // Show Titles Only (and the other options) stay the kind's.
  writeOpts(all, a, { titlesOnly: false });
  assert.equal(readOpts(all, b).titlesOnly, false);
  assert.deepEqual(Object.keys(all[ENTRY_MAP]), [a]);
  // A category list keeps its kind key.
  writeOpts(all, 'cat:albums', { sort: 1 });
  assert.deepEqual(readOpts(all, 'cat:albums'), { sort: 1 });
});

test('a zoom an entry stored for itself before is dropped on read', () => {
  const a = entryKey('tracks:album', kite), b = entryKey('tracks:album', moss);
  const all = { 'tracks:album': { zoom: 2, zv: 2 }, [ENTRY_MAP]: { [a]: { sort: 3, zoom: 5, zv: 2 }, [b]: { zoom: 1 } } };
  assert.equal(readOpts(all, a).zoom, 2, 'read as the kind\'s even before it is dropped');
  assert.equal(dropStale(all), true);
  assert.deepEqual(all[ENTRY_MAP], { [a]: { sort: 3 } }, 'an entry with nothing else goes');
  assert.equal(dropStale(all), false, 'nothing left to drop');
  assert.deepEqual(readOpts(all, b), { zoom: 2, zv: 2 });
});

test('a cancelled zoom or sort puts back exactly what the entry and its kind had', () => {
  const all = { 'tracks:album': { zoom: 1 } }; // a zoom saved before zv 2 (search levels)
  const a = entryKey('tracks:album', kite), b = entryKey('tracks:album', moss);
  const before = ownOpts(all, a);
  assert.deepEqual(before, { kind: { zoom: 1 }, mine: null });
  writeOpts(all, a, { zoom: 4, zv: 2 });
  assert.equal(readOpts(all, b).zoom, 4);
  putOpts(all, a, before);
  assert.deepEqual(readOpts(all, a), { zoom: 1 }, 'back on the kind\'s old zoom');
  assert.deepEqual(readOpts(all, b), { zoom: 1 });
  assert.deepEqual(all[ENTRY_MAP], {});
  writeOpts(all, a, { sort: 2, zoom: 5, zv: 2 });
  const kept = ownOpts(all, a);
  writeOpts(all, a, { zoom: 0, zv: 2, sort: 7 });
  putOpts(all, a, kept);
  assert.deepEqual(readOpts(all, a), { zoom: 5, sort: 2, zv: 2 });
  assert.deepEqual(ownOpts(all, 'cat:albums'), null, 'a kind key: its own options');
  writeOpts(all, a, { sort: undefined });
  assert.equal(readOpts(all, a).sort, undefined, 'undefined removes an own option');
});

test('at most ENTRY_CAP lists keep their own options; the least recently used go first', () => {
  const all = {};
  const key = (n) => entryKey('tracks:album', { kind: 'album', title: `Album ${n}`, artist: 'Wren' });
  for (let n = 0; n < 5; n++) writeOpts(all, key(n), { sort: n }, 3);
  assert.deepEqual(Object.keys(all[ENTRY_MAP]), [key(2), key(3), key(4)]);
  // Opening one makes it the most recent: the next new one drops another.
  assert.equal(touchOpts(all, key(2)), true);
  assert.equal(touchOpts(all, key(2)), false, 'already the most recent');
  writeOpts(all, key(5), { sort: 5 }, 3);
  assert.deepEqual(Object.keys(all[ENTRY_MAP]), [key(4), key(2), key(5)]);
  assert.equal(readOpts(all, key(3)).sort, undefined, 'a dropped list is back on its kind\'s options');
  assert.ok(ENTRY_CAP >= 100);
});

// Songs with plays, play times, ratings and added times (in steps of a minute).
const songs = Array.from({ length: 500 }, (_, i) => ({
  id: 's' + i, title: `Song ${String(i).padStart(3, '0')}`, plays: i % 7, lastPlayed: i % 7 ? 1000 + i : 0,
  added: 10_000 + i * 60, rating: i % 25 === 0 ? 1 : i % 3 === 0 ? 4 + (i % 2) : 0, ratedAt: i % 25 === 0 ? 50_000 - i : 0,
}));
const ids = (list) => list.map((t) => t.id);

test('Recently Added: its own ranking is cut at Max Items; another sort lists every song, uncut', () => {
  const stat = STAT_LISTS.recent;
  const own = statTracks(songs, stat, {});
  assert.equal(own.ranked, true);
  assert.equal(own.limit, DEFAULT_LIMIT);
  assert.deepEqual(ids(own.tracks), ids([...songs].reverse().slice(0, 200)), 'the 200 newest, newest first');
  // Reverse only turns the ranking round: the same 200, oldest of them first.
  const rev = statTracks(songs, stat, { sort: 12 | REVERSE });
  assert.deepEqual(ids(rev.tracks), ids(own.tracks).reverse());
  // By title: every song, not the newest 200 sorted (the list sorts them itself).
  const byTitle = statTracks(songs, stat, { sort: 1 });
  assert.equal(byTitle.ranked, false);
  assert.equal(byTitle.tracks.length, 500);
  // A Max Items the user chose still cuts, and it cuts the ranking: the 300 newest.
  const chosen = statTracks(songs, stat, { sort: 1, limit: 300 });
  assert.deepEqual(new Set(ids(chosen.tracks)), new Set(ids([...songs].reverse().slice(0, 300))));
  assert.equal(statTracks(songs, stat, { limit: NO_LIMIT }).tracks.length, 500);
  // Clear: only what came after.
  assert.ok(statTracks(songs, stat, { from: 10_000 + 450 * 60 }).tracks.every((t) => t.added > 10_000 + 450 * 60));
});

test('Low Rated has an order: lowest rating first, then the most recently rated or played', () => {
  const stat = STAT_LISTS.lowRated;
  assert.equal(stat.sort, 5 | REVERSE);
  assert.ok(ownRanking(stat, 5 | REVERSE) && ownRanking(stat, 5) && !ownRanking(stat, 1));
  const low = statTracks(songs, stat, {});
  assert.ok(low.tracks.length > 0 && low.tracks.every((t) => t.rating === 1));
  const recency = (t) => Math.max(t.ratedAt, t.lastPlayed);
  for (let i = 1; i < low.tracks.length; i++) assert.ok(recency(low.tracks[i - 1]) >= recency(low.tracks[i]), 'most recent first');
  // Top Rated and Most Played rank by their field, then recency; their cut is their ranking's.
  const top = statTracks(songs, STAT_LISTS.topRated, { limit: 10 });
  assert.equal(top.tracks.length, 10);
  assert.ok(top.tracks.every((t) => t.rating === 5), 'the best rated first');
  const most = statTracks(songs, STAT_LISTS.mostPlayed, {});
  assert.ok(most.tracks.every((t, i) => i === 0 || most.tracks[i - 1].plays >= t.plays));
});

test("an entry's albums are the shelves' albums with its songs; its other songs are Singles", () => {
  const t = (id, title, album, genre) => ({ id, title, album, genre });
  const tide = { kind: 'album', title: 'Tidewater', artist: 'Harbor Lights', tracks: [t(1, 'Shoals', 'Tidewater', 'Folk'), t(2, 'Ebb', 'Tidewater', 'Rock'), t(3, 'Flood', 'Tidewater', 'Folk')] };
  const albumOf = new Map(tide.tracks.map((x) => [x, tide]));
  const short = t(4, 'Paper Moon', 'Paper Moon', 'Folk'), loose = t(5, 'Attic', '', 'Folk');
  const folk = [tide.tracks[0], short, tide.tracks[2], loose];
  const { albums, singles } = entryShelf(folk, albumOf);
  assert.deepEqual(albums.map((a) => [a.title, a.tracks.map((x) => x.title)]), [['Tidewater', ['Shoals', 'Flood']]]);
  assert.deepEqual(singles.map((x) => x.title), ['Attic', 'Paper Moon'], 'a one-song release and a song with no album: never missing');
});
