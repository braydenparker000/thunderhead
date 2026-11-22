// Time travel (six months unattended, from December 2026): everything the Worker works out from the date, with
// the clock set to the year's turn in the owner's zone (America/Argentina/Buenos_Aires, UTC-3 all year, no
// daylight saving) and in UTC, the last day of each month to May 2027, the 04:00 day roll, 00:00 UTC (the
// quota day), a Sunday's 02:30 (the backup) and a month's first Sunday (the drill). Pure functions take the
// instant; the integration file (tests/integration/time-travel.test.ts) moves the Worker's own clock.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drillDue, weeklyDue } from '../../src/areas/backups/ops';
import { HOLIDAY_COUNTRIES, HOLIDAY_YEARS, holidaysOf, nextHoliday } from '../../src/areas/briefing/holidays';
import { logicalDay, rollDue } from '../../src/areas/conversation/day';
import { nextUtcDay } from '../../src/areas/meter/quota';
import { weekly } from '../../src/areas/mind/night';
import { heldUntil, inQuiet, nextQuietEnd, QUIET_DEFAULT } from '../../src/areas/settings/quiet';
import { nextAt } from '../../src/areas/verbs/routine-when';
import { DAY, dayBefore, HOUR, MINUTE, ownerDay, utcDay, wallMinute, zonedMinute } from '../../src/lib/time';
import type { Db } from '../../src/objects/base';

const BA = 'America/Argentina/Buenos_Aires';
const ZONES = [BA, 'UTC'] as const;
/** The instant a wall-clock time is reached in a zone. */
const wall = (day: string, hhmm: string, tz: string) =>
  zonedMinute(day, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)), tz);
/** The last day of each month from December 2026 to May 2027. */
const MONTH_ENDS = ['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31'];

afterEach(() => {
  vi.useRealTimers();
});

describe('the owner’s day at the year’s turn', () => {
  it.each(ZONES)('%s: 23:59 is still 2026, 00:01 is 2027, and the logical day turns at 04:00', (tz) => {
    const before = wall('2026-12-31', '23:59', tz);
    const after = wall('2027-01-01', '00:01', tz);
    expect(after - before).toBe(2 * MINUTE);
    expect(ownerDay(before, tz)).toBe('2026-12-31');
    expect(ownerDay(after, tz)).toBe('2027-01-01');
    expect(wallMinute(after, tz)).toBe(1);
    // The conversation's day ends at 04:00, not at midnight.
    expect(logicalDay(after, tz)).toBe('2026-12-31');
    expect(logicalDay(wall('2027-01-01', '03:59', tz), tz)).toBe('2026-12-31');
    expect(logicalDay(wall('2027-01-01', '04:00', tz), tz)).toBe('2027-01-01');
    expect(rollDue('2026-12-31', wall('2027-01-01', '03:59', tz), tz, null)).toBeNull();
    expect(rollDue('2026-12-31', wall('2027-01-01', '04:01', tz), tz, null)).toBe('2027-01-01');
    // A conversation still going at 04:01 keeps its day until it has been quiet an hour.
    const late = wall('2027-01-01', '04:01', tz);
    expect(rollDue('2026-12-31', late, tz, late - 10 * MINUTE)).toBeNull();
    expect(rollDue('2026-12-31', late + HOUR, tz, late - 10 * MINUTE)).toBe('2027-01-01');
  });

  it('Buenos Aires is three hours behind UTC all year (no daylight saving)', () => {
    for (const day of ['2026-12-31', '2027-01-01', ...MONTH_ENDS])
      expect(wall(day, '00:00', BA) - Date.parse(`${day}T00:00:00Z`), day).toBe(3 * HOUR);
  });

  it.each(ZONES)('%s: the last day of each month to May 2027 rolls to the 1st', (tz) => {
    for (const end of MONTH_ENDS) {
      const next = dayBefore(end, -1);
      expect(next.endsWith('-01'), end).toBe(true);
      expect(ownerDay(wall(end, '23:59', tz), tz)).toBe(end);
      expect(ownerDay(wall(next, '00:01', tz), tz)).toBe(next);
      expect(logicalDay(wall(next, '03:59', tz), tz)).toBe(end);
      expect(dayBefore(next)).toBe(end);
    }
  });
});

