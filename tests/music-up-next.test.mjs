// The music player's queue rules for Up next and History (owner, 2026-11-25), its own logic in
// Node with no audio (frontend/music/src/player/player.js, queue-moves.js, play-history.js):
// queued songs keep the order chosen whatever the shuffle; a song tapped elsewhere keeps them
// waiting; played ones leave Next up; the pagers show what Next and Previous really play; Previous
// goes back by what was heard within 5 s and restarts after; a play is written once it has sounded
// 10 s, each time, at most 500. Every song here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/site-imports.mjs';

const { Player, STATE_PLAYING } = await import('../frontend/music/src/player/player.js');
const { HEARD_MS, HISTORY_CAP, heardWhen } = await import('../frontend/music/src/player/play-history.js');
const { SHUFFLE_DJ } = await import('../frontend/th/music/dj.js');

/** A player on its own: a bus, the given settings, a clock for what it hears, nothing else. */
function player(prefs = {}) {
  const subs = [];
  const bus = { subscribe: (b, f) => { subs.push([b, f]); return () => {}; }, post: (b, m, s, d) => { for (const [name, f] of subs) if (name === b) f(m, s, d); } };
  const p = new Player({ bus, pref: (k) => prefs[k], res: { stringByName: () => null } });
  p.clockNow = 0;
  p.history.clock = () => p.clockNow;
  return p;
}
const songs = (n, prefix = 's') => Array.from({ length: n }, (_, i) => ({ id: prefix + i, title: `Invented ${prefix}${i}`, durationMs: 200_000 }));
const next = (p, times = 1) => { const seen = []; for (let i = 0; i < times; i++) { p.step(1); seen.push(p.track?.id); } return seen; };
/** The song sounds for ms (the history's ticks, half a second apart). */
function hear(p, ms) {
  if (p.state !== STATE_PLAYING) p.setState(STATE_PLAYING);
  p.history.sync();
  for (let t = 0; t < ms; t += 500) { p.clockNow += 500; p.history.tick(); }
}
/** Places the playing song at ms (the demo clock the player keeps without audio). */
function at(p, ms) {
  p.virtualPos = p.state === STATE_PLAYING ? 0 : ms;
  p.virtualStart = performance.now() - (p.state === STATE_PLAYING ? ms : 0);
}

test('queued songs play in the order chosen under shuffle and the DJ; only the list is shuffled', () => {
  for (const mode of [1, 2, SHUFFLE_DJ]) {
    for (let round = 0; round < 10; round++) {
      const p = player();
      p.setQueue(songs(12), 0);
      p.command('cmd_player_set_shuffle', { arg1: mode });
      p.enqueue(songs(5, 'q'));
      assert.deepEqual(next(p, 5), ['q0', 'q1', 'q2', 'q3', 'q4'], `mode ${mode}`);
      // More queued while the Queue plays: still in order after the playing one.
      p.enqueue(songs(2, 'z'));
      assert.equal(p.queueMode, true);
      assert.deepEqual(next(p, 2), ['z0', 'z1']);
      const after = next(p, 11);
      assert.equal(new Set(after).size, 11, 'then the list, shuffled, each song once');
      assert.ok(after.every((id) => id.startsWith('s')));
    }
  }
});

test('a song tapped elsewhere keeps the queued songs: they play after it, then its list goes on', () => {
  const p = player();
  const a = songs(6, 'a'), b = songs(6, 'b');
  p.setQueue(a, 0);
  p.setState(STATE_PLAYING);
  p.enqueue(songs(3, 'q'));
  assert.deepEqual(next(p, 1), ['q0']);
  assert.equal(p.queueMode, true);
  // A tap in another list.
  p.setQueue(b, 2);
  assert.equal(p.track.id, 'b2');
  assert.equal(p.queueMode, false);
  assert.equal(p.pendingQueue, true, 'q1 and q2 wait');
  assert.deepEqual(p.nextUp().map((e) => e.track.id), ['q1', 'q2']);
  assert.deepEqual(next(p, 4), ['q1', 'q2', 'b3', 'b4']);
});

test("search's Play keeps the queued songs (they play after the first result)", () => {
  const p = player();
  p.setQueue(songs(5), 0);
  p.enqueue(songs(2, 'q'));
  p.playAsQueue(songs(4, 'found'));
  assert.equal(p.track.id, 'found0');
  assert.deepEqual(p.entries.map((e) => [e.track.id, e.played]), [['q0', false], ['q1', false]]);
  assert.deepEqual(next(p, 3), ['q0', 'q1', 'found1']);
});

