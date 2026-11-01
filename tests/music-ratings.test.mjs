// The owner's ratings as senses (frontend/th/music/ratings.js; MUSIC.md §10.1, §10.5): each change in
// Music's library becomes one `music.rate` with the song's id (and the rating before, when known);
// the one-time catch-up sends the songs already rated 1, at most 100 a page load and never more than
// the outbox has room for, each remembered as sent only once the Worker took it; an id that can't be
// a ref, or a rating out of 0–5, sends nothing. Synthetic ids only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATCH_UP, catchUp, installRatings, rateSense, refOf, ROOM_MARGIN, runCatchUp } from '../frontend/th/music/ratings.js';

test('a rating change is one music.rate with the id, the rating and the one before', () => {
  assert.deepEqual(rateSense('r2_native_abc', 1, 4), ['music.rate', 'music:r2_native_abc', { rating: 1, from: 4 }]);
  assert.deepEqual(rateSense('r2_native_abc', 3, undefined), ['music.rate', 'music:r2_native_abc', { rating: 3 }]);
  for (const [id, r] of [['has space', 1], ['', 1], ['r2_x', 6], ['r2_x', -1], ['r2_x', 2.5], [42, 1]])
    assert.equal(rateSense(id, r, undefined), null, `${id} ${r}`);
  assert.equal(refOf('a'.repeat(155)), null);
});

test('the catch-up: songs rated 1 not sent before, at most 100, in library order', () => {
  const tracks = Array.from({ length: 300 }, (_, i) => ({ id: `t${i}`, rating: i % 2 ? 1 : 5 }));
  const first = catchUp(tracks, new Set());
  assert.equal(first.length, CATCH_UP);
  assert.equal(CATCH_UP, 100);
  assert.deepEqual(first.slice(0, 3), ['t1', 't3', 't5']);
  const second = catchUp(tracks, new Set(first));
  assert.equal(second.length, 50);
  assert.equal(second[0], 't201');
  assert.deepEqual(catchUp(tracks, new Set([...first, ...second])), []);
  assert.deepEqual(catchUp([{ id: 'bad id', rating: 1 }, { rating: 1 }, { id: 't', rating: '1' }], new Set()), []);
});

test('installed on the player: a change on its bus goes out as a sense', async () => {
  /** @type {((msg: string, src: unknown, d: unknown) => void)[]} */
  const subs = [];
  const ctx = { bus: { subscribe: (_name, fn) => subs.push(fn) }, library: { tracks: [] } };
  const timers = [];
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => { timers.push(fn); return 0; };
  try { installRatings(ctx); } finally { globalThis.setTimeout = real; }
  assert.equal(subs.length, 1);
  assert.equal(timers.length, 1, 'the catch-up waits for the library');
  // send.js can't load under node (it is a site path): the change is dropped quietly, never thrown.
  subs[0]('msg_data_track_rating_changed', null, { track: { id: 'r2_native_abc' }, arg1: 1 });
  subs[0]('msg_data_track_played', null, { track: { id: 'r2_native_abc' } });
});

test('the catch-up fits the outbox and counts a song sent only once the Worker took it', async () => {
  const tracks = Array.from({ length: 300 }, (_, i) => ({ id: `t${i}`, rating: 1 }));
  /** An outbox with `free` room that takes its events when `taken` (else they stay waiting). */
  const box = (free, taken = true) => {
    const kept = [];
    return {
      kept,
      sense: async (type, ref, data) => { kept.push([type, ref, data]); return true; },
      room: () => free,
      flush: async () => {},
      drained: () => taken,
    };
  };
  const store = () => {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m };
  };
  // Room for 80 more: 30 go (50 stay free for the page's other events), and are remembered.
  const s = store();
  let out = box(80);
  assert.deepEqual(await runCatchUp(tracks, out, s), tracks.slice(0, 30).map((t) => t.id));
  assert.equal(out.kept.length, 80 - ROOM_MARGIN);
  assert.deepEqual(out.kept[0], ['music.rate', 'music:t0', { rating: 1 }]);
  // A full outbox: nothing is queued, nothing remembered.
  out = box(ROOM_MARGIN);
  assert.deepEqual(await runCatchUp(tracks, out, s), []);
  assert.equal(out.kept.length, 0);
  // Offline, or the Worker didn't take them: queued, but the next load sends the same songs again.
  out = box(200, false);
  assert.deepEqual(await runCatchUp(tracks, out, s), []);
  assert.equal(out.kept.length, CATCH_UP);
  assert.equal(out.kept[0][1], 'music:t30');
  out = box(200);
  const next = await runCatchUp(tracks, out, s);
  assert.deepEqual([next.length, next[0]], [CATCH_UP, 't30']);
  // Signed out: the outbox keeps nothing, and nothing counts as sent.
  const signedOut = { ...box(200), sense: async () => false };
  assert.deepEqual(await runCatchUp(tracks, signedOut, s), []);
  assert.equal(JSON.parse(s.m.get('th.music.rated')).length, 30 + CATCH_UP);
  assert.deepEqual(await runCatchUp(tracks, null, s), [], 'no outbox where it cannot load');
});
