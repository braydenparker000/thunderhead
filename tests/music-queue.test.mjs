// The music player's Queue and shuffle (frontend/music/src/player/player.js), its own logic run in
// Node with no audio: what plays next, what the Queue holds, and that a shuffle is not started over
// by the Queue. Every song here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/site-imports.mjs';

const { Player } = await import('../frontend/music/src/player/player.js');

/** A player on its own: a bus, the given settings, nothing else. */
function player(prefs = {}) {
  const subs = [];
  const bus = { subscribe: (b, f) => subs.push([b, f]), post: (b, m, s, d) => { for (const [name, f] of subs) if (name === b) f(m, s, d); } };
  return new Player({ bus, pref: (k) => prefs[k], res: { stringByName: () => null } });
}
const songs = (n, prefix = 's') => Array.from({ length: n }, (_, i) => ({ id: prefix + i, title: prefix + i, durationMs: 200_000 }));
const queued = (p) => p.entries.map((e) => e.track.id);
const next = (p, times = 1) => { const seen = []; for (let i = 0; i < times; i++) { p.step(1); seen.push(p.track?.id); } return seen; };

test('a shuffle goes on where the Queue interrupted it, in the same order', () => {
  const p = player();
  p.setQueue(songs(10), 0);
  p.command('cmd_player_set_shuffle', { arg1: 1 });
  p.ensureOrder();
  const order = [...p.order];
  const before = next(p, 3);
  p.enqueue(songs(2, 'q'));
  assert.deepEqual(next(p, 2), ['q0', 'q1'], 'the Queue plays after the current song');
  const after = next(p, 6);
  assert.equal(p.queueMode, false);
  assert.deepEqual(p.order, order, 'the list keeps the play order it had');
  assert.deepEqual([...before, ...after], order.slice(1).map((i) => 's' + i), 'no song comes twice, none is passed over');
});

test('Delete takes entries out of a waiting Queue; the rest plays as before', () => {
  const p = player();
  p.setQueue(songs(5), 0);
  p.enqueue(songs(4, 'q'));
  assert.equal(p.removeFromQueue([1, 2]), 2);
  assert.deepEqual(queued(p), ['q0', 'q3']);
  assert.equal(p.pendingQueue, true);
  assert.deepEqual(next(p, 3), ['q0', 'q3', 's1'], 'the two left, then the list goes on');
  assert.equal(p.removeFromQueue([7, -1, 0.5]), 0, 'places that are not entries change nothing');
});

test('the playing entry removed: the next one left plays; the last one removed ends the Queue', () => {
  const p = player();
  p.setQueue(songs(5), 0);
  p.enqueue(songs(4, 'q'));
  p.step(1);
  assert.equal(p.track.id, 'q0');
  p.removeFromQueue([0]);
  assert.equal(p.track.id, 'q1');
  assert.equal(p.index, 0);
  assert.deepEqual(queued(p), ['q1', 'q2', 'q3']);
  // An entry before the playing one goes: the playing one stays where it plays.
  p.step(1);
  p.removeFromQueue([0]);
  assert.equal(p.track.id, 'q2');
  assert.deepEqual(queued(p), ['q2', 'q3']);
  p.removeFromQueue([0, 1]);
  assert.equal(p.queueMode, false, 'an emptied Queue is left');
  assert.equal(p.track.id, 's1', 'for the list it interrupted');
});

test('a tap on a Queue entry plays the Queue from it, and Next goes on through it', () => {
  const p = player();
  p.setQueue(songs(5), 2);
  p.enqueue(songs(4, 'q'));
  assert.equal(p.playQueueAt(2), true);
  assert.equal(p.queueMode, true);
  assert.equal(p.track.id, 'q2');
  assert.deepEqual(next(p, 2), ['q3', 's3'], 'the entry after it, then back to the list that was playing');
  assert.equal(p.queueMode, false);
  assert.equal(p.playQueueAt(9), false);
});

test('a song queued twice plays twice, and adding to the Queue does not jump back to its first copy', () => {
  const p = player();
  const a = { id: 'a' }, b = { id: 'b' };
  p.setQueue(songs(3), 0);
  p.enqueue([a, a, b]);
  p.step(1);
  p.setState(1); // playing: entries are marked as they play
  p.markQueuePlayed(p.track);
  assert.deepEqual(p.entries.map((e) => e.played), [true, false, false], 'only the copy that plays is marked');
  p.step(1);
  assert.equal(p.index, 1);
  p.enqueue([{ id: 'c' }]);
  assert.equal(p.index, 1, 'still at the second copy');
  assert.deepEqual(next(p, 2), ['b', 'c']);
});

test('a shuffled Queue that gets another song keeps what it has played behind it', () => {
  for (let round = 0; round < 20; round++) {
    const p = player();
    p.setQueue(songs(3), 0);
    p.command('cmd_player_set_shuffle', { arg1: 1 });
    p.enqueue(songs(8, 'q'));
    const heard = next(p, 4);
    p.enqueue(songs(2, 'z'));
    const rest = next(p, 6);
    assert.equal(new Set([...heard, ...rest]).size, 10, `every entry once: ${heard} then ${rest}`);
  }
});

test('Clear Queue while it plays keeps the playing entry only', () => {
  const p = player();
  p.setQueue(songs(3), 0);
  p.enqueue(songs(4, 'q'));
  next(p, 2);
  p.clearQueue();
  assert.deepEqual(queued(p), ['q1']);
  assert.equal(p.track.id, 'q1');
  assert.equal(p.index, 0);
  assert.deepEqual(next(p, 1), ['s1'], 'then the list it interrupted');
});

test('Shuffle All plays every song of every category once, and leaving it returns to the playing song’s category', () => {
  const albums = [0, 1, 2].map((a) => Array.from({ length: 4 }, (_, i) => ({ id: `album${a}-song${i}` })));
  const source = { count: 3, tracksAt: (i) => albums[i], groups: albums.map((_, i) => ({ title: `Album ${i}` })) };
  const p = player();
  p.setQueue(albums[1], 2, { source, index: 1 });
  p.command('cmd_player_set_repeat', { arg1: 2 }); // advance through the categories
  p.command('cmd_player_set_shuffle', { arg1: 1 });
  assert.equal(p.track.id, 'album1-song2', 'the playing song goes on');
  assert.equal(p.queue.length, 12, 'the list is every album’s songs');
  const heard = [p.track.id, ...next(p, 11)];
  assert.equal(new Set(heard).size, 12, `each once: ${heard}`);
  assert.ok(heard.slice(0, 6).some((id) => !id.startsWith('album1')), 'it leaves the album it started in');
  // Shuffle off: the album of the song now playing, in its own order, from that song.
  const now = p.track.id, album = +now[5];
  p.command('cmd_player_set_shuffle', { arg1: 0 });
  assert.equal(p.track.id, now);
  assert.deepEqual(p.queue, albums[album]);
  assert.equal(p.category.index, album);
  // A list started while Shuffle All is on is widened at once.
  p.command('cmd_player_set_shuffle', { arg1: 1 });
  p.setQueue(albums[0], 0, { source, index: 0 });
  assert.equal(p.queue.length, 12);
  assert.equal(p.track.id, 'album0-song0');
  // A plain list (no categories) is shuffled as it is.
  p.setQueue(albums[2], 1);
  assert.equal(p.queue.length, 4);
});
