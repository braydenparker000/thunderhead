// Time travel with the Worker's own clock (vitest's fake Date): the Briefing's day at the year's turn in the
// owner's zone and in UTC, a session 90 and 91 days after its last use, and sync's newer-wins across the
// year. The pure date helpers are in tests/unit/time-travel.test.ts.
import { runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BriefingResponse } from '../../../shared/contract/briefing.ts';
import { progressOf, putProgress } from '../../src/areas/podcasts/store';
import { DAY, HOUR, MINUTE, zonedMinute } from '../../src/lib/time';
import type { Db } from '../../src/objects/base';
import { api, apiJson, core, loginOk, setupOwner } from '../helpers';

const BA = 'America/Argentina/Buenos_Aires';
let D = '';

beforeAll(async () => {
  D = (await setupOwner()).token;
});

afterEach(async () => {
  vi.useRealTimers();
});

const page = (token = D) => apiJson<BriefingResponse>('GET', '/v1/briefing', { token });

describe('the Briefing’s day', () => {
  // The phone paints an answer whose `day` is not its own calendar day as one kept from before ("From
  // yesterday", th/briefing/age.js) and leaves out its weather, Due, Today and Holidays. Between midnight and
  // 04:00 the conversation's day is still yesterday's, but the page is about the calendar's.
  it.each([BA, 'UTC'])('%s: at 00:01 on 1 January the page is 2027’s, as the phone’s date is', async (tz) => {
    expect((await api('PATCH', '/v1/settings', { token: D, body: { 'owner.tz': tz } })).status).toBe(200);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(zonedMinute('2026-12-31', 23 * 60 + 59, tz));
    const before = (await page()).body;
    expect(before.day).toBe('2026-12-31');
    expect(before.today?.date).toBe('Thursday 31 December');
    vi.setSystemTime(zonedMinute('2027-01-01', 1, tz));
    const after = (await page()).body;
    expect(after.today?.date).toBe('Friday 1 January');
    expect(after.day).toBe('2027-01-01');
    vi.setSystemTime(zonedMinute('2027-01-01', 4 * 60 + 1, tz));
    expect((await page()).body.day).toBe('2027-01-01');
  });
});

describe('a session 90 and 91 days after its last use', () => {
  it('still signs in at 90 days less an hour; at 91 days it has expired and says so', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    const g = await loginOk('192.0.2.71');
    expect((await page(g.token)).status).toBe(200);
    // Each use renews it, at most once an hour.
    vi.setSystemTime(start + 90 * DAY - HOUR - MINUTE);
    expect((await page(g.token)).status).toBe(200);
    const used = Date.now();
    vi.setSystemTime(used + 90 * DAY - 2 * HOUR);
    expect((await page(g.token)).status).toBe(200);
    vi.setSystemTime(Date.now() + 91 * DAY);
    const r = await apiJson<{ error: { code: string } }>('GET', '/v1/briefing', { token: g.token });
    expect([r.status, r.body.error.code]).toEqual([401, 'session_expired']);
  });
});

describe('sync’s newer wins across the year’s turn', () => {
  it('a position saved at 00:01 on 1 January replaces one from 23:59 on the 31st; an older one never does', async () => {
    const late = zonedMinute('2026-12-31', 23 * 60 + 59, BA);
    const early = zonedMinute('2027-01-01', 1, BA);
    const key = 'https://feeds.example.test/show.xml#ep-1';
    const got = await runInDurableObject(core(), (o) => {
      const db = (o as unknown as { db: Db }).db;
      const put = (position_s: number, updated_at: number) =>
        putProgress(db, { key, position_s, duration_s: 3600, played: false, updated_at }, updated_at);
      return [put(600, late), put(900, early), put(300, late), put(301, early)];
    });
    expect(got).toEqual([true, true, false, false]);
    const row = await runInDurableObject(core(), (o) => progressOf((o as unknown as { db: Db }).db, key));
    expect(row).toMatchObject({ position_s: 900, updated_at: zonedMinute('2027-01-01', 1, BA) });
  });
});
