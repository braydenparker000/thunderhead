// The rows-read guard, what it says (DATA.md §8.1, OPERATIONS.md §8): from 60% of the day's budget
// (the Free plan's limits less the old Worker's share) the quota watchdogs trip once and clear the
// next UTC day, the Briefing page and the mind's briefing each carry one line; from 80% the owner
// gets one push that day, its words fetched as every push's are. The meter's rows are synthetic
// fixtures in Core's meter_days, as Core's tick would have gathered them.
import { env } from 'cloudflare:workers';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BriefResponse } from '../../../shared/contract/api';
import type { BriefingResponse } from '../../../shared/contract/briefing.ts';
import { budgetAt, DAY_BUDGET } from '../../../shared/contract/meter.ts';
import type { WatchdogsResponse } from '../../../shared/contract/watchdogs.ts';
import { nextUtcDay } from '../../src/areas/meter/quota';
import { useFetch } from '../../src/areas/push/outbox';
import { deliver } from '../../src/areas/push/routes';
import { DAY, MINUTE, utcDay } from '../../src/lib/time';
import { api, apiJson, coreSql } from '../helpers';
import { as, CHAT_SESSION, SHA } from '../memory-helpers';
import { phone, received } from '../push-helpers';
import { CLEAR, notes, resetWatchdogs, setupWatchdogs, T0, watch } from '../watchdog-helpers';

let D = '';
let C = '';
/** Puts one class's rows for a day in Core's meter_days, replacing what was there. */
const seed = (day: string, cls: string, read: number, written: number) =>
  coreSql(
    'INSERT OR REPLACE INTO meter_days (day, class, rows_read, rows_written, updated_at) VALUES (?, ?, ?, ?, 0)',
    day,
    cls,
    read,
    written,
  );
const READ_60 = budgetAt(60, 'rows_read');
const READ_80 = budgetAt(80, 'rows_read');

beforeAll(async () => {
  const p = await setupWatchdogs();
  D = p.D;
  C = p.C;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the quota watchdogs', () => {
  it('quota.rows_read trips at 60% of the day’s budget, holds, notes 80%, and clears the next day', async () => {
    await resetWatchdogs();
    const day = utcDay(T0);
    expect(READ_60).toBe(2_880_000);
    await seed(day, 'music', READ_60 - 1_000, 100);
    await watch(T0);
    await seed(day, 'music', READ_60 + 20_000, 100);
    await watch(T0 + 15 * MINUTE);
    await watch(T0 + 30 * MINUTE);
    await seed(day, 'music', READ_80 + 1, 100);
    await watch(T0 + 45 * MINUTE);
    const items = (await apiJson<WatchdogsResponse>('GET', '/v1/ops/watchdogs', { token: D })).body.items;
    expect(items.find((i) => i.name === 'quota.rows_read')).toMatchObject({
      state: 'tripped',
      detail: "rows read today passed 80% of the day's budget of 4,800,000; the heavy work waits for 00:00 UTC",
    });
    await watch(nextUtcDay(T0) + 15 * MINUTE);
    expect(await notes('quota.rows_read')).toEqual([
      "watchdog quota.rows_read tripped: rows read today passed 60% of the day's budget of 4,800,000",
      CLEAR('quota.rows_read'),
    ]);
  });

  it('quota.rows_written trips at 60% of what the old Worker leaves (40,800 of 68,000)', async () => {
    await resetWatchdogs();
    const day = utcDay(T0 + DAY);
    expect(DAY_BUDGET.rows_written).toBe(68_000);
    await seed(day, 'core', 10_000, 30_000);
    await seed(day, 'scratch', 0, 10_000);
    await watch(T0 + DAY);
    await seed(day, 'scratch', 0, 10_800);
    await watch(T0 + DAY + 15 * MINUTE);
    expect(await notes('quota.rows_written')).toEqual([
      "watchdog quota.rows_written tripped: rows written today passed 60% of the day's budget of 68,000",
    ]);
    expect(await notes('quota.rows_read')).toEqual([]);
  });
});

