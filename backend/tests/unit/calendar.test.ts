// The calendar's parser and fetch (BRIEFING.md "Today", areas/briefing/ics.ts, calendar.ts) on
// invented calendars: a date-time in UTC, with a TZID (IANA, Windows) and floating; all day; an
// event crossing midnight; RRULE weekly with BYDAY, daily with COUNT, UNTIL (a date-time and a
// date), monthly by month day and by an nth weekday, across a clock change; EXDATE and a moved or
// cancelled occurrence; a rule not supported shows once; folded lines, escapes and VALARM; the
// 14-day window in the owner's zone. The fetch: 1 MB at most, no redirect followed, only a calendar.
import { afterEach, describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../../../shared/contract/briefing.ts';
import { CalendarError, fetchIcs, useFetch } from '../../src/areas/briefing/calendar';
import { parseIcs } from '../../src/areas/briefing/ics';
import { zonedMinute } from '../../src/lib/time';

const TZ = 'America/New_York';
// The window: Monday 2 November 2026 (after the US clock change on the 1st) and 13 days more.
const FROM = zonedMinute('2026-11-02', 0, TZ);
const TO = zonedMinute('2026-11-16', 0, TZ);

/** A calendar of these events (CRLF lines, as hosts send them). */
const ics = (...events: string[][]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Example//Test//EN',
    ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']),
    'END:VCALENDAR',
  ].join('\r\n');
const parse = (text: string, tz = TZ, from = FROM, to = TO) =>
  parseIcs(text, { from, to, ownerTz: tz, source: 'owner' });
const starts = (es: CalendarEvent[]) => es.map((e) => new Date(e.start).toISOString());

describe('one event', () => {
  it('reads UTC, a TZID, a Windows zone name and floating times (the owner’s zone)', () => {
    const got = parse(
      ics(
        ['UID:a', 'DTSTART:20261103T170000Z', 'DTEND:20261103T180000Z', 'SUMMARY:In UTC'],
        [
          'UID:b',
          'DTSTART;TZID=Europe/Paris:20261103T180000',
          'DTEND;TZID=Europe/Paris:20261103T193000',
          'SUMMARY:In Paris',
        ],
        ['UID:c', 'DTSTART;TZID="Eastern Standard Time":20261104T080000', 'SUMMARY:Windows zone'],
        ['UID:d', 'DTSTART:20261104T090000', 'DURATION:PT45M', 'SUMMARY:Floating'],
        ['UID:e', 'DTSTART;TZID=/mozilla.org/20050126_1/Asia/Tokyo:20261105T090000', 'SUMMARY:Mozilla path'],
        ['UID:f', 'DTSTART;TZID=Nowhere/Made_Up:20261105T120000', 'SUMMARY:Unknown zone'],
      ),
    );
    expect(got.map((e) => [e.title, new Date(e.start).toISOString(), (e.end - e.start) / 60_000])).toEqual([
      ['In Paris', '2026-11-03T17:00:00.000Z', 90],
      ['In UTC', '2026-11-03T17:00:00.000Z', 60],
      ['Windows zone', '2026-11-04T13:00:00.000Z', 0],
      ['Floating', '2026-11-04T14:00:00.000Z', 45],
      ['Mozilla path', '2026-11-05T00:00:00.000Z', 0],
      // A zone it doesn't know is the owner's.
      ['Unknown zone', '2026-11-05T17:00:00.000Z', 0],
    ]);
    expect(got.every((e) => e.all_day === false && e.source === 'owner')).toBe(true);
  });

  it('reads all-day events from the owner’s midnight, one day without DTEND, several with it', () => {
    const got = parse(
      ics(
        ['UID:a', 'DTSTART;VALUE=DATE:20261104', 'SUMMARY:Bins out'],
        ['UID:b', 'DTSTART;VALUE=DATE:20261106', 'DTEND;VALUE=DATE:20261109', 'SUMMARY:Away'],
      ),
    );
    expect(got.map((e) => [e.title, e.all_day, e.start, e.end])).toEqual([
      ['Bins out', true, zonedMinute('2026-11-04', 0, TZ), zonedMinute('2026-11-05', 0, TZ)],
      ['Away', true, zonedMinute('2026-11-06', 0, TZ), zonedMinute('2026-11-09', 0, TZ)],
    ]);
  });

  it('keeps an event that crosses midnight into the window, and leaves out what ended before it or starts after', () => {
    const got = parse(
      ics(
        [
          'UID:late',
          'DTSTART;TZID=America/New_York:20261101T230000',
          'DTEND;TZID=America/New_York:20261102T010000',
          'SUMMARY:Late show',
        ],
        [
          'UID:done',
          'DTSTART;TZID=America/New_York:20261101T200000',
          'DTEND;TZID=America/New_York:20261101T230000',
          'SUMMARY:Over',
        ],
        ['UID:last', 'DTSTART;TZID=America/New_York:20261115T233000', 'SUMMARY:Last in'],
        ['UID:out', 'DTSTART;TZID=America/New_York:20261116T000000', 'SUMMARY:First out'],
        ['UID:old', 'DTSTART;VALUE=DATE:20261101', 'SUMMARY:Yesterday'],
      ),
    );
    expect(got.map((e) => e.title)).toEqual(['Late show', 'Last in']);
  });

  it('unfolds lines, undoes escapes, keeps one line, cuts long titles and skips VALARM', () => {
    const long = 'A'.repeat(100);
    const [a, b] = parse(
      ics(
        [
          'UID:a',
          'DTSTART:20261103T170000Z',
          'SUMMARY:Dinner with\\, friends\\; and\\nmore wo',
          ' rds here',
          'LOCATION:The Old Mill\\, Back Lane',
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          'SUMMARY:Not the title',
          'DESCRIPTION:Reminder',
          'END:VALARM',
        ],
        ['UID:b', 'DTSTART:20261104T170000Z', `SUMMARY:${long}`],
      ),
    );
    expect([a.title, a.location]).toEqual(['Dinner with, friends; and more words here', 'The Old Mill, Back Lane']);
    expect([b.title.length, b.title.endsWith('…'), b.location]).toEqual([80, true, null]);
    expect(parse(ics(['UID:x', 'DTSTART:20261104T170000Z']))[0].title).toBe('(no title)');
  });
});

describe('repeating events, only inside the window', () => {
  it('weekly on given days, in the event’s own zone', () => {
    const got = parse(
      ics([
        'UID:w',
        'DTSTART;TZID=America/New_York:20261005T083000',
        'DTEND;TZID=America/New_York:20261005T093000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE',
        'SUMMARY:Run',
      ]),
    );
    expect(starts(got)).toEqual([
      '2026-11-02T13:30:00.000Z',
      '2026-11-04T13:30:00.000Z',
      '2026-11-09T13:30:00.000Z',
      '2026-11-11T13:30:00.000Z',
    ]);
    expect(new Set(got.map((e) => e.uid))).toEqual(new Set(['w']));
  });

  it('daily with COUNT counts from the first, before the window too', () => {
    const got = parse(ics(['UID:d', 'DTSTART:20261101T200000Z', 'RRULE:FREQ=DAILY;COUNT=4', 'SUMMARY:Pill']));
    expect(starts(got)).toEqual(['2026-11-02T20:00:00.000Z', '2026-11-03T20:00:00.000Z', '2026-11-04T20:00:00.000Z']);
  });

  it('UNTIL as a date-time (inclusive) and as a date', () => {
    const timed = parse(
      ics([
        'UID:u',
        'DTSTART;TZID=America/New_York:20261102T120000',
        'RRULE:FREQ=DAILY;UNTIL=20261105T170000Z',
        'SUMMARY:Stand-up',
      ]),
    );
    expect(starts(timed)).toEqual([
      '2026-11-02T17:00:00.000Z',
      '2026-11-03T17:00:00.000Z',
      '2026-11-04T17:00:00.000Z',
      '2026-11-05T17:00:00.000Z',
    ]);
    const dated = parse(
      ics(['UID:v', 'DTSTART;VALUE=DATE:20261103', 'RRULE:FREQ=WEEKLY;UNTIL=20261110', 'SUMMARY:Recycling']),
    );
    expect(dated.map((e) => e.start)).toEqual([zonedMinute('2026-11-03', 0, TZ), zonedMinute('2026-11-10', 0, TZ)]);
  });

  it('monthly by month day (a day the month lacks is skipped) and by an nth weekday', () => {
    const days = parse(
      ics(['UID:m', 'DTSTART:20260903T150000Z', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=3,12,31', 'SUMMARY:Rent']),
    );
    expect(starts(days)).toEqual(['2026-11-03T15:00:00.000Z', '2026-11-12T15:00:00.000Z']);
    const nth = parse(ics(['UID:n', 'DTSTART:20260908T230000Z', 'RRULE:FREQ=MONTHLY;BYDAY=2TU', 'SUMMARY:Club']));
    expect(starts(nth)).toEqual(['2026-11-10T23:00:00.000Z']);
    const yearly = parse(ics(['UID:y', 'DTSTART;VALUE=DATE:20101107', 'RRULE:FREQ=YEARLY', 'SUMMARY:A birthday']));
    expect(yearly.map((e) => e.start)).toEqual([zonedMinute('2026-11-07', 0, TZ)]);
  });

  it('keeps 09:00 at 09:00 across a clock change', () => {
    const from = zonedMinute('2026-10-20', 0, 'Europe/London');
    const got = parse(
      ics(['UID:l', 'DTSTART;TZID=Europe/London:20261001T090000', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Class']),
      'Europe/London',
      from,
      from + 14 * 86_400_000,
    );
    expect(starts(got)).toEqual(['2026-10-22T08:00:00.000Z', '2026-10-29T09:00:00.000Z']);
  });

  it('leaves out EXDATE, moves an occurrence by RECURRENCE-ID and drops a cancelled one', () => {
    const got = parse(
      ics(
        [
          'UID:r',
          'DTSTART;TZID=America/New_York:20261008T100000',
          'DTEND;TZID=America/New_York:20261008T110000',
          'RRULE:FREQ=WEEKLY;BYDAY=TH',
          'EXDATE;TZID=America/New_York:20261112T100000',
          'SUMMARY:Weekly',
        ],
        [
          'UID:r',
          'RECURRENCE-ID;TZID=America/New_York:20261105T100000',
          'DTSTART;TZID=America/New_York:20261105T150000',
          'DTEND;TZID=America/New_York:20261105T160000',
          'SUMMARY:Weekly (moved)',
        ],
        ['UID:s', 'DTSTART:20261102T180000Z', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:Daily'],
        ['UID:s', 'RECURRENCE-ID:20261103T180000Z', 'DTSTART:20261103T180000Z', 'STATUS:CANCELLED', 'SUMMARY:Daily'],
        ['UID:t', 'DTSTART:20261104T180000Z', 'STATUS:CANCELLED', 'SUMMARY:Called off'],
      ),
    );
    expect(got.map((e) => [e.title, new Date(e.start).toISOString()])).toEqual([
      ['Daily', '2026-11-02T18:00:00.000Z'],
      ['Daily', '2026-11-04T18:00:00.000Z'],
      ['Weekly (moved)', '2026-11-05T20:00:00.000Z'],
    ]);
  });

  it('shows a rule it doesn’t support once, at its start', () => {
    const got = parse(
      ics(['UID:x', 'DTSTART:20261103T120000Z', 'RRULE:FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=-1', 'SUMMARY:Last weekday']),
    );
    expect(starts(got)).toEqual(['2026-11-03T12:00:00.000Z']);
    expect(
      parse(ics(['UID:h', 'DTSTART:20261103T120000Z', 'RRULE:FREQ=HOURLY;COUNT=5', 'SUMMARY:Hourly'])),
    ).toHaveLength(1);
  });

  it('a rule that never matches, or started long ago, ends inside its walk', () => {
    expect(
      parse(ics(['UID:f', 'DTSTART;VALUE=DATE:20260228', 'RRULE:FREQ=YEARLY;BYMONTHDAY=30', 'SUMMARY:Never'])),
    ).toEqual([]);
    const old = parse(ics(['UID:o', 'DTSTART:20000101T120000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:Every day']));
    expect(old).toHaveLength(14);
  });
});

describe('the fetch', () => {
  afterEach(() => useFetch((...a) => fetch(...a)));
  const asked: { url: string; redirect?: string }[] = [];
  const serve = (r: () => Response) =>
    useFetch(async (input, init) => {
      asked.push({ url: String(input), redirect: init?.redirect });
      return r();
    });
  const code = (p: Promise<unknown>) =>
    p.then(
      () => 'ok',
      (e) => (e instanceof CalendarError ? e.code : String(e)),
    );
  const URL_ = 'https://calendar.example.com/feeds/abc/basic.ics';

  it('takes a calendar and never follows a redirect', async () => {
    asked.length = 0;
    serve(
      () =>
        new Response(ics(['UID:a', 'DTSTART:20261103T170000Z']), {
          headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
        }),
    );
    expect(await fetchIcs(URL_)).toMatch(/^BEGIN:VCALENDAR/);
    expect(asked).toEqual([{ url: URL_, redirect: 'manual' }]);
    asked.length = 0;
    serve(() => new Response(null, { status: 302, headers: { Location: 'https://elsewhere.example.net/x.ics' } }));
    expect(await code(fetchIcs(URL_))).toBe('redirect');
    expect(asked.map((a) => a.url)).toEqual([URL_]);
  });

  it('refuses over 1 MB (said or streamed), what is not a calendar, an error status and a link it would not keep', async () => {
    const big = `BEGIN:VCALENDAR\r\n${'X'.repeat(1_048_576)}`;
    serve(() => new Response(big, { headers: { 'Content-Type': 'text/calendar' } }));
    expect(await code(fetchIcs(URL_))).toBe('too_large');
    serve(() => new Response(new Blob([big]).stream(), { headers: { 'Content-Type': 'text/plain' } }));
    expect(await code(fetchIcs(URL_))).toBe('too_large');
    serve(
      () =>
        new Response('BEGIN:VCALENDAR', { headers: { 'Content-Type': 'text/calendar', 'Content-Length': '2000000' } }),
    );
    expect(await code(fetchIcs(URL_))).toBe('too_large');
    serve(() => Response.json({ not: 'a calendar' }));
    expect(await code(fetchIcs(URL_))).toBe('not_calendar');
    serve(() => new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/plain' } }));
    expect(await code(fetchIcs(URL_))).toBe('not_calendar');
    serve(() => new Response('gone', { status: 404 }));
    expect(await code(fetchIcs(URL_))).toBe('http_404');
    useFetch(async () => {
      throw new TypeError('network');
    });
    expect(await code(fetchIcs(URL_))).toBe('unreachable');
    asked.length = 0;
    serve(() => new Response('BEGIN:VCALENDAR', { headers: { 'Content-Type': 'text/calendar' } }));
    for (const bad of ['http://calendar.example.com/a.ics', 'https://10.0.0.5/a.ics', 'https://intranet.local/a.ics'])
      expect(await code(fetchIcs(bad)), bad).toBe('bad_link');
    expect(asked).toEqual([]);
  });
});
