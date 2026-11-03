// What the Briefing makes of the kept calendar (BRIEFING.md "Today"), at a fixed moment in a zone
// that isn't UTC: today's events not yet over (all-day ones too, ongoing ones too), tomorrow's
// first timed one, a link past its 48 hours left out with the line that says since when, a shared
// link's events as outside text by its mark now; the tile's lines, the day's line with its count and
// the brief's lines. Invented events, kept straight into Core's rows.
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { calendarTile, todayLine } from '../../src/areas/briefing/assemble';
import { briefLines, feedId, view } from '../../src/areas/briefing/calendar-store';
import { zonedMinute } from '../../src/lib/time';
import type { Auth } from '../../src/objects/auth';
import { Db, Meter } from '../../src/objects/base';
import { core } from '../helpers';

const TZ = 'Europe/Paris';
const H = 3_600_000;
// Tuesday 3 November 2026, 16:00 in Paris (15:00 UTC).
const NOW = zonedMinute('2026-11-03', 16 * 60, TZ);
const at = (day: string, hh: number, mm = 0) => zonedMinute(day, hh * 60 + mm, TZ);
const MINE = 'https://calendar.example.com/ical/a.ics';
const SHARED = 'https://shared.example.org/b.ics';
const GONE = 'https://old.example.net/c.ics';

const seeded = () =>
  runInDurableObject(core() as unknown as DurableObjectStub<Auth>, (_o, state) => {
    const sql = state.storage.sql;
    sql.exec('DELETE FROM calendar_events');
    sql.exec('DELETE FROM calendar_feeds');
    sql.exec(
      `INSERT INTO settings (key, value_json, updated_at, actor) VALUES ('briefing.calendars', ?, 0, 'test')
       ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
      JSON.stringify([
        { url: MINE, mine: true },
        { url: SHARED, mine: false },
        { url: GONE, mine: true },
      ]),
    );
    const feed = (url: string, ok: number, failing: number | null, error: string | null) =>
      sql.exec(
        'INSERT INTO calendar_feeds (feed, checked_at, ok_at, failing_since, error, hash, n) VALUES (?, ?, ?, ?, ?, NULL, 0)',
        feedId(url),
        NOW - H,
        ok,
        failing,
        error,
      );
    feed(MINE, NOW - H, null, null);
    feed(SHARED, NOW - 2 * H, null, null);
    // Last good 50 hours ago, failing since Sunday 21:30.
    feed(GONE, NOW - 50 * H, at('2026-11-01', 21, 30), 'unreachable');
    const ev = (url: string, uid: string, start: number, end: number, title: string, allDay = false, location = '') =>
      sql.exec(
        `INSERT INTO calendar_events (feed, uid, start, end, all_day, title, location, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'owner')`,
        feedId(url),
        uid,
        start,
        end,
        allDay ? 1 : 0,
        title,
        location || null,
      );
    ev(MINE, 'm1', at('2026-11-03', 9), at('2026-11-03', 10), 'Over already');
    ev(MINE, 'm2', at('2026-11-03', 15), at('2026-11-03', 17), 'Going on');
    ev(MINE, 'm3', at('2026-11-03', 0), at('2026-11-04', 0), 'Bins out', true);
    ev(SHARED, 's1', at('2026-11-03', 18), at('2026-11-03', 21), 'Dinner', false, 'The Old Mill');
    ev(SHARED, 's2', at('2026-11-04', 0), at('2026-11-05', 0), 'Market day', true);
    ev(MINE, 'm4', at('2026-11-04', 8, 30), at('2026-11-04', 9), 'Standup');
    ev(MINE, 'm5', at('2026-11-05', 8), at('2026-11-05', 9), 'Day after');
    ev(GONE, 'g1', at('2026-11-03', 19), at('2026-11-03', 20), 'From the old link');
    return view(new Db(sql, new Meter()), NOW, TZ);
  });

describe('the Briefing’s calendar', () => {
  it('today: not yet over (all day first), tomorrow’s first timed one, a link past 48 hours left out and named', async () => {
    const v = await seeded();
    expect(v.today.map((e) => [e.title, e.source])).toEqual([
      ['Bins out', 'owner'],
      ['Going on', 'owner'],
      ['Dinner', 'outside'],
    ]);
    expect(v.tomorrow?.title).toBe('Standup');
    expect(v.notice).toBe('Calendar not reachable since Sunday 21:30');
  });

  it('the tile leads with the next timed event, times in the owner’s zone, and the day’s line counts it', async () => {
    const v = await seeded();
    const t = calendarTile(v, TZ);
    expect(t).toMatchObject({ kind: 'calendar', label: 'Today', value: '15:00 Going on', detail: '3 things on today' });
    expect(t?.today.map((e) => [e.time, e.title, e.location])).toEqual([
      [null, 'Bins out', null],
      ['15:00', 'Going on', null],
      ['18:00', 'Dinner', 'The Old Mill'],
    ]);
    expect(t?.tomorrow).toMatchObject({ time: '08:30', title: 'Standup' });
    expect(t?.notice).toBe('Calendar not reachable since Sunday 21:30');
    expect(calendarTile({ today: [], tomorrow: null, notice: null }, TZ)).toBeNull();
    expect(calendarTile({ today: [], tomorrow: null, notice: 'A calendar is over 1 MB.' }, TZ)).toMatchObject({
      value: 'Calendar not reachable',
      detail: 'A calendar is over 1 MB.',
    });
    expect(calendarTile({ today: [], tomorrow: v.tomorrow, notice: null }, TZ)).toMatchObject({
      value: 'Tomorrow 08:30 Standup',
      detail: 'Nothing else today',
    });
    expect(todayLine('2026-11-03', { events: 3, due: 1, episodes: 0, songs: null }).line).toBe(
      '3 things on today and 1 reminder due today.',
    );
    // Over 60 characters: "due today" becomes "due", then the last counts drop until it fits.
    const long = todayLine('2026-11-03', { events: 12, due: 50, episodes: 400, songs: 100 }).line ?? '';
    expect(long).toBe('12 things on today, 50 reminders due and 99+ new episodes.');
    expect(long.length).toBeLessThanOrEqual(60);
  });

  it('the brief’s lines: times, titles as data, where, and (outside) for a shared link', async () => {
    expect(briefLines(await seeded(), TZ)).toEqual([
      'calendar today: all day "Bins out"',
      'calendar today: 15:00–17:00 "Going on"',
      'calendar today: 18:00–21:00 "Dinner" at "The Old Mill" (outside)',
      'calendar tomorrow: 08:30–09:00 "Standup"',
      'calendar: Calendar not reachable since Sunday 21:30',
    ]);
  });
});
