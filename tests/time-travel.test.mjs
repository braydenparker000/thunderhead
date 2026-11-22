// Time travel on the phone (six months unattended, from December 2026): what the site works out from the date,
// with node's mock clock set to the year's turn, the last day of each month to May 2027 and 180 days from now,
// on a phone in the owner's zone (America/Argentina/Buenos_Aires, UTC-3, no daylight saving) and in UTC. The
// Briefing's age line, the daily pictures' cycle (look/plates.js), the data meter's day and month
// (th/data/tally.js), Guitar's week and streak, and "last used" on the device list. The Worker's side is in
// backend/tests/unit/time-travel.test.ts and backend/tests/integration/time-travel.test.ts.
import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { age, dayOf as briefDay } from '../frontend/th/briefing/age.js';
import { pick } from '../frontend/look/plates.js';
import { add, dayOf, empty, prune, totals } from '../frontend/th/data/tally.js';
import { createStore } from '../frontend/guitar/store.js';
import { lastActive } from '../frontend/th/format.js';

const ZONES = ['America/Argentina/Buenos_Aires', 'UTC'];
const MONTH_ENDS = ['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31'];
const zoneBefore = process.env.TZ;
/** Runs `fn` with the phone in each zone. */
const inEachZone = (fn) => {
  for (const tz of ZONES) {
    process.env.TZ = tz;
    fn(tz);
  }
};
/** A local wall-clock time, in the zone now set. */
const local = (day, hh = 0, mm = 0) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
};
/** The clock set to `ms`. */
const at = (ms) => {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: ms });
};
const next = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return briefDay(new Date(y, m - 1, d + 1, 12));
};

afterEach(() => {
  mock.timers.reset();
  if (zoneBefore === undefined) delete process.env.TZ;
  else process.env.TZ = zoneBefore;
});

test('the clock and the zone are the ones set', () => {
  inEachZone((tz) => {
    at(local('2027-01-01', 0, 1));
    assert.equal(new Date().getFullYear(), 2027, tz);
    assert.equal(new Date().getHours() * 60 + new Date().getMinutes(), 1, tz);
  });
  process.env.TZ = 'America/Argentina/Buenos_Aires';
  assert.equal(new Date(Date.UTC(2027, 0, 1, 3, 1)).getHours(), 0, 'UTC-3');
});

test('the Briefing’s age line at the year’s turn and at each month’s end', () => {
  inEachZone((tz) => {
    at(local('2027-01-01', 0, 1));
    // The Worker answers with the calendar day (assemble.ts), so a fresh answer is today's at 00:01.
    assert.deepEqual(age('2027-01-01', new Date(), false), { old: false, line: '' }, tz);
    assert.deepEqual(age('2026-12-31', new Date(), false), { old: true, line: 'From yesterday' }, tz);
    assert.deepEqual(age('2026-12-26', new Date(), false), { old: true, line: 'From Saturday' }, tz);
    assert.deepEqual(age('2026-12-25', new Date(), false), { old: true, line: 'From 25 December' }, tz);
    at(local('2026-12-31', 23, 59));
    assert.deepEqual(age('2026-12-31', new Date(), false), { old: false, line: '' }, tz);
    for (const end of MONTH_ENDS) {
      at(local(next(end), 0, 1));
      assert.deepEqual(age(next(end), new Date(), false), { old: false, line: '' }, `${tz} ${end}`);
      assert.equal(age(end, new Date(), false).line, 'From yesterday', `${tz} ${end}`);
    }
  });
});

test('the daily pictures turn by the local calendar, every day to the end of May 2027', () => {
  const all = JSON.parse(readFileSync(new URL('../frontend/look/plates.json', import.meta.url), 'utf8'));
  const seen = {};
  inEachZone((tz) => {
    for (const set of ['ink', 'lamp']) {
      let before = null;
      for (let t = local('2026-11-21', 12); t <= local('2027-05-31', 12); t += 86_400_000) {
        const d = new Date(t);
        at(t);
        const p = pick(all, new Date(), set);
        const day = briefDay(d);
        assert.ok(p, `${tz} ${set} ${day}`);
        assert.equal(p.day, d.getDay() === 0 ? 'sunday' : d.getDay() === 5 ? 'friday' : 'any', day);
        // The same day shows the same picture on a phone in either zone.
        const key = `${set} ${day}`;
        if (seen[key]) assert.equal(p.file, seen[key], `${key} in ${tz}`);
        seen[key] = p.file;
        // Two weekdays in a row never show the same picture, across the year too.
        if (before && before.day === 'any' && p.day === 'any') assert.notEqual(p.file, before.file, `${set} ${day}`);
        before = p;
      }
      // Late on the 31st and early on the 1st are two days, by the phone's own clock.
      assert.notEqual(pick(all, new Date(local('2026-12-31', 23, 59)), set), undefined);
      assert.notEqual(pick(all, new Date(local('2027-01-01', 0, 1)), set), undefined);
    }
  });
});

