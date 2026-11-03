// The Briefing page's call of the cost suite (cost.test.ts checks every budget; BRIEFING.md §2):
// GET /v1/briefing with the tiles the Worker fills itself (2026-11-02). In Core: the waiting
// cards, the reminders due today and tomorrow (12 set, 4 of them due; the partial index reads the
// due ones and stops), the night's surfaces, the follows the night checked (after podcast-calls.ts),
// the settings it reads (place, forecast, country, zone) and the night's run. In Music: the songs
// added in the last day, walked back from the newest log row (40 that day, 300 older ones never
// read). No place is set, so Open-Meteo isn't asked. Then the owner's calendars (2026-11-02): two
// links fetched 10 minutes ago with 40 events over 14 days (the page reads the setting, the links'
// rows and today's and tomorrow's events), the mind's read of 7 days, and a third link never tried,
// fetched before the page answers with 30 events (each written with its index entry).
import { runInDurableObject } from 'cloudflare:test';
import type { SignedIn } from '../../../shared/contract/api';
import { useFetch } from '../../src/areas/briefing/calendar';
import { feedId } from '../../src/areas/briefing/calendar-store';
import { uuidv7 } from '../../src/lib/ids';
import type { Music } from '../../src/objects/music';
import { api, core, coreSql, PASSWORD } from '../helpers';
import { music } from '../music-helpers';

type Cost = (
  name: string,
  fn: () => Promise<Response>,
  status: number,
  stub?: ReturnType<typeof core>,
) => Promise<void>;

const H = 3_600_000;

export async function briefingCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const d = await grant('192.0.2.254', `${PASSWORD} new`);
  await api('GET', '/v1/auth/me', d);
  const now = Date.now();
  // Made-up reminders: 4 due within the next 30 hours, 8 later.
  for (let i = 0; i < 12; i++)
    await api('PUT', `/v1/reminders/${uuidv7()}`, {
      ...d,
      body: { text: `Reminder ${i}`, at: now + (i < 4 ? (i + 1) * 6 * H : (3 + i) * 24 * H) },
    });
  await coreSql(
    `INSERT INTO settings (key, value_json, updated_at, actor) VALUES ('owner.country', '"GB"', ?, 'cost')
     ON CONFLICT (key) DO NOTHING`,
    now,
  );
  await runInDurableObject(music(), (_o: Music, st) => {
    for (let i = 0; i < 300; i++)
      st.storage.sql.exec(
        `INSERT INTO catalog_log (at, op, track_id, before_json) VALUES (?, 'register', 'cost', NULL)`,
        now - 3 * 24 * H + i,
      );
    for (let i = 0; i < 40; i++)
      st.storage.sql.exec(
        `INSERT INTO catalog_log (at, op, track_id, before_json) VALUES (?, 'register', 'cost', NULL)`,
        now - 12 * H + i * 60_000,
      );
  });
  await cost('GET /v1/briefing (Core)', () => api('GET', '/v1/briefing', d), 200, core());
  await cost(
    'GET /v1/briefing (Music: 40 songs added today)',
    () => api('GET', '/v1/briefing', d),
    200,
    music() as unknown as ReturnType<typeof core>,
  );

  // The calendar: invented links and events.
  const links = ['a', 'b', 'c'].map((x, i) => ({ url: `https://calendar.example.com/${x}.ics`, mine: i !== 1 }));
  await coreSql(
    `INSERT INTO settings (key, value_json, updated_at, actor) VALUES ('briefing.calendars', ?, ?, 'cost')`,
    JSON.stringify(links.slice(0, 2)),
    now,
  );
  for (const [f, l] of links.slice(0, 2).entries()) {
    await coreSql(
      `INSERT INTO calendar_feeds (feed, checked_at, ok_at, failing_since, error, hash, n) VALUES (?, ?, ?, NULL, NULL, 'h', 20)`,
      feedId(l.url),
      now - 10 * 60_000,
      now - 10 * 60_000,
    );
    for (let i = 0; i < 20; i++)
      await coreSql(
        `INSERT INTO calendar_events (feed, uid, start, end, all_day, title, location, source) VALUES (?, ?, ?, ?, 0, 'An event', NULL, 'owner')`,
        feedId(l.url),
        `e${i}`,
        now + (i * 17 + f * 5) * H,
        now + (i * 17 + f * 5 + 1) * H,
      );
  }
  await cost('GET /v1/briefing (Core, 2 calendar links, 40 events)', () => api('GET', '/v1/briefing', d), 200, core());
  await cost(
    'GET /v1/briefing/calendar?days=7 (Core, 40 events)',
    () => api('GET', '/v1/briefing/calendar?days=7', d),
    200,
    core(),
  );
  const day = (at: number) => new Date(at).toISOString().slice(0, 10).replaceAll('-', '');
  const ics = [
    'BEGIN:VCALENDAR',
    ...Array.from({ length: 30 }, (_, i) => [
      'BEGIN:VEVENT',
      `UID:new${i}`,
      `DTSTART:${day(now + (i % 13) * 24 * H)}T${String(8 + (i % 10)).padStart(2, '0')}0000Z`,
      'SUMMARY:A new event',
      'END:VEVENT',
    ]).flat(),
    'END:VCALENDAR',
  ].join('\r\n');
  useFetch(async () => new Response(ics, { headers: { 'Content-Type': 'text/calendar' } }));
  await coreSql(`UPDATE settings SET value_json = ? WHERE key = 'briefing.calendars'`, JSON.stringify(links));
  await cost(
    'GET /v1/briefing (Core, a new calendar link fetched: 30 events)',
    () => api('GET', '/v1/briefing', d),
    200,
    core(),
  );
  useFetch((...a) => fetch(...a));
  // Gone again, so the briefs measured after this (settings-calls.ts) read no calendar.
  await coreSql(`DELETE FROM settings WHERE key = 'briefing.calendars'`);
  await coreSql('DELETE FROM calendar_events');
  await coreSql('DELETE FROM calendar_feeds');
}
