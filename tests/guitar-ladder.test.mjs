// Guitar's tempo ladder (frontend/guitar/ladder.js, GUITAR.md §4.3, NEXT-BATCH.md part 9): the exact
// speeds a scripted run of marked passes produces, the floor and the target, the double step, where
// the next day starts, what is kept per section, and which bars the next session opens on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { climb, cleanLadder, judge, noted, sectionKey, weakest } from '../frontend/th/guitar/ladder.js';

const PREFS = { on: true, start: 70, step: 4, target: 100 };
const run = (marks, c = climb(PREFS, null), step = 4) => {
  const speeds = [];
  for (const m of marks) {
    c = judge(c, m === 'C', step);
    speeds.push(c.speed);
  }
  return { speeds, c };
};

test('GUITAR.md §4.3: C, C, N, C, C, N, N gives exactly these speeds', () => {
  // Two clean step up 4; two misses in a row step down 8, never below the start.
  assert.deepEqual(run(['C', 'C', 'N', 'C', 'C', 'N', 'N']).speeds, [70, 74, 74, 74, 78, 78, 70]);
});

test('the floor is where the climb started, the ceiling the target', () => {
  assert.deepEqual(run(['N', 'N', 'N', 'N']).speeds, [70, 70, 70, 70]);
  const top = run(Array(20).fill('C'), climb({ ...PREFS, target: 80 }, null));
  assert.equal(Math.max(...top.speeds), 80);
  assert.equal(top.c.speed, 80);
  assert.equal(top.c.moved, null, 'at the target nothing moves');
});

test('9 or more of the last 10 clean doubles the next step, once; 4 or fewer asks for a slower start', () => {
  const { c } = run(['C', 'C', 'C', 'C', 'C', 'C', 'C', 'C', 'C'], climb({ ...PREFS, target: 150 }, null));
  assert.equal(c.speed, 86, 'four steps up');
  const tenth = judge(c, true, 4);
  assert.equal(tenth.speed, 94, 'the 10th clean pass ends a pair with 10 of 10 clean: a step of 8');
  assert.equal(tenth.doubled, true);
  assert.equal(judge(judge(tenth, true, 4), true, 4).speed, 98, 'only once');
  assert.equal(run(['N', 'C', 'N', 'N', 'C', 'N', 'N', 'C', 'N', 'N']).c.slower, true);
});

test('the next day starts a little under the last ceiling, never under the start or over the target', () => {
  assert.equal(climb(PREFS, { day: '2026-10-30', passes: 8, clean: 6, ceiling: 90, best: 90, last: null }).speed, 82);
  assert.equal(climb(PREFS, { day: '2026-10-30', passes: 8, clean: 6, ceiling: 74, best: 74, last: null }).speed, 70);
  assert.equal(climb({ ...PREFS, target: 85 }, { day: '2026-10-30', passes: 8, clean: 8, ceiling: 130, best: 130, last: null }).speed, 85);
});

test('kept per section: today\'s counts and ceiling, the best clean speed ever, the day before', () => {
  let r = noted(null, 70, true, '2026-10-30');
  r = noted(r, 74, false, '2026-10-30');
  r = noted(r, 74, true, '2026-10-30');
  assert.deepEqual(r, { day: '2026-10-30', passes: 3, clean: 2, ceiling: 74, best: 74, last: null });
  r = noted(r, 66, false, '2026-10-31');
  assert.deepEqual(r, { day: '2026-10-31', passes: 1, clean: 0, ceiling: 0, best: 74, last: { day: '2026-10-30', passes: 3, clean: 2, ceiling: 74 } });
  assert.equal(noted(r, 90, false, '2026-10-31').best, 74, 'best moves only on a clean pass');
});

test('the next session opens on the bars that went worst on the last day played (3 passes at least)', () => {
  const sections = {
    [sectionKey(0, 3)]: { day: '2026-10-30', passes: 10, clean: 8, ceiling: 84, best: 84, last: null },
    [sectionKey(4, 7)]: { day: '2026-10-30', passes: 10, clean: 4, ceiling: 72, best: 76, last: null },
    [sectionKey(8, 9)]: { day: '2026-10-30', passes: 2, clean: 0, ceiling: 0, best: 0, last: null },
    [sectionKey(10, 11)]: { day: '2026-10-28', passes: 6, clean: 0, ceiling: 0, best: 0, last: null },
  };
  assert.deepEqual(weakest(sections, '2026-10-31'), { key: '4-7', passes: 10, clean: 4 });
  // Played today already: today's counts are the new last day only from tomorrow; the day before stands.
  const today = { ...sections, '4-7': noted(sections['4-7'], 80, true, '2026-10-31') };
  assert.deepEqual(weakest(today, '2026-10-31'), { key: '4-7', passes: 10, clean: 4 });
  assert.equal(weakest({}, '2026-10-31'), null);
  assert.equal(weakest(null, '2026-10-31'), null);
});

test('a stored record is made safe', () => {
  const safe = cleanLadder({ '4-7': { day: '2026-10-30', passes: 5, clean: 9, ceiling: 999, best: -3, last: 'x' }, 'bad key': { day: '2026-10-30' }, '1-2': { day: 'yesterday' } });
  assert.deepEqual(safe, { '4-7': { day: '2026-10-30', passes: 5, clean: 5, ceiling: 150, best: 0, last: null } });
  assert.deepEqual(cleanLadder('nope'), {});
});