describe('holidays after the table ends', () => {
  it('the table covers 2026 and 2027; its last covered date is 2027-12-31', () => {
    expect(HOLIDAY_YEARS).toEqual([2026, 2027]);
    // The last holiday listed anywhere is Boxing Day 2027; the table answers to 2027-12-31, then nothing.
    const last = HOLIDAY_COUNTRIES.flatMap((c) => holidaysOf(c, 2027).map((h) => h.date))
      .sort()
      .at(-1);
    expect(last).toBe('2027-12-26');
    expect(nextHoliday('GB', '2027-12-26')).toMatchObject({ date: '2027-12-26', in_days: 0 });
    for (const c of HOLIDAY_COUNTRIES) {
      expect(holidaysOf(c, 2027).length, c).toBeGreaterThan(0);
      expect(nextHoliday(c, '2027-12-31'), c).toBeNull();
      expect(holidaysOf(c, 2028), c).toEqual([]);
    }
  });

  it('the next holiday across the year’s turn, and none (no error) once the table has ended', () => {
    expect(nextHoliday('US', '2026-12-31')).toMatchObject({ date: '2027-01-01', in_days: 1 });
    expect(nextHoliday('GB', '2027-01-01')).toMatchObject({ date: '2027-01-01', in_days: 0 });
    expect(nextHoliday('US', '2027-12-26')).toBeNull();
    for (const c of HOLIDAY_COUNTRIES) {
      for (const day of ['2028-01-01', '2028-06-15', '2029-12-25'])
        expect(nextHoliday(c, day), `${c} ${day}`).toBeNull();
    }
    // A country without a list (the owner's may be one) has no tile and no error.
    expect(nextHoliday('AR', '2027-01-01')).toBeNull();
  });
});

describe('quiet hours across midnight and the year', () => {
  it.each(ZONES)('%s: 22:00 to 06:30 holds through the turn of the year', (tz) => {
    const q = QUIET_DEFAULT;
    expect(inQuiet(wall('2026-12-31', '21:59', tz), tz, q)).toBe(false);
    expect(inQuiet(wall('2026-12-31', '23:59', tz), tz, q)).toBe(true);
    expect(inQuiet(wall('2027-01-01', '00:01', tz), tz, q)).toBe(true);
    expect(inQuiet(wall('2027-01-01', '06:30', tz), tz, q)).toBe(false);
    expect(nextQuietEnd(wall('2026-12-31', '23:59', tz), tz, q)).toBe(wall('2027-01-01', '06:30', tz));
    expect(heldUntil(wall('2027-01-01', '00:01', tz), tz, q)).toBe(wall('2027-01-01', '06:30', tz));
    for (const end of MONTH_ENDS)
      expect(heldUntil(wall(end, '23:00', tz), tz, q), end).toBe(wall(dayBefore(end, -1), '06:30', tz));
  });
});

describe('routines across the year’s turn', () => {
  it.each(ZONES)('%s: a daily 07:30 and a Friday 09:00 come due in 2027', (tz) => {
    expect(nextAt({ at: '07:30' }, wall('2026-12-31', '23:59', tz), tz)).toBe(wall('2027-01-01', '07:30', tz));
    // 2027-01-01 is a Friday.
    expect(nextAt({ at: '09:00', days: ['fri'] }, wall('2026-12-31', '23:59', tz), tz)).toBe(
      wall('2027-01-01', '09:00', tz),
    );
    expect(nextAt({ at: '09:00', days: ['fri'] }, wall('2027-01-01', '09:00', tz), tz)).toBe(
      wall('2027-01-08', '09:00', tz),
    );
    for (const end of MONTH_ENDS)
      expect(nextAt({ at: '07:30' }, wall(end, '08:00', tz), tz), end).toBe(wall(dayBefore(end, -1), '07:30', tz));
  });
});