test('played entries leave Next up; Play next for the playing song plays it again next', () => {
  const p = player();
  p.setQueue(songs(5), 0);
  p.setState(STATE_PLAYING);
  p.enqueue(songs(3, 'q'));
  next(p, 2);
  assert.deepEqual(p.nextUp().map((e) => e.track.id), ['q2'], 'q0 played, q1 plays: neither is up next');
  const p2 = player();
  p2.setQueue(songs(5), 0);
  p2.setState(STATE_PLAYING);
  p2.enqueue([p2.track], true);
  p2.pause();
  p2.play();
  assert.deepEqual(p2.nextUp().map((e) => e.track.id), ['s0'], 'a pause and play leave it queued');
  assert.deepEqual(next(p2, 2), ['s0', 's1']);
});

test('the pagers preview what Next and Previous really play: the queued song, the wrap, the list after the Queue', () => {
  const p = player({ queue_end: 1 });
  p.command('cmd_player_set_repeat', { arg1: 0 });
  p.setQueue(songs(3), 2);
  assert.equal(p.trackAt(1, true), null, 'the last song, no repeat: no next page');
  p.command('cmd_player_set_repeat', { arg1: 1 });
  assert.equal(p.trackAt(1, true)?.id, 's0', 'repeat: the first song');
  p.setQueue(songs(3), 0);
  assert.equal(p.trackAt(-1, true)?.id, 's2', 'and before the first, the last');
  p.enqueue(songs(2, 'q'));
  assert.equal(p.trackAt(1, true)?.id, 'q0', 'a queued song plays next');
  const check = () => { const want = p.trackAt(1, true)?.id ?? null; p.step(1); return [want, p.track?.id]; };
  for (let k = 0; k < 4; k++) { const [want, got] = check(); assert.equal(want, got, `step ${k}`); }
  // The Queue's last entry: the list it interrupted, from where it was.
  const q = player({ queue_end: 1 });
  q.setQueue(songs(5), 1);
  q.command('cmd_player_set_shuffle', { arg1: 1 });
  q.enqueue(songs(1, 'q'));
  q.step(1);
  assert.equal(q.track.id, 'q0');
  const want = q.trackAt(1, true)?.id;
  q.step(1);
  assert.equal(q.track.id, want, 'after the Queue, the song the preview showed');
  // queue_start 3 (after the list): at the list's last song, the Queue.
  const r = player({ queue_start: 3 });
  r.command('cmd_player_set_repeat', { arg1: 0 });
  r.setQueue(songs(3), 2);
  r.enqueue(songs(1, 'q'));
  assert.equal(r.trackAt(1, true)?.id, 'q0');
});

test('Previous within 5 s goes back to the song heard before, shuffled or not; after 5 s it restarts the song', () => {
  const p = player();
  p.setQueue(songs(10), 0);
  p.command('cmd_player_set_shuffle', { arg1: 1 });
  p.setState(STATE_PLAYING);
  hear(p, HEARD_MS + 500);
  const heard = p.track.id;
  // Another song of the list, picked (the shuffle's previous is some other song).
  p.load(p.queue.findIndex((t) => t.id === 's7'), true);
  at(p, 2000);
  p.command('cmd_player_play_prev_track');
  assert.equal(p.track.id, heard, 'the song heard before');
  // Past 5 s: the song starts again.
  p.load(p.queue.findIndex((t) => t.id === 's4'), true);
  at(p, 6000);
  p.command('cmd_player_play_prev_track');
  assert.equal(p.track.id, 's4');
  assert.ok(p.positionMs() < 1000, 'from its start');
  // Pressed again at once: back again, past what this press went back to.
  hear(p, HEARD_MS + 500);
  p.load(p.queue.findIndex((t) => t.id === 's9'), true);
  at(p, 1000);
  p.command('cmd_player_play_prev_track');
  assert.equal(p.track.id, 's4');
  at(p, 1000);
  p.command('cmd_player_play_prev_track');
  assert.equal(p.track.id, heard, 'and the one before it');
});

test('Previous at the start of the history, or with the setting off, is the list’s previous song', () => {
  const p = player();
  p.setQueue(songs(5), 3);
  p.setState(STATE_PLAYING);
  at(p, 1000);
  p.command('cmd_player_play_prev_track');
  assert.equal(p.track.id, 's2', 'nothing heard yet');
  const off = player({ previous_resets: false });
  off.setQueue(songs(5), 3);
  off.setState(STATE_PLAYING);
  at(off, 8000);
  off.command('cmd_player_play_prev_track');
  assert.equal(off.track.id, 's2', 'off: always the previous song');
});