test('the data meter’s day and month turn at the phone’s midnight, and it keeps 62 days', () => {
  inEachZone((tz) => {
    const late = local('2026-12-31', 23, 59);
    const early = local('2027-01-01', 0, 1);
    assert.equal(dayOf(late), '2026-12-31', tz);
    assert.equal(dayOf(early), '2027-01-01', tz);
    at(early);
    const t = empty(Date.now());
    add(t, dayOf(late), 'music.songs', 0, 5000);
    add(t, dayOf(early), 'music.songs', 1, 700);
    const { today, month } = totals(t, Date.now());
    assert.deepEqual(today.all, [0, 700, 0], `${tz} today is 2027's alone`);
    assert.deepEqual(month.all, [0, 700, 0], `${tz} January is 2027's alone`);
    at(late);
    assert.deepEqual(totals(t, Date.now()).month.all, [5000, 0, 0], `${tz} December is 2026's alone`);
    // 62 days today included: on 1 January the oldest kept is 1 November.
    add(t, '2026-11-01', 'api', 0, 1);
    add(t, '2026-10-31', 'api', 0, 1);
    at(early);
    prune(t, Date.now());
    assert.ok(t.days['2026-11-01'], tz);
    assert.equal(t.days['2026-10-31'], undefined, tz);
    for (const end of MONTH_ENDS) {
      at(local(next(end), 0, 1));
      const m = empty(Date.now());
      add(m, end, 'api', 0, 10);
      add(m, next(end), 'api', 0, 1);
      assert.deepEqual(totals(m, Date.now()).month.all, [1, 0, 0], `${tz} ${end}`);
    }
  });
});

test('Guitar’s week runs Monday to Sunday across the year, and the streak carries over', () => {
  inEachZone((tz) => {
    const mem = new Map();
    const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    at(local('2026-12-30', 20));
    const store = createStore(storage, () => Date.now());
    store.practice('s1', 120, local('2026-12-30', 20));
    store.practice('s1', 300, local('2026-12-31', 23, 58));
    store.practice('s1', 90, local('2027-01-01', 0, 1));
    at(local('2027-01-01', 9));
    const s = store.stats(Date.now());
    assert.deepEqual(s.week.map((d) => d.day), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'], tz);
    assert.equal(s.weekTotal, 510, tz);
    assert.equal(s.weekDays, 3, tz);
    assert.equal(s.today, 90, tz);
    assert.equal(s.streak, 3, tz);
    // The next Monday starts a new week.
    at(local('2027-01-04', 9));
    assert.equal(store.stats(Date.now()).weekTotal, 0, tz);
    assert.equal(store.stats(Date.now()).week[0].day, '2027-01-04', tz);
  });
});

test('“last used” on the device list counts calendar days across the year', () => {
  inEachZone((tz) => {
    const now = local('2027-01-01', 1, 30);
    assert.equal(lastActive(local('2026-12-31', 22), now), 'yesterday', tz);
    assert.equal(lastActive(local('2026-12-25', 12), now), '7 days ago', tz);
    assert.equal(lastActive(local('2027-01-01', 1), now), 'active now', tz);
    assert.equal(lastActive(local('2027-01-01', 0, 1), now), 'active today', tz);
    // 90 days after a last use is past the 30-day words: the date.
    assert.equal(lastActive(local('2026-10-03', 12), now), '3 Oct', tz);
  });
});

test('180 days from now the day helpers still agree with the calendar', () => {
  inEachZone((tz) => {
    const start = local('2026-11-21', 12);
    for (let k = 0; k <= 180; k++) {
      const d = new Date(start);
      d.setDate(d.getDate() + k);
      assert.equal(dayOf(d.getTime()), briefDay(d), tz);
      assert.equal(next(briefDay(d)), briefDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12)), tz);
    }
    const d = new Date(start);
    d.setDate(d.getDate() + 180);
    assert.equal(briefDay(d), '2027-05-20', tz);
  });
});
