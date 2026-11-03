// The owner's calendars through the Worker (BRIEFING.md "Today"), the calendar hosts answered by
// the test with invented calendars: a link never tried is fetched before the Briefing answers; the
// page's Today tile lists what is still on today (all-day ones too) and tomorrow's first, the day's
// line counts it, the brief's section 1 says it with a shared link's titles marked (outside), and
// `GET /v1/briefing/calendar` lists the events with each link by its host only. A link is asked
// again only after 30 minutes; a redirect is refused and never followed; a failing link keeps its
// events 48 hours and then the tile says since when; a removed link's rows go; the day roll asks
// every link. The owner's zone here is UTC.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BriefingResponse, CalendarResponse, CalendarTile } from '../../../shared/contract/briefing.ts';
import { useFetch } from '../../src/areas/briefing/calendar';
import { runCron } from '../../src/areas/ops/cron';
import { apiJson, coreSql, makeAgent } from '../helpers';
import { brief, CHAT_SESSION, principals } from '../memory-helpers';

const H = 3_600_000;
const DAY = 24 * H;
// Invented links; the path stands for the secret part of a real one.
const A = 'https://calendar.example.com/ical/secret-a/basic.ics';
const B = 'https://shared.example.org/team/secret-b.ics';
const R = 'https://moved.example.net/old/secret-r.ics';

let D = '';
let C = '';
let R_ = '';
const asked: string[] = [];
const answers = new Map<string, () => Response>();

const day = (at: number) => new Date(at).toISOString().slice(0, 10);
const ymd = (at: number) => day(at).replaceAll('-', '');
const cal = (...events: string[][]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']),
    'END:VCALENDAR',
  ].join('\r\n');
const ok = (text: string) => () => new Response(text, { headers: { 'Content-Type': 'text/calendar' } });

const page = async () => (await apiJson<BriefingResponse>('GET', '/v1/briefing', { token: D })).body;
const todayTile = async () => (await page()).tiles.find((t): t is CalendarTile => t.kind === 'calendar');
const links = (...l: { url: string; mine: boolean }[]) =>
  apiJson('PATCH', '/v1/settings', { token: D, body: { 'briefing.calendars': l } });
/** Waits until `check` holds: the work after the page answered runs on its own. */
async function until(check: () => Promise<boolean> | boolean) {
  for (let i = 0; i < 200 && !(await check()); i++) await new Promise((r) => setTimeout(r, 25));
  expect(await check()).toBe(true);
}
/** A link's id in the rows: the first 16 hex characters of its address's SHA-256. */
const feedOf = async (url: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
/** As if the link's last try were 31 minutes ago: the next open asks it again. */
const stale = async (url: string) =>
  coreSql('UPDATE calendar_feeds SET checked_at = checked_at - ? WHERE feed = ?', 31 * 60_000, await feedOf(url));
const feedRow = async (url: string) =>
  (
    await coreSql<{ error: string | null; ok_at: number | null; failing_since: number | null; checked_at: number }>(
      'SELECT error, ok_at, failing_since, checked_at FROM calendar_feeds WHERE feed = ?',
      await feedOf(url),
    )
  )[0];

const now = Date.now();
const tomorrow = Date.parse(`${day(now + DAY)}T00:00:00Z`);
const A_ICS = cal(
  ['UID:bins', `DTSTART;VALUE=DATE:${ymd(now)}`, 'SUMMARY:Bins out'],
  [
    'UID:standup',
    `DTSTART:${ymd(tomorrow)}T120000Z`,
    `DTEND:${ymd(tomorrow)}T130000Z`,
    'SUMMARY:Standup',
    'LOCATION:Room 4',
  ],
  ['UID:far', `DTSTART:${ymd(now + 20 * DAY)}T120000Z`, 'SUMMARY:Too far'],
);
const B_ICS = cal([
  'UID:lunch',
  `DTSTART:${ymd(tomorrow)}T090000Z`,
  `DTEND:${ymd(tomorrow)}T100000Z`,
  'SUMMARY:Team lunch',
]);

beforeAll(async () => {
  ({ D, C } = await principals());
  R_ = await makeAgent(D, 'mind:reflex');
  answers.set(A, ok(A_ICS));
  answers.set(B, ok(B_ICS));
  answers.set(
    R,
    () => new Response(null, { status: 301, headers: { Location: 'https://elsewhere.example.net/x.ics' } }),
  );
  useFetch(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    asked.push(new URL(url).host);
    return answers.get(url)?.() ?? new Response('no', { status: 404 });
  });
});