describe('the lines from 60%', () => {
  const today = () => utcDay(Date.now());
  const page = async () => (await apiJson<BriefingResponse>('GET', '/v1/briefing', { token: D })).body.quota;
  const now = async () => {
    const b = await apiJson<BriefResponse>('POST', '/v1/mind/brief', {
      ...as(C, CHAT_SESSION),
      body: { claim: false, session_id: CHAT_SESSION, role: 'chat', constitution_sha256: SHA, th_version: '0.1.0' },
    });
    return b.body.core.slice(0, b.body.core.indexOf('## 2.'));
  };

  it('none below 60%; one plain line at 60%; from 80% when backups and uploads run again', async () => {
    await seed(today(), 'music', READ_60 - 50_000, 0);
    expect(await page()).toBeNull();
    expect(await now()).not.toMatch(/quota:/);
    await seed(today(), 'music', READ_60 + 10_000, 0);
    expect(await page()).toBe("Today's database use is at 60% of the free plan's daily limit.");
    expect(await now()).toMatch(/^quota: 60% of today's budget \(read 2,8\d\d,\d{3} of 4,800,000; written /m);
    await seed(today(), 'music', READ_80 + 50_000, 0);
    // The owner's zone in these tests is UTC: 00:00 UTC is 00:00 on their clock.
    expect(await page()).toBe(
      "Today's database use is at 81% of the free plan's daily limit. Backups and uploads wait until 00:00.",
    );
    expect(await now()).toMatch(/· heavy jobs wait for 00:00 UTC$/m);
    await seed(today(), 'music', 0, 0);
  });
});

describe('the push from 80%', () => {
  const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/test-quota-phone';
  let got: Uint8Array[] = [];
  afterAll(() => useFetch((...a) => fetch(...a)));

  it('goes once a UTC day, outside the nudge budget, its words fetched with the session', async () => {
    useFetch(async (_input, init) => {
      got.push(new Uint8Array(await new Response(init?.body).arrayBuffer()));
      return new Response(null, { status: 201 });
    });
    const mine = await phone();
    await apiJson('PATCH', '/v1/settings', { token: D, body: { 'quiet.start': '06:30', 'quiet.end': '06:30' } });
    expect(
      (await api('PUT', '/v1/push/subscription', { token: D, body: { endpoint: ENDPOINT, keys: mine.keys } })).status,
    ).toBe(204);
    const quotaPushes = async () =>
      (
        await Promise.all(got.map(async (b) => JSON.parse(await received(mine, b)) as { k: string; id: string }))
      ).filter((p) => p.k === 'quota');
    const day = utcDay(Date.now());
    await seed(day, 'music', READ_80 - 100_000, 0);
    await deliver(env); // the agent keys' notices go here; below 80% no quota push
    expect(await quotaPushes()).toEqual([]);
    await seed(day, 'music', READ_80 + 1_000, 0);
    got = [];
    await deliver(env);
    await deliver(env);
    expect(await quotaPushes()).toEqual([{ k: 'quota', id: `quota-${day}` }]);
    expect((await apiJson('GET', `/v1/push/items/quota-${day}`, { token: D })).body).toEqual({
      title: 'Thunderhead',
      body: "Today's database use is at 80% of the free plan's daily limit. Backups and uploads wait until 00:00.",
      url: '/',
    });
    // The next UTC day past 80% again: that day's own push.
    vi.useFakeTimers({ toFake: ['Date'] });
    const next = nextUtcDay(Date.now()) + 9 * 60 * MINUTE;
    vi.setSystemTime(next);
    await seed(utcDay(next), 'music', READ_80 + 5_000, 0);
    got = [];
    await deliver(env);
    expect(await quotaPushes()).toEqual([{ k: 'quota', id: `quota-${utcDay(next)}` }]);
  });
});