test('Previous to a song of another list plays it, then the list goes on with the song it left', () => {
  const p = player();
  p.setQueue(songs(4, 'a'), 1);
  p.setState(STATE_PLAYING);
  hear(p, HEARD_MS + 500);
  p.setQueue(songs(4, 'b'), 2);
  p.setState(STATE_PLAYING);
  at(p, 1000);
  p.command('cmd_player_play_prev_track');
  assert.equal(p.track.id, 'a1');
  assert.deepEqual(next(p, 2), ['b2', 'b3']);
});

test('a play is written once it has sounded 10 s: not before, not on a track change, twice for two plays, at most 500', () => {
  const p = player();
  p.setQueue(songs(3), 0);
  p.setState(STATE_PLAYING);
  hear(p, HEARD_MS - 500);
  assert.equal(p.history.items.length, 0, '9.5 s: not yet');
  p.pause();
  p.history.sync();
  for (let t = 0; t < 20_000; t += 500) { p.clockNow += 500; p.history.tick(); }
  assert.equal(p.history.items.length, 0, 'paused, nothing sounds');
  hear(p, 500);
  assert.deepEqual(p.history.items.map((e) => e.id), ['s0'], 'at 10 s');
  next(p, 1);
  hear(p, 3000);
  next(p, 1);
  assert.deepEqual(p.history.items.map((e) => e.id), ['s0'], 'a song left after 3 s is not written');
  p.load(0, true);
  hear(p, HEARD_MS);
  assert.deepEqual(p.history.items.map((e) => e.id), ['s0', 's0'], 'a song heard twice is there twice');
  for (let i = 0; i < HISTORY_CAP + 10; i++) p.history.write({ id: 'x' + i });
  assert.equal(p.history.items.length, HISTORY_CAP);
  assert.equal(p.history.items[0].id, 'x' + (HISTORY_CAP + 9), 'newest first');
});

test('Next up moves: put back where it was, cleared and put back, reordered, a list song passed over this time', () => {
  const p = player();
  p.setQueue(songs(6), 0);
  p.enqueue(songs(4, 'q'));
  const ids = () => p.entries.map((e) => e.track.id);
  const gone = p.takeOut([p.entries[1]]);
  assert.deepEqual(ids(), ['q0', 'q2', 'q3']);
  p.putBack(gone);
  assert.deepEqual(ids(), ['q0', 'q1', 'q2', 'q3'], 'in its place');
  const cleared = p.clearNextUp();
  assert.deepEqual(ids(), []);
  assert.equal(p.pendingQueue, false);
  p.putBack(cleared);
  assert.deepEqual(ids(), ['q0', 'q1', 'q2', 'q3']);
  assert.equal(p.pendingQueue, true);
  p.reorderNextUp([p.entries[3], p.entries[0], p.entries[2], p.entries[1]]);
  assert.deepEqual(ids(), ['q3', 'q0', 'q2', 'q1']);
  // A tap on an entry plays it; the others follow in their order.
  p.playEntry(p.entries[2]);
  assert.equal(p.track.id, 'q2');
  assert.deepEqual(next(p, 3), ['q3', 'q0', 'q1']);
  // The list after the Queue: s1 passed over this time round, and back with Undo.
  const r = player();
  r.setQueue(songs(6), 0);
  assert.deepEqual(r.ahead(3).map((a) => a.track.id), ['s1', 's2', 's3']);
  r.skipOnce(1);
  assert.deepEqual(r.ahead(3).map((a) => a.track.id), ['s2', 's3', 's4']);
  r.skipOnce(1, false);
  assert.equal(r.trackAt(1)?.id, 's1');
  r.skipOnce(1);
  assert.deepEqual(next(r, 1), ['s2']);
  r.command('cmd_player_set_repeat', { arg1: 1 });
  assert.deepEqual(r.ahead(10).map((a) => a.track.id), ['s3', 's4', 's5', 's0', 's1'], 'next time round it plays');
});

test('when a song was heard reads as the owner would say it', () => {
  const now = new Date(2026, 10, 25, 22, 0).getTime();
  assert.equal(heardWhen(now - 20_000, now), 'Just now');
  assert.equal(heardWhen(now - 2 * 60_000, now), '2 min ago');
  assert.equal(heardWhen(new Date(2026, 10, 25, 9, 5).getTime(), now), '09:05');
  assert.equal(heardWhen(new Date(2026, 10, 24, 21, 14).getTime(), now), 'Yesterday 21:14');
});
