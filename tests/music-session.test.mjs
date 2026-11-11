// The music player across a restart (frontend/music/src/player/session.js): the list that was
// playing, its shuffle order, the Queue and the song come back, so Next is the song it would have
// been. The player's own logic in Node, with an invented library.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/site-imports.mjs';

const { Player } = await import('../frontend/music/src/player/player.js');
const { listOf, restore, stateOf, validOrder } = await import('../frontend/music/src/player/session.js');

function player(prefs = {}) {
  const subs = [];
  const bus = { subscribe: (b, f) => subs.push([b, f]), post: (b, m, s, d) => { for (const [name, f] of subs) if (name === b) f(m, s, d); } };
  return new Player({ bus, pref: (k) => prefs[k], res: { stringByName: () => null } });
}
const library = (n) => { const tracks = Array.from({ length: n }, (_, i) => ({ id: 'song' + i, title: 'Song ' + i, durationMs: 200_000 })); return { tracks, byId: new Map(tracks.map((t) => [t.id, t])) }; };
/** What a restart keeps: both records, through JSON as the store would hold them. */
const records = (p, lib) => JSON.parse(JSON.stringify({ saved: stateOf(p, lib), savedList: listOf(p, lib) }));
const next = (p, times = 1) => { const seen = []; for (let i = 0; i < times; i++) { p.step(1); seen.push(p.track?.id); } return seen; };

test('an album that was playing is still that album after a restart, at the same song', () => {
  const lib = library(30), album = lib.tracks.slice(10, 16);
  const p = player();
  p.setQueue(album, 2);
  const { saved, savedList } = records(p, lib);
  assert.equal(savedList.all, false);
  assert.deepEqual(savedList.ids, album.map((t) => t.id));
  const again = player();
  restore(again, lib, saved, savedList);
  assert.deepEqual(again.queue.map((t) => t.id), album.map((t) => t.id), 'the album, not the whole library');
  assert.equal(again.track.id, 'song12');
  assert.deepEqual(next(again, 3), ['song13', 'song14', 'song15']);
});

test('a shuffle goes on after a restart: the same order, the same next songs', () => {
  const lib = library(40);
  const p = player();
  p.setQueue(lib.tracks.slice(0, 20), 0);
  p.command('cmd_player_set_shuffle', { arg1: 1 });
  next(p, 5);
  const { saved, savedList } = records(p, lib);
  const expected = next(p, 8);
  const again = player();
  restore(again, lib, saved, savedList);
  assert.equal(again.shuffle, 1);
  assert.deepEqual(next(again, 8), expected);
});

test('the whole library is named, not listed; a record from before this change still starts it', () => {
  const lib = library(25);
  const p = player();
  p.setQueue(lib.tracks, 7);
  const { saved, savedList } = records(p, lib);
  assert.deepEqual({ all: savedList.all, ids: savedList.ids }, { all: true, ids: null });
  const again = player();
  restore(again, lib, saved, savedList);
  assert.equal(again.queue, lib.tracks);
  assert.equal(again.track.id, 'song7');
  const old = player();
  restore(old, lib, { trackId: 'song9', positionMs: 0, shuffle: 0, repeat: 1 }, null);
  assert.equal(old.track.id, 'song9');
  assert.equal(old.queue, lib.tracks);
});

test('in the Queue at a restart: the Queue plays on, then the list it interrupted', () => {
  const lib = library(30), album = lib.tracks.slice(0, 5);
  const p = player();
  p.setQueue(album, 1);
  p.enqueue([lib.tracks[20], lib.tracks[21]]);
  p.step(1);
  assert.equal(p.queueMode, true);
  const { saved, savedList } = records(p, lib);
  assert.deepEqual(savedList.ids, album.map((t) => t.id), 'the list kept is the one to return to');
  const again = player();
  restore(again, lib, saved, savedList);
  assert.equal(again.queueMode, true);
  assert.equal(again.track.id, 'song20');
  assert.deepEqual(next(again, 3), ['song21', 'song2', 'song3']);
});

test('a song that left the library drops out of the list; the order is then made anew', () => {
  const lib = library(12);
  const p = player();
  p.setQueue(lib.tracks.slice(0, 8), 3);
  p.command('cmd_player_set_shuffle', { arg1: 1 });
  p.ensureOrder();
  const { saved, savedList } = records(p, lib);
  const smaller = { tracks: lib.tracks.filter((t) => t.id !== 'song5'), byId: new Map(lib.tracks.filter((t) => t.id !== 'song5').map((t) => [t.id, t])) };
  const again = player();
  restore(again, smaller, saved, savedList);
  assert.equal(again.queue.length, 7);
  assert.equal(again.track.id, 'song3');
  again.ensureOrder();
  assert.equal(validOrder(again.order, 7), true);
  // The song that was playing gone too: the whole library, from its start.
  const gone = { tracks: lib.tracks.filter((t) => t.id !== 'song3'), byId: new Map(lib.tracks.filter((t) => t.id !== 'song3').map((t) => [t.id, t])) };
  const fresh = player();
  restore(fresh, gone, saved, savedList);
  assert.equal(fresh.queue, gone.tracks);
});

test('a play order is every place once', () => {
  assert.equal(validOrder([2, 0, 1], 3), true);
  assert.equal(validOrder([2, 0, 0], 3), false);
  assert.equal(validOrder([0, 1], 3), false);
  assert.equal(validOrder([0, 1, 3], 3), false);
  assert.equal(validOrder(null, 0), false);
});