describe('the owner’s calendars', () => {
  it('fetches a new link before the page answers: Today, the day’s line, the brief and the read route', async () => {
    expect((await page()).tiles.some((t) => t.kind === 'calendar')).toBe(false);
    expect((await links({ url: A, mine: true }, { url: B, mine: false })).status).toBe(200);
    asked.length = 0;
    const p = await page();
    expect(asked.sort()).toEqual(['calendar.example.com', 'shared.example.org']);
    const t = p.tiles.find((x): x is CalendarTile => x.kind === 'calendar');
    expect(t).toMatchObject({
      kind: 'calendar',
      label: 'Today',
      value: 'All day: Bins out',
      detail: '1 thing on today',
      notice: null,
    });
    expect(t?.today.map((e) => [e.title, e.all_day, e.time, e.source])).toEqual([['Bins out', true, null, 'owner']]);
    expect(t?.tomorrow).toMatchObject({ title: 'Team lunch', time: '09:00', source: 'outside', location: null });
    expect(p.tiles.map((x) => x.kind).indexOf('calendar')).toBe(p.tiles.some((x) => x.kind === 'waiting') ? 1 : 0);
    expect(p.today?.line).toMatch(/^1 thing on today[,.]/);
    // The brief's today state: the titles as data, a shared link's marked.
    const core = (await brief(C, CHAT_SESSION, 'chat')).body.core;
    const now1 = core.slice(0, core.indexOf('## 2.'));
    expect(now1).toContain('calendar today: all day "Bins out"');
    expect(now1).toContain('calendar tomorrow: 09:00–10:00 "Team lunch" (outside)');
    // The mind's read: the events, each link by its host, never its address.
    const r = await apiJson<CalendarResponse>('GET', '/v1/briefing/calendar?days=7', { token: C });
    expect(r.status).toBe(200);
    expect(r.body.items.map((e) => [e.title, e.source, e.location])).toEqual([
      ['Bins out', 'owner', null],
      ['Team lunch', 'outside', null],
      ['Standup', 'owner', 'Room 4'],
    ]);
    expect(r.body.feeds.map((f) => [f.host, f.source, f.error])).toEqual([
      ['calendar.example.com', 'owner', null],
      ['shared.example.org', 'outside', null],
    ]);
    expect(JSON.stringify(r.body)).not.toContain('secret');
    const one = await apiJson<CalendarResponse>('GET', '/v1/briefing/calendar?days=1', { token: D });
    expect(one.body.items.map((e) => e.title)).toEqual(['Bins out']);
    expect((await apiJson('GET', '/v1/briefing/calendar?days=15', { token: C })).status).toBe(422);
    expect((await apiJson('GET', '/v1/briefing/calendar', { token: R_ })).status).toBe(403);
  });

  it('asks a link again only after 30 minutes, and then without making the page wait', async () => {
    asked.length = 0;
    await page();
    expect(asked).toEqual([]);
    await stale(A);
    const before = (await feedRow(A)).checked_at;
    await page();
    await until(async () => (await feedRow(A)).checked_at > before);
    expect(asked).toEqual(['calendar.example.com']);
  });

  it('refuses a link that redirects, never asking where it points, and says so on the tile', async () => {
    await links({ url: A, mine: true }, { url: B, mine: false }, { url: R, mine: true });
    asked.length = 0;
    const t = await todayTile();
    expect(asked).toEqual(['moved.example.net']);
    expect(await feedRow(R)).toMatchObject({ error: 'redirect', ok_at: null });
    expect(t?.notice).toBe('A calendar link redirects elsewhere.');
    // Removed, its line goes at once and its rows at the next fetch.
    await links({ url: A, mine: true }, { url: B, mine: false });
    expect((await todayTile())?.notice).toBeNull();
    await stale(B);
    await page();
    await until(async () => (await feedRow(R)) === undefined);
  });

  it('keeps a failing link’s events 48 hours, then says since when', async () => {
    answers.set(A, () => new Response('down', { status: 503 }));
    await stale(A);
    await page();
    await until(async () => (await feedRow(A)).error === 'http_503');
    const row = await feedRow(A);
    expect(row.ok_at).not.toBeNull();
    expect(row.failing_since).not.toBeNull();
    let t = await todayTile();
    expect([t?.today.map((e) => e.title), t?.notice]).toEqual([['Bins out'], null]);
    // 49 hours after its last good fetch: its events are left out and the tile says since when.
    await coreSql('UPDATE calendar_feeds SET ok_at = ok_at - ? WHERE feed = ?', 49 * H, await feedOf(A));
    t = await todayTile();
    const since = new Date(row.failing_since as number).toISOString().slice(11, 16);
    expect(t?.today).toEqual([]);
    expect(t?.tomorrow?.title).toBe('Team lunch');
    expect(t?.notice).toBe(`Calendar not reachable since ${since}`);
    expect(t?.detail).toBe('Nothing else today');
    const core = (await brief(C, CHAT_SESSION, 'chat')).body.core;
    expect(core).toContain(`calendar: Calendar not reachable since ${since}`);
    // Working again: back on the next fetch.
    answers.set(A, ok(A_ICS));
    await stale(A);
    await page();
    await until(async () => (await feedRow(A)).error === null);
    expect((await todayTile())?.notice).toBeNull();
  });

  it('the day roll asks every link, fresh or not', async () => {
    await coreSql(
      `INSERT INTO settings (key, value_json, updated_at, actor) VALUES ('day.current', ?, 0, 'worker')
       ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
      JSON.stringify(day(now - 5 * DAY)),
    );
    await coreSql('UPDATE messages SET created_at = created_at - 7200000');
    asked.length = 0;
    await runCron(env);
    expect(asked.sort()).toEqual(['calendar.example.com', 'shared.example.org']);
  });
});
