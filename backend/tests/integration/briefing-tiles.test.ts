// P8: the night shift's Briefing tiles (BRIEFING.md §2, §4; surface kind `tile` in app
// `briefing`): the Worker holds them to the content limits and to a link inside one app; the page
// gets them after "Waiting on you" in slot order (practice, study, built, notes), with where a
// tap opens them; one without an expiry goes after a day. And the tiles the Worker fills itself
// with no mind session (2026-11-02): "Due" (the owner's reminders today and tomorrow, counts and
// the next time on the tile, the list for its sheet), "Holidays" (the next one within 14 days in
// `owner.country`; none without a country or a list), the day's line from counts only, and the
// night line when the connected night shift didn't arrange the page. The owner's zone here is UTC.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BriefingResponse, DueTile, HolidayTile, NightTile } from '../../../shared/contract/briefing.ts';
import type { ReminderResponse } from '../../../shared/contract/reminders.ts';
import { HOLIDAY_COUNTRIES, nextHoliday } from '../../src/areas/briefing/holidays';
import { logicalDay } from '../../src/areas/conversation/day';
import { nightDayOf } from '../../src/areas/mind/night';
import { uuidv7 } from '../../src/lib/ids';
import type { Core } from '../../src/objects/core';
import type { Music } from '../../src/objects/music';
import { apiJson, core, coreSql, makeAgent, setupOwner } from '../helpers';
import { music } from '../music-helpers';

let D = '';
let C = '';
const tile = (payload: object, more: object = {}) => ({
  kind: 'tile',
  schema: 1,
  payload,
  why: 'From the reading plan you agreed.',
  topic_key: 'study.today',
  ...more,
});
const put = (slot: string, body: object) => apiJson('PUT', `/v1/surfaces/briefing/${slot}`, { token: C, body });
const night = async () =>
  (await apiJson<BriefingResponse>('GET', '/v1/briefing', { token: D })).body.tiles.filter(
    (t): t is NightTile => t.kind === 'night',
  );

beforeAll(async () => {
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
});

describe('the night shift’s Briefing tiles', () => {
  it('are held to the limits and a link inside one app', async () => {
    const study = {
      label: 'Study',
      value: 'Book A, chapter 3',
      detail: 'p. 212 · 20 min',
      app: 'study',
      path: '/study/?book=b1&p=212',
    };
    expect((await put('study', tile(study))).status).toBe(200);
    for (const bad of [
      { ...study, label: 'x'.repeat(25) },
      { ...study, value: 'Read now!' },
      { ...study, path: '/music/' },
      { ...study, path: '/study/../signin/' },
      { ...study, app: 'nowhere' },
      { label: 'Study', value: 'Book A', path: '/study/' },
    ])
      expect((await put('study', tile(bad))).status, JSON.stringify(bad)).toBe(422);
    expect((await put('weather', tile(study))).status).toBe(422);
  });

  it('come in slot order with where a tap opens them; one without an expiry goes after a day', async () => {
    expect(
      (
        await put(
          'built',
          tile(
            {
              label: 'Built overnight',
              value: 'A calm playlist',
              detail: '31 songs, ready in Music',
              app: 'music',
              path: '/music/#pl=calm123456',
            },
            { topic_key: 'built.night' },
          ),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await put(
          'note.1',
          tile(
            { label: 'Note', value: 'Bring the umbrella', wide: true },
            { topic_key: 'note.rain', expires_at: Date.now() + 3_600_000 },
          ),
        )
      ).status,
    ).toBe(200);
    const tiles = await night();
    expect(tiles.map((t) => [t.slot, t.label, t.app, t.path, t.wide])).toEqual([
      ['study', 'Study', 'study', '/study/?book=b1&p=212', false],
      ['built', 'Built overnight', 'music', '/music/#pl=calm123456', false],
      ['note.1', 'Note', null, null, true],
    ]);
    await coreSql(
      `UPDATE surfaces SET written_at = ? WHERE app = 'briefing' AND slot = 'study'`,
      Date.now() - 25 * 3_600_000,
    );
    expect((await night()).map((t) => t.slot)).toEqual(['built', 'note.1']);
  });
});

const H = 3_600_000;
const DAY = 24 * H;
const page = async () => (await apiJson<BriefingResponse>('GET', '/v1/briefing', { token: D })).body;
const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);
const hhmm = (at: number) => new Date(at).toISOString().slice(11, 16);
/** The page as Core makes it, with the night shift connected or not. */
const inCore = (connected: boolean) =>
  runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => {
    const self = o as unknown as { env: Env };
    const before = self.env;
    if (connected)
      self.env = { ...before, ROUTINE_NIGHT_URL: 'https://api.example.test/night', ROUTINE_NIGHT_TOKEN: 'tok' };
    try {
      return o.briefingNow();
    } finally {
      self.env = before;
    }
  });

