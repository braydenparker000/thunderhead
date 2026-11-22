// The phone's writes that can wait (meter/hold.ts, DATA.md §8.1): from 80% of the day's budget its
// senses batches and its song marks and playlists answer 429 `rate_limited` (`daily_quota`) until
// 00:00 UTC, so a message, a reminder and a setting keep the last 20%; below 80% all go through. The
// meter's rows are synthetic fixtures in Core's meter_days.
import { afterEach, beforeAll, expect, it } from 'vitest';
import { budgetAt } from '../../../shared/contract/meter.ts';
import { forgetHold } from '../../src/areas/meter/hold';
import { forgetOwner } from '../../src/areas/senses/routes';
import { uuidv7 } from '../../src/lib/ids';
import { utcDay } from '../../src/lib/time';
import { api, coreSql } from '../helpers';
import { type Principals, principals } from '../memory-helpers';

let p: Principals;
const seed = (written: number) =>
  coreSql(
    "INSERT OR REPLACE INTO meter_days (day, class, rows_read, rows_written, updated_at) VALUES (?, 'senses', 0, ?, 0)",
    utcDay(Date.now()),
    written,
  );
const senses = () =>
  api('PUT', `/v1/senses/batches/${uuidv7()}`, {
    token: p.D,
    body: { events: [{ id: uuidv7(), at: Date.now() - 60_000, type: 'app.open', ref: 'app:music' }] },
  });
const marks = () =>
  api('PUT', '/v1/music/marks', {
    token: p.D,
    body: {
      items: [
        { id: `r2_native_${'b'.repeat(64)}`, rating: null, rated_at: null, plays: 2, last_played: 1, updated_at: 1 },
      ],
    },
  });
const lists = () =>
  api('PUT', '/v1/music/playlists', {
    token: p.D,
    body: {
      items: [{ id: 'pl_invented', name: 'Invented', ids: [], created: 1, path: null, deleted: false, updated_at: 1 }],
    },
  });
const say = (body: string) => api('PUT', `/v1/messages/${uuidv7()}`, { token: p.D, body: { body } });

beforeAll(async () => {
  p = await principals();
});
afterEach(async () => {
  await seed(0);
  forgetHold();
});

it("holds the phone's senses, marks and playlists from 80%, never its messages", async () => {
  forgetHold();
  forgetOwner();
  expect((await senses()).status).toBe(200);
  expect((await say('Before the hold.')).status).toBe(201);
  await seed(budgetAt(80, 'rows_written') + 1);
  forgetHold();
  for (const call of [senses, marks, lists]) {
    const r = await call();
    expect(r.status).toBe(429);
    const e = ((await r.json()) as { error: { code: string; details: unknown; retry_after: number } }).error;
    expect(e).toMatchObject({ code: 'rate_limited', details: { reason: 'daily_quota' }, scope: 'account' });
    expect(e.retry_after).toBeGreaterThan(0);
  }
  expect((await say('During the hold.')).status).toBe(201);
});
