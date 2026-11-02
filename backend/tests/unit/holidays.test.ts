// The Holidays tile's list (backend/src/areas/briefing/holidays.ts; BRIEFING.md §2): Easter by the
// computus, each country's movable days on their 2026 and 2027 dates, nothing outside those years,
// the next holiday within 14 days (the day itself included), and none for a country without a
// list. And the day's line (assemble.ts): counts only, no zeros, shortened to fit 60 characters.
import { describe, expect, it } from 'vitest';
import { todayLine } from '../../src/areas/briefing/assemble';
import { easter, HOLIDAY_COUNTRIES, holidaysOf, nextHoliday } from '../../src/areas/briefing/holidays';

const on = (c: (typeof HOLIDAY_COUNTRIES)[number], y: number, name: string) =>
  holidaysOf(c, y).find((h) => h.name === name)?.date;

describe('the holiday list', () => {
  it('finds Easter', () => {
    expect(new Date(easter(2026)).toISOString().slice(0, 10)).toBe('2026-04-05');
    expect(new Date(easter(2027)).toISOString().slice(0, 10)).toBe('2027-03-28');
  });

  it('puts each movable day on its date', () => {
    expect(
      [
        on('US', 2026, 'Martin Luther King Jr. Day'),
        on('US', 2026, 'Memorial Day'),
        on('US', 2026, 'Thanksgiving'),
        on('US', 2027, 'Thanksgiving'),
        on('US', 2027, 'Labor Day'),
      ],
      'US',
    ).toEqual(['2026-01-19', '2026-05-25', '2026-11-26', '2027-11-25', '2027-09-06']);
    expect(
      [
        on('GB', 2026, 'Good Friday'),
        on('GB', 2026, 'Early May bank holiday'),
        on('GB', 2026, 'Summer bank holiday'),
        on('GB', 2027, 'Easter Monday'),
      ],
      'GB',
    ).toEqual(['2026-04-03', '2026-05-04', '2026-08-31', '2027-03-29']);
    expect(
      [on('CA', 2026, 'Victoria Day'), on('CA', 2027, 'Victoria Day'), on('CA', 2026, 'Thanksgiving')],
      'CA',
    ).toEqual(['2026-05-18', '2027-05-24', '2026-10-12']);
    expect([on('AU', 2026, 'King’s Birthday'), on('AU', 2027, 'King’s Birthday')], 'AU').toEqual([
      '2026-06-08',
      '2027-06-14',
    ]);
    expect(
      [on('DE', 2026, 'Ascension Day'), on('DE', 2026, 'Whit Monday'), on('DE', 2027, 'Whit Monday')],
      'DE',
    ).toEqual(['2026-05-14', '2026-05-25', '2027-05-17']);
    expect([on('FR', 2027, 'Ascension Day'), on('FR', 2026, 'Bastille Day')], 'FR').toEqual([
      '2027-05-06',
      '2026-07-14',
    ]);
    expect([on('ES', 2027, 'Good Friday'), on('ES', 2026, 'Immaculate Conception')], 'ES').toEqual([
      '2027-03-26',
      '2026-12-08',
    ]);
    expect(
      [
        on('MX', 2026, 'Constitution Day'),
        on('MX', 2026, 'Benito Juárez’s Birthday'),
        on('MX', 2027, 'Revolution Day'),
      ],
      'MX',
    ).toEqual(['2026-02-02', '2026-03-16', '2027-11-15']);
  });

  it('covers every country in both years only, in date order, names within the tile’s 32 characters', () => {
    for (const c of HOLIDAY_COUNTRIES)
      for (const y of [2026, 2027]) {
        const list = holidaysOf(c, y);
        expect(list.length, `${c} ${y}`).toBeGreaterThanOrEqual(7);
        expect(list.map((h) => h.date)).toEqual(list.map((h) => h.date).sort());
        expect(list.every((h) => h.date.startsWith(String(y)) && h.name.length <= 32)).toBe(true);
      }
    expect(holidaysOf('US', 2025)).toEqual([]);
    expect(holidaysOf('US', 2028)).toEqual([]);
  });

  it('gives the next one within 14 days, the day itself included; none past the list or without one', () => {
    expect(nextHoliday('US', '2026-11-02')).toEqual({ date: '2026-11-11', name: 'Veterans Day', in_days: 9 });
    expect(nextHoliday('US', '2026-11-11')).toMatchObject({ name: 'Veterans Day', in_days: 0 });
    expect(nextHoliday('GB', '2026-11-02')).toBeNull();
    expect(nextHoliday('GB', '2026-12-20')).toMatchObject({ date: '2026-12-25', in_days: 5 });
    expect(nextHoliday('FR', '2026-12-30')).toMatchObject({ date: '2027-01-01', in_days: 2 });
    expect(nextHoliday('US', '2027-12-26')).toBeNull();
    for (const c of ['XX', 'us', '', null, undefined, 7]) expect(nextHoliday(c, '2026-11-02')).toBeNull();
  });
});

describe('the day’s line', () => {
  it('is made of counts, leaves out zeros, and says nothing when all are zero', () => {
    expect(todayLine('2026-11-02', { due: 0, episodes: 0, songs: 0 })).toEqual({
      date: 'Monday 2 November',
      line: null,
    });
    expect(todayLine('2026-11-02', { due: 1, episodes: 0, songs: null }).line).toBe('1 reminder due today.');
    expect(todayLine('2026-11-02', { due: 2, episodes: 3, songs: 0 }).line).toBe(
      '2 reminders due today and 3 new episodes.',
    );
    expect(todayLine('2026-11-02', { due: 2, episodes: 1, songs: 12 }).line).toBe(
      '2 reminders due today, 1 new episode and 12 songs added.',
    );
    const long = todayLine('2026-11-02', { due: 50, episodes: 400, songs: 100 }).line ?? '';
    expect(long).toBe('50 reminders due, 99+ new episodes and 99+ songs added.');
    expect(long.length).toBeLessThanOrEqual(60);
  });
});