describe('the tiles the Worker fills itself', () => {
  it('Due: today’s and tomorrow’s reminders, counts and the next time on the tile, the list for its sheet', async () => {
    expect((await page()).tiles.some((t) => t.kind === 'due')).toBe(false);
    const now = Date.now();
    const tomorrow = Date.parse(`${utcDay(now + DAY)}T00:00:00Z`);
    const set = async (text: string, at: number) =>
      (await apiJson<ReminderResponse>('PUT', `/v1/reminders/${uuidv7()}`, { token: D, body: { text, at } })).body
        .reminder;
    // Soon (inside quiet hours it moves to their end, maybe tomorrow), tomorrow at noon, and the
    // day after (not on the tile). Made-up words.
    const made = [await set('Call the plumber', now + 2 * 60_000), await set('Water the plants', tomorrow + 12 * H)];
    await set('Return the library book', tomorrow + 36 * H);
    const sorted = made.toSorted((a, b) => a.fire_at - b.fire_at);
    const today = made.filter((r) => r.fire_at < tomorrow).length;
    const due = (await page()).tiles.find((t): t is DueTile => t.kind === 'due');
    expect(due).toEqual({
      kind: 'due',
      label: 'Due',
      value: [today && `${today} today`, `${2 - today} tomorrow`].filter(Boolean).join(' · '),
      detail: today ? `Next at ${hhmm(sorted[0].fire_at)}` : `Next tomorrow at ${hhmm(sorted[0].fire_at)}`,
      today,
      tomorrow: 2 - today,
      items: sorted.map((r) => ({ id: r.id, text: r.text, at: r.fire_at })),
    });
    expect(due?.value.length).toBeLessThanOrEqual(32);
    // It comes after "Waiting on you" and before the night's tiles.
    const kinds = (await page()).tiles.map((t) => t.kind);
    expect(kinds.indexOf('due')).toBeLessThan(kinds.indexOf('night'));
  });

  it('Holidays: the next one within 14 days in the owner’s country; none without a country or a list', async () => {
    expect((await page()).tiles.some((t) => t.kind === 'holiday')).toBe(false);
    await coreSql(
      `INSERT INTO settings (key, value_json, updated_at, actor) VALUES ('owner.country', '"XX"', ?, 'test')`,
      Date.now(),
    );
    expect((await page()).tiles.some((t) => t.kind === 'holiday')).toBe(false);
    // A country with a holiday within 14 days of today, if any (the list covers 2026 and 2027).
    const date = utcDay(Date.now());
    const country = HOLIDAY_COUNTRIES.find((c) => nextHoliday(c, date)) ?? 'US';
    await coreSql(`UPDATE settings SET value_json = ? WHERE key = 'owner.country'`, JSON.stringify(country));
    const h = nextHoliday(country, date);
    const tile = (await page()).tiles.find((t): t is HolidayTile => t.kind === 'holiday');
    if (!h) return expect(tile).toBeUndefined();
    expect(tile).toMatchObject({ kind: 'holiday', label: 'Holidays', value: h.name, date: h.date, in_days: h.in_days });
    expect(tile?.detail).toMatch(h.in_days === 0 ? /^Today$/ : h.in_days === 1 ? / · tomorrow$/ : / · in \d+ days$/);
    expect(tile?.detail.length).toBeLessThanOrEqual(60);
    expect((await page()).tiles.at(-1)?.kind).toBe('holiday');
  });

  it('the day’s line: the date and counts only (reminders due today, new episodes, songs added)', async () => {
    const before = (await page()).today;
    expect(before?.date).toMatch(/^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+$/);
    // The night checked two shows (3 and 2 new) in the last 20 hours and one a day ago (not
    // counted); two songs came in the last day, one a week ago.
    const now = Date.now();
    for (const [i, n, at] of [
      [1, 3, now - H],
      [2, 2, now - 2 * H],
      [3, 9, now - 30 * H],
    ])
      await coreSql(
        `INSERT INTO podcast_follows (feed_url, title, author, artwork, followed, updated_at, synced_at, checked_at, new_n, show_id)
         VALUES (?, 'A show', 'Someone', '', 1, ?, ?, ?, ?, ?)`,
        `https://feeds.example.test/${i}`,
        now,
        now,
        at,
        n,
        `show${i}`,
      );
    await runInDurableObject(music(), (_o: Music, st) => {
      for (const at of [now - 7 * DAY, now - H, now - 10 * 60_000])
        st.storage.sql.exec(
          `INSERT INTO catalog_log (at, op, track_id, before_json) VALUES (?, 'register', 't', NULL)`,
          at,
        );
      st.storage.sql.exec(
        `INSERT INTO catalog_log (at, op, track_id, before_json) VALUES (?, 'analysis', 't', NULL)`,
        now,
      );
    });
    const due = (await page()).tiles.find((t): t is DueTile => t.kind === 'due');
    const line = due?.today
      ? `${due.today} reminder${due.today === 1 ? '' : 's'} due today, 5 new episodes and 2 songs added.`
      : '5 new episodes and 2 songs added.';
    expect((await page()).today).toEqual({ date: before?.date, line });
  });

  it('the night line: only while the night is connected, when it didn’t arrange the page', async () => {
    const now = Date.now();
    const night = nightDayOf(logicalDay(now, 'UTC'));
    expect((await page()).night).toBeNull();
    // No run yet: said from 07:00 (after the 06:07 fallback), quiet before.
    expect((await inCore(true)).night).toBe(
      new Date(now).getUTCHours() >= 7 ? "The night shift hasn't run yet." : null,
    );
    // The hard stop cut step 7: the run is done, the page wasn't arranged.
    const steps = { 1: { at: now, done: true }, 7: { at: now, skipped: 'hard_stop' }, 10: { at: now, done: true } };
    await coreSql(
      'INSERT INTO night_runs (day, started_at, step, steps_json, done_at, session_id) VALUES (?, ?, 10, ?, ?, NULL)',
      night,
      now - H,
      JSON.stringify(steps),
      now,
    );
    expect((await inCore(true)).night).toBe('The night shift ran out of time before arranging this page.');
    expect((await inCore(false)).night).toBeNull();
    await coreSql(
      'UPDATE night_runs SET steps_json = ? WHERE day = ?',
      JSON.stringify({ ...steps, 7: { at: now, done: true } }),
      night,
    );
    expect((await inCore(true)).night).toBeNull();
  });
});