describe('the quota day turns at 00:00 UTC, whatever the owner’s zone', () => {
  it('23:59 UTC on 31 December is 2026’s; 00:01 is 2027’s, and the next turn is the following 00:00', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-12-31T23:59:00Z'));
    expect(utcDay(Date.now())).toBe('2026-12-31');
    expect(nextUtcDay(Date.now())).toBe(Date.parse('2027-01-01T00:00:00Z'));
    // In Buenos Aires it is still 20:59 on the 31st, but the quota day turns all the same.
    expect(ownerDay(Date.now(), BA)).toBe('2026-12-31');
    vi.setSystemTime(Date.parse('2027-01-01T00:01:00Z'));
    expect(utcDay(Date.now())).toBe('2027-01-01');
    expect(nextUtcDay(Date.now())).toBe(Date.parse('2027-01-02T00:00:00Z'));
    for (const end of MONTH_ENDS) {
      expect(utcDay(Date.parse(`${end}T23:59:59Z`))).toBe(end);
      expect(nextUtcDay(Date.parse(`${end}T23:59:59Z`))).toBe(Date.parse(`${dayBefore(end, -1)}T00:00:00Z`));
    }
  });
});

describe('backups on Sundays at 02:30 and the drill on a month’s first Sunday', () => {
  /** A database with no backups yet, or with each day's complete backup and no drill. */
  const fake = (complete: boolean) =>
    ({
      one: (sql: string) =>
        sql.includes('FROM backups') && complete && !sql.includes('running') ? { state: 'complete' } : null,
      all: () => [],
    }) as unknown as Db;

  it('a backup is due on Sundays from 02:30, in 2026 and 2027', () => {
    const db = fake(false);
    // 2027-01-03 is the first Sunday of 2027; 2026-12-27 the last of 2026.
    for (const sunday of ['2026-12-27', '2027-01-03', '2027-01-31', '2027-02-28', '2027-05-30']) {
      expect(weeklyDue(db, sunday, 2 * 60 + 29), sunday).toBe(false);
      expect(weeklyDue(db, sunday, 2 * 60 + 30), sunday).toBe(true);
    }
    for (const other of ['2026-12-31', '2027-01-01', '2027-01-02', '2027-01-04'])
      expect(weeklyDue(db, other, 180)).toBe(false);
  });

  it('the drill is due after each month’s first Sunday backup, and on the Monday after', () => {
    const db = fake(true);
    const firsts = ['2027-01-03', '2027-02-07', '2027-03-07', '2027-04-04', '2027-05-02'];
    for (const sunday of firsts) {
      expect(drillDue(db, sunday)?.month, sunday).toBe(sunday.slice(0, 7));
      expect(drillDue(db, dayBefore(sunday, -1))?.month, `Monday after ${sunday}`).toBe(sunday.slice(0, 7));
      expect(drillDue(db, dayBefore(sunday, -7)), `the second Sunday after ${sunday}`).toBeNull();
    }
    // December 2026's first Sunday is the 6th; the last Sunday of the year is no drill's.
    expect(drillDue(db, '2026-12-06')?.month).toBe('2026-12');
    expect(drillDue(db, '2026-12-27')).toBeNull();
    expect(drillDue(db, '2026-12-28')).toBeNull();
  });

  it('the weekly night step runs on the night into Sunday (a Saturday’s), across the year', () => {
    expect(weekly('2027-01-02')).toBe(true);
    expect(weekly('2027-01-01')).toBe(false);
    expect(weekly('2026-12-26')).toBe(true);
  });
});

describe('180 days from now', () => {
  it.each(ZONES)('%s: the day helpers agree with the calendar for every day to then', (tz) => {
    const start = Date.parse('2026-11-21T15:00:00Z');
    for (let k = 0; k <= 180; k++) {
      const at = start + k * DAY;
      const day = ownerDay(at, tz);
      expect(dayBefore(day, -1), day).toBe(ownerDay(at + DAY, tz));
      expect(zonedMinute(day, wallMinute(at, tz), tz), day).toBe(at - (at % MINUTE));
    }
    expect(ownerDay(start + 180 * DAY, tz)).toBe('2027-05-20');
  });
});
