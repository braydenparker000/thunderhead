// The + sheet's logic without a page (th/attach/state.js, th/attach/times.js): what is picked and
// its limit of four, lengths and sizes as people read them, and when a reminder is for.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { add, clock, onPicked, picked, remove, room, size, take } from '../frontend/th/attach/state.js';
import { choices, when } from '../frontend/th/attach/times.js';

const file = (id) => ({ id, name: `${id}.jpg`, type: 'image/jpeg', bytes: 1000, blob: /** @type {any} */ (null) });

test('at most four files on a message; a change is heard; take empties the bar', () => {
  let heard = 0;
  onPicked(() => heard++);
  assert.equal(room(), 4);
  assert.equal(add([file('a'), file('b'), file('c')]), true);
  assert.equal(add([file('d'), file('e')]), false, 'the fifth does not fit');
  assert.deepEqual(picked.map((f) => f.id), ['a', 'b', 'c', 'd']);
  assert.equal(room(), 0);
  remove('b');
  assert.deepEqual(picked.map((f) => f.id), ['a', 'c', 'd']);
  assert.deepEqual(take().map((f) => f.id), ['a', 'c', 'd']);
  assert.equal(picked.length, 0);
  assert.equal(heard, 4);
});

test('lengths and sizes read the way people say them', () => {
  assert.equal(clock(0), '0:00');
  assert.equal(clock(42.7), '0:42');
  assert.equal(clock(600), '10:00');
  assert.equal(size(300), '1 KB');
  assert.equal(size(820 * 1024), '820 KB');
  assert.equal(size(2.44 * 1024 * 1024), '2.4 MB');
});

test('the quick choices: in an hour, this evening until 18:30, tomorrow morning', () => {
  const at10 = new Date(2026, 9, 30, 10, 0, 30).getTime();
  assert.deepEqual(
    choices(at10).map(([label, t]) => [label, new Date(t).toString()]),
    [
      ['In 1 hour', new Date(2026, 9, 30, 11, 1).toString()],
      ['This evening', new Date(2026, 9, 30, 19, 0).toString()],
      ['Tomorrow morning', new Date(2026, 9, 31, 8, 0).toString()],
    ],
  );
  assert.deepEqual(
    choices(new Date(2026, 9, 30, 18, 29).getTime()).map(([l]) => l),
    ['In 1 hour', 'This evening', 'Tomorrow morning'],
  );
  assert.deepEqual(
    choices(new Date(2026, 9, 30, 18, 30).getTime()).map(([l]) => l),
    ['In 1 hour', 'Tomorrow morning'],
    'gone at 18:30',
  );
  const lastDay = choices(new Date(2026, 9, 31, 21, 0).getTime());
  assert.equal(new Date(lastDay[1][1]).getDate(), 1, 'tomorrow morning crosses the month');
});

test('when it is for, in words', () => {
  const now = new Date(2026, 9, 30, 10, 0).getTime();
  assert.equal(when(new Date(2026, 9, 30, 19, 0).getTime(), now), 'at 19:00');
  assert.equal(when(new Date(2026, 9, 31, 6, 30).getTime(), now), 'tomorrow at 06:30');
  assert.equal(when(new Date(2026, 10, 2, 9, 5).getTime(), now), 'on Monday at 09:05');
  assert.equal(when(new Date(2026, 10, 13, 9, 0).getTime(), now), 'on 13 Nov at 09:00');
});
