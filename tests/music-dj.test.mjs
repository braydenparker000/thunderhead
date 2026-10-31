// The DJ shuffle's planner (frontend/th/music/dj.js; MUSIC.md §9), on synthetic libraries: songs
// close in the tags follow each other; no artist twice within 10 picks; a song skipped early five
// times isn't picked again; nothing played in the last 50; seeded runs replay; a 7,000-song order
// is planned fast; a new plan after a skip keeps the next 3 songs; and the player's model gets its
// sixth shuffle mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeness, djOrder, DJ_AHEAD, installDjMode, KEEP_AHEAD, learn, lesson, pick, replan, seeded, SHUFFLE_DJ } from '../frontend/th/music/dj.js';

const GENRES = ['Classical', 'Jazz', 'Rock', 'Folk', 'Ambient'];
const library = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    artist: `Artist ${i % 60}`,
    album: `Album ${i % 120}`,
    genre: GENRES[i % GENRES.length],
    composer: i % GENRES.length === 0 ? `Composer ${i % 7}` : '',
    year: 1960 + (i % 50),
  }));
const empty = () => ({ tracks: {}, moves: {}, recent: [] });
const NOW = Date.parse('2026-10-30T12:00:00Z');

test('closeness: the same composer, artist and genre count, a near year a little', () => {
  const a = { id: 'a', composer: 'Holst', artist: 'LSO', genre: 'Classical', year: 1990 };
  assert.ok(closeness(a, { id: 'b', composer: 'Holst', artist: 'LSO', genre: 'Classical', year: 1990 }) > 1.6);
  assert.ok(closeness(a, { id: 'c', genre: 'Classical / Film', year: 1995 }) > 0.3);
  assert.equal(closeness(a, { id: 'd', genre: 'Rock', year: 1950 }), 0);
});

test('an order: the current song first, every song once, the planned part close in the tags', () => {
  const t = library(500);
  const order = djOrder(t, 10, { learned: empty(), seed: 7, now: NOW });
  assert.equal(order[0], 10);
  assert.deepEqual([...order].sort((a, b) => a - b), [...t.keys()]);
  const planned = order.slice(0, DJ_AHEAD + 1);
  const sameGenre = planned.slice(1).filter((i, k) => t[i].genre === t[planned[k]].genre).length;
  assert.ok(sameGenre >= DJ_AHEAD * 0.8, `${sameGenre} of ${DJ_AHEAD} follow in their genre`);
  // No artist twice within 10 picks.
  for (let k = 0; k < planned.length; k++) {
    const window = planned.slice(Math.max(0, k - 9), k).map((i) => t[i].artist);
    assert.ok(!window.includes(t[planned[k]].artist), `artist repeats at pick ${k}`);
  }
  assert.deepEqual(djOrder(t, 10, { learned: empty(), seed: 7, now: NOW }), order, 'a seeded run replays');
});

test('learning: a song skipped early five times is never picked; recent songs wait; "not for me" never', () => {
  const t = library(500);
  const l = empty();
  for (let k = 0; k < 5; k++) learn(l, null, 't5', 10_000, 200_000, NOW);
  assert.ok(l.tracks.t5[0] <= -3);
  const rand = seeded(3);
  const pool = [...t.keys()];
  t[15].rating = 1;
  for (let k = 0; k < 1000; k++) {
    const x = pick(t, k % 500, pool, [], l, rand, NOW);
    assert.notEqual(t[x].id, 't5');
    assert.notEqual(x, 15);
  }
  const recent = Array.from({ length: 50 }, (_, i) => `t${i * 5}`);
  for (let k = 0; k < 200; k++) assert.ok(!recent.includes(t[pick(t, 0, pool, recent, empty(), rand, NOW)].id));
  assert.deepEqual([lesson(5_000, 200_000), lesson(60_000, 200_000), lesson(150_000, 200_000), lesson(199_000, 200_000)], [
    [-1, -1],
    [-0.25, -0.5],
    [0.5, 0.5],
    [1, 1],
  ]);
});

test('a 7,000-song library is planned fast', () => {
  const t = library(7000);
  // The best of three, so a busy machine's pauses don't count as the planner's time.
  let ms = Infinity;
  for (let i = 0; i < 3; i++) {
    const at = performance.now();
    djOrder(t, 0, { learned: empty(), seed: 1, now: NOW });
    ms = Math.min(ms, performance.now() - at);
  }
  assert.ok(ms < 400, `${Math.round(ms)} ms`);
});

test('a new plan after a skip keeps the next 3 songs already planned (their heads stay useful), then plans on', () => {
  const t = library(500);
  const order = djOrder(t, 10, { learned: empty(), seed: 7, now: NOW });
  // Next, early in the song: the song left is learned (and recent); the plan starts again from the new one.
  const l = empty();
  learn(l, null, t[order[0]].id, 5_000, 200_000, NOW);
  const again = replan(t, order, order[1], { learned: l, seed: 8, now: NOW });
  assert.equal(KEEP_AHEAD, 3);
  assert.deepEqual(again.slice(0, 4), order.slice(1, 5));
  assert.deepEqual([...again].sort((a, b) => a - b), [...t.keys()], 'every song once');
  assert.notDeepEqual(again.slice(4, 20), order.slice(5, 21), 'planned again after them');
  // A song already played or skipped is not kept, even if the old plan had it next (Previous).
  l.recent.push(t[order[3]].id);
  assert.deepEqual(replan(t, order, order[2], { learned: l, seed: 8, now: NOW }).slice(0, 3), [order[2], order[4], order[5]]);
  // An order of another queue keeps only the song playing.
  assert.equal(replan(t, order.slice(1), 42, { learned: empty(), seed: 8, now: NOW })[0], 42);
});

test("the player's model gets a sixth shuffle mode, DJ, once", () => {
  const model = {
    values: {
      integer: { SHUFFLE_ALL: [['1']] },
      string: {},
      array: {
        shuffle_modes_enum: [[['@integer/SHUFFLE_NONE', '@integer/SHUFFLE_ALL', 'a', 'b', 'c']]],
        shuffle_modes: [[['n', 'a', 'b', 'c', 'd']]],
        shuffle_modes_line2: [[['', '', '', '', '']]],
        shuffle_modes_long: [[['', '', '', '', '', 'hier']]],
        shuffle_icons_32dp: [[['i0', 'i1', 'i2', 'i3', 'i4', 'i5']]],
      },
    },
  };
  installDjMode(model);
  installDjMode(model);
  assert.equal(model.values.array.shuffle_modes_enum[0][0].length, 6);
  assert.equal(model.values.array.shuffle_modes_enum[0][0][SHUFFLE_DJ], '@integer/SHUFFLE_DJ');
  assert.equal(model.values.array.shuffle_modes[0][0][SHUFFLE_DJ], '@string/shuffle_dj');
  assert.deepEqual(model.values.string.shuffle_dj, [['DJ']]);
  assert.deepEqual(model.values.integer.SHUFFLE_DJ, [['5']]);
});
