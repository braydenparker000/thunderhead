// B1: Astra's and My Media's watching as senses (th/senses/watch.js), from each app's own progress:
// both stores read into refs (a title's id, never its name), and two looks compared: time watched
// (capped at twice the time between the looks, so a seek isn't watching; under 10 s it waits and
// adds up), a title finished, an unfinished title taken off Continue Watching. Every sense is a
// type of the contract with only its fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SENSE_TYPES } from '../shared/contract/senses.ts';
import { astraSpots, changes, mediaSpots } from '../frontend/th/senses/watch.js';

const NOW = Date.UTC(2026, 10, 2, 20);
const MIN = 60_000;

test('both apps’ progress, by ref, in ms', () => {
  assert.deepEqual(
    astraSpots({
      'movie:tt0000001|tt0000001': { type: 'movie', id: 'tt0000001', time: 600, duration: 6000, updated: NOW, completed: false, meta: { name: 'An Invented Film' } },
      'series:tt0000002|x': { type: 'series', id: 'tt0000002', season: 1, episode: 2, time: 30, duration: 1500, updated: NOW, completed: true },
      bad: { type: 'movie', id: 'has spaces', time: 1, duration: 2 },
    }),
    {
      'astra:movie:tt0000001': { t: 600_000, d: 6_000_000, done: false, at: NOW },
      'astra:series:tt0000002:1:2': { t: 30_000, d: 1_500_000, done: true, at: NOW },
    },
  );
  assert.deepEqual(mediaSpots({ '1AbCdEfGhIj': { t: 12.5, d: 300, done: false, at: NOW }, 'bad id!': { t: 1, d: 2 } }), {
    'media:1AbCdEfGhIj': { t: 12_500, d: 300_000, done: false, at: NOW },
  });
  assert.deepEqual(astraSpots(null), {});
});

test('two looks: watched, capped, waiting under 10 s, finished, dropped', () => {
  const was = {
    look: NOW - 10 * MIN,
    spots: {
      'astra:movie:a': { t: 60_000, d: 6_000_000, done: false, at: NOW - 11 * MIN },
      'astra:movie:b': { t: 60_000, d: 6_000_000, done: false, at: NOW - 11 * MIN },
      'media:c': { t: 100_000, d: 200_000, done: false, at: NOW - 11 * MIN },
      'media:d': { t: 50_000, d: 900_000, done: false, at: NOW - 11 * MIN },
      'media:e': { t: 50_000, d: 900_000, done: false, at: NOW - 30 * 86_400_000 },
      'astra:movie:quiet': { t: 70_000, d: 900_000, done: false, at: NOW - 11 * MIN },
    },
  };
  const now = {
    // Five minutes more of a; b jumped an hour ahead in 10 minutes (a seek): 20 minutes at most.
    'astra:movie:a': { t: 360_000, d: 6_000_000, done: false, at: NOW - MIN },
    'astra:movie:b': { t: 3_660_000, d: 6_000_000, done: false, at: NOW - MIN },
    // c played to its end; d moved 4 s (waits, keeping its earlier place); quiet wasn't saved.
    'media:c': { t: 200_000, d: 200_000, done: true, at: NOW - MIN },
    'media:d': { t: 54_000, d: 900_000, done: false, at: NOW - MIN },
    'astra:movie:quiet': { t: 70_000, d: 900_000, done: false, at: NOW - 11 * MIN },
    // A new title: from 0.
    'media:f': { t: 40_000, d: 900_000, done: false, at: NOW - MIN },
  };
  const c = changes(was, now, NOW);
  assert.deepEqual(c.senses, [
    ['media.watch', 'astra:movie:a', { ms: 300_000 }],
    ['media.watch', 'astra:movie:b', { ms: 1_200_000 }],
    ['media.watch', 'media:c', { ms: 100_000 }],
    ['media.finish', 'media:c', null],
    ['media.watch', 'media:f', { ms: 40_000 }],
    // e left too, but a month ago: not a drop now.
  ]);
  assert.equal(c.spots['media:d'].t, 50_000, 'under 10 s: the earlier place stays, so it adds up');
  assert.equal(c.spots['astra:movie:a'].t, 360_000);
  // d taken off Continue Watching unfinished, seen lately: dropped where it was.
  const { 'media:d': gone, ...left } = c.spots;
  assert.ok(gone);
  const after = changes({ look: NOW, spots: c.spots }, left, NOW + MIN);
  assert.deepEqual(after.senses, [['media.drop', 'media:d', { at_ms: 50_000 }]]);
  for (const [type, , data] of [...c.senses, ...after.senses]) {
    assert.ok(Object.hasOwn(SENSE_TYPES, type), type);
    for (const k of Object.keys(data ?? {})) assert.ok(Object.hasOwn(SENSE_TYPES[type].data, k), `${type}.${k}`);
  }
});
