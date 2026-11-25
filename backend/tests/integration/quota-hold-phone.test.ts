// The phone's writes and the hold (meter/hold.ts, DATA.md §8.1): from 85% of the day's budget its
// senses batches answer 429 `rate_limited` (`daily_quota`) until 00:00 UTC, so a message, a reminder
// and a setting keep the rest; its own song marks and playlists are never held (2026-11-25), while a
// heavy route (the mind's songs by feeling) still is; below the hold all go through. The meter's rows are
// synthetic fixtures in Core's meter_days.
import { afterEach, beforeAll, expect, it } from 'vitest';
import { budgetAt } from '../../../shared/contract/meter.ts';
import { forgetHold } from '../../src/areas/meter/hold';
import { forgetOwner } from '../../src/areas/senses/routes';
import { uuidv7 } from '../../src/lib/ids';
import { utcDay } from '../../src/lib/time';
import { api, coreSql } from '../helpers';
import { asNight, type Principals, principals } from '../memory-helpers';

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
      items: [{ id: 'plinvented', name: 'Invented', ids: [], created: 1, path: null, deleted: false, updated_at: 1 }],
    },
  });
// A heavy route the hold still answers: the mind's songs by feeling, held past the hold like a batch.
const find = () => api('GET', '/v1/music/find?moods=calm', asNight(p));
const say = (body: string) => api('PUT', `/v1/messages/${uuidv7()}`, { token: p.D, body: { body } });

beforeAll(async () => {
  p = await principals();
});
afterEach(async () => {
  await seed(0);
  forgetHold();
});

it("holds the phone's senses from 85%, never its messages, song marks or playlists", async () => {
  forgetHold();
  forgetOwner();
  expect((await senses()).status).toBe(200);
  expect((await say('Before the hold.')).status).toBe(201);
  await seed(budgetAt(85, 'rows_written') + 1);
  forgetHold();
  for (const call of [senses, find]) {
    const r = await call();
    expect(r.status).toBe(429);
    const e = ((await r.json()) as { error: { code: string; details: unknown; retry_after: number } }).error;
    expect(e).toMatchObject({ code: 'rate_limited', details: { reason: 'daily_quota' }, scope: 'account' });
    expect(e.retry_after).toBeGreaterThan(0);
  }
  // The owner's own small saves go through while held.
  for (const call of [marks, lists]) {
    const r = await call();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ refused: [] });
  }
  expect((await say('During the hold.')).status).toBe(201);
});
