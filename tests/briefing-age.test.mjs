// The Briefing says its age (frontend/th/briefing/age.js): a day kept on this phone is never painted
// as today; it says which day it is from, and what was about that day leaves; today's answer that
// could not be refreshed says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { age, dayOf, keeps } from '../frontend/th/briefing/age.js';

const now = new Date(2026, 10, 21, 9, 30); // Saturday 21 November 2026, local

test('today, refreshed, says nothing; today, not refreshed, says so', () => {
  assert.equal(dayOf(now), '2026-11-21');
  assert.deepEqual(age('2026-11-21', now, false), { old: false, line: '' });
  assert.deepEqual(age('2026-11-21', now, true), { old: false, line: 'Couldn’t refresh just now' });
});

test('another day says which, whether or not the refresh failed', () => {
  assert.deepEqual(age('2026-11-20', now, false), { old: true, line: 'From yesterday' });
  assert.deepEqual(age('2026-11-20', now, true), { old: true, line: 'From yesterday' });
  assert.deepEqual(age('2026-11-17', now, false), { old: true, line: 'From Tuesday' });
  assert.deepEqual(age('2026-11-03', now, false), { old: true, line: 'From 3 November' });
  assert.equal(age('2026-10-31', new Date(2026, 10, 1, 0, 5), false).line, 'From yesterday', 'across a month');
});

test('on another day the tiles about that day leave; the rest stay', () => {
  const kinds = ['report', 'waiting', 'calendar', 'due', 'night', 'holiday'];
  assert.deepEqual(kinds.filter((kind) => keeps({ kind })), ['report', 'waiting', 'night']);
});
