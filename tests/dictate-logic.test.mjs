// Dictation's pure parts (th/dictate/dictate.js, HOME.md §6.4): how the pieces' words join in the bar
// after what was there, and that an answer that comes back late never replaces a newer one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barText, EVERY_MS, HOLD_MS, SHORT_MS, takes } from '../frontend/th/dictate/dictate.js';
import { DICTATE_LIMITS } from '../frontend/th/contract.js';

test("the bar: each piece's words after what was there, one space between, empty pieces skipped", () => {
  assert.equal(barText('', ['remind me', '', ' to stretch ']), 'remind me to stretch');
  assert.equal(barText('Note:', ['buy rope']), 'Note: buy rope');
  assert.equal(barText('Note: ', ['buy rope']), 'Note: buy rope');
  assert.equal(barText('kept', ['', '  ']), 'kept', 'nothing heard leaves the bar as it was');
  assert.equal(barText('   ', ['hello']), 'hello');
});

test('answers out of order: a piece shows only an answer newer than the one it shows', () => {
  const shown = [];
  assert.equal(takes(shown, 0, 0), true);
  assert.equal(takes(shown, 0, 2), true);
  assert.equal(takes(shown, 0, 1), false, 'the live answer sent before the final one came back after it');
  assert.equal(takes(shown, 1, 3), true, 'each piece counts on its own');
  assert.deepEqual(shown, [2, 3]);
});

test('the timings: a hold is longer than a tap, a piece goes for its words well inside its length', () => {
  assert.ok(HOLD_MS >= 200 && HOLD_MS <= 400);
  assert.ok(SHORT_MS > HOLD_MS);
  assert.ok(EVERY_MS < DICTATE_LIMITS.piece_seconds * 1000 / 4);
  assert.deepEqual(DICTATE_LIMITS, { bytes: 1_048_576, piece_seconds: 15, take_seconds: 120 });
});
