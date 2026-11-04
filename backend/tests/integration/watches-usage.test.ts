// The usage meter (GET /v1/mind/usage, Settings › The mind): today and the 7 days before it in the
// owner's logical days, from the Worker's own records: wakes by cause (a retry is the same wake),
// minutes awake per role from the sessions' claims and ends (a session that never ended counts to
// its role's limit), the night shift's run, and the watches fired or refused. Fixtures on a fixed
// clock (the objects run in this isolate, so they read it too).
import { runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { UsageResponse } from '../../../shared/contract/watches.ts';
import { uuidv7 } from '../../src/lib/ids';
import type { Core } from '../../src/objects/core';
import { apiJson, core, coreSql } from '../helpers';
import { as, CHAT_SESSION, type Principals, principals } from '../memory-helpers';

let p: Principals;
const NOW = Date.UTC(2030, 0, 15, 16, 0);
/** A time on 15 January 2030 (UTC, the test owner's zone), or on the 14th with `day: 14`. */
const at = (h: number, m = 0, day = 15) => Date.UTC(2030, 0, day, h, m);
const usage = () => runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.usage());

beforeAll(async () => {
  p = await principals();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the usage meter', () => {
  it('counts wakes by cause, minutes by role, the night’s run and the watches, by logical day', async () => {
    for (const t of ['wakes', 'mind_sessions', 'night_runs', 'watches']) await coreSql(`DELETE FROM ${t}`);
    const wake = (task: string, reason: string, t: number, retry: string | null = null, id = uuidv7()) =>
      coreSql(
        "INSERT INTO wakes (id, at, task, reason, status, retry_of) VALUES (?, ?, ?, ?, 'ended', ?)",
        id,
        t,
        task,
        reason,
        retry,
      ).then(() => id);
    for (const [r, h] of [
      ['message', 9],
      ['prewarm', 9.5],
      ['requeue', 10],
      ['manual', 10.5],
    ] as const)
      await wake('chat', r, at(Math.floor(h), (h % 1) * 60));
    const first = await wake('chat', 'watch', at(11));
    await wake('chat', 'watch', at(12), first);
    await wake('chat', 'watch', at(13));
    await wake('night', 'roll', at(4, 10));
    await wake('night', 'manual', at(6, 7));
    await wake('reflex', 'watchdog:errors.spike', at(14));
    const answered = async (
      reason: string,
      fired: number,
      claimed: number,
      replied: number,
      retry: string | null = null,
    ) =>
      coreSql(
        'UPDATE wakes SET fired_at = ?, claimed_at = ?, first_reply_at = ? WHERE id = ?',
        fired,
        claimed,
        replied,
        await wake('chat', reason, fired, retry),
      );
    await answered('message', at(15), at(15, 0) + 20_000, at(15, 1) + 10_000); // 20 s to claim, 50 s to reply
    const lost = await wake('chat', 'message', at(15, 30));
    await answered('message', at(15, 32), at(15, 32) + 10_000, at(15, 32) + 40_000, lost); // the retry got the claim: 10 s, 30 s
    await answered('prewarm', at(16), at(16) + 5_000, at(16) + 8_000); // warm already: not a cold wake
    await wake('chat', 'message', at(20, 0, 14));
    // 03:30 on the 15th is still the 14th's logical day (it ends at 04:00).
    await wake('chat', 'watch', at(3, 30));
    const sess = (
      role: string,
      claimed: number,
      ended: number | null,
      owner: number | null = null,
      w: string | null = 'w',
    ) =>
      coreSql(
        'INSERT INTO mind_sessions (session_id, role, wake_id, claimed_at, ended_at, last_owner_at, day) VALUES (?, ?, ?, ?, ?, ?, ?)',
        `cse_${uuidv7()}`,
        role,
        w,
        claimed,
        ended,
        owner,
        '2030-01-15',
      );
    await sess('chat', at(9), at(9, 45));
    await sess('chat', at(13), null, at(13, 30)); // never ended: to its idle cutoff, 15:30
    await sess('night', at(4, 10), at(4, 40));
    await sess('night', at(6, 7), null); // to the hard stop: 60
    await sess('reflex', at(14), null); // 10
    await sess('chat', at(20, 0, 14), at(20, 20, 14));
    await sess('chat', at(10), null, null, null); // a taint's own row, never a claim
    await coreSql(
      "INSERT INTO night_runs (day, started_at, step, steps_json, done_at) VALUES ('2030-01-14', ?, 10, '{}', ?), ('2030-01-13', ?, 3, '{}', NULL)",
      at(4, 12),
      at(4, 38),
      at(4, 15, 14),
    );
    const watch = (state: string, settled: number | null) =>
      coreSql(
        "INSERT INTO watches (id, kind, fire_at, why, state, created_at, until, settled_at) VALUES (?, 'at', ?, 'a test watch', ?, ?, ?, ?)",
        uuidv7(),
        at(10),
        state,
        at(8),
        at(10),
        settled,
      );
    await watch('fired', at(11));
    await watch('over_budget', at(15));
    await watch('cancelled', at(15, 10));
    await watch('fired', at(21, 0, 14));
    await watch('live', null);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const u: UsageResponse = await usage();
    expect(u.today).toEqual({
      day: '2030-01-15',
      wakes: { owner: 7, watch: 2, roll: 1, schedule: 1, watchdog: 1 },
      minutes: { chat: 45 + 150, night: 30 + 60, reflex: 10 },
      night_min: 26,
      watches: { fired: 1, refused: 1 },
      latency: { replies: 2, claim_s: 15, reply_s: 40 },
    });
    expect(u.days.map((d) => d.day)).toEqual([
      '2030-01-14',
      '2030-01-13',
      '2030-01-12',
      '2030-01-11',
      '2030-01-10',
      '2030-01-09',
      '2030-01-08',
    ]);
    expect(u.days[0]).toEqual({
      day: '2030-01-14',
      wakes: { owner: 1, watch: 1, roll: 0, schedule: 0, watchdog: 0 },
      minutes: { chat: 20, night: 0, reflex: 0 },
      night_min: 60,
      watches: { fired: 1, refused: 0 },
      latency: { replies: 0, claim_s: null, reply_s: null },
    });
    expect(u.days[1].wakes).toEqual({ owner: 0, watch: 0, roll: 0, schedule: 0, watchdog: 0 });
    expect([u.budget, u.live]).toEqual([12, 1]);
  });

  it('answers the device and the mind roles', async () => {
    vi.useRealTimers();
    for (const call of [{ token: p.D }, as(p.C, CHAT_SESSION), { token: p.N }]) {
      const r = await apiJson<UsageResponse>('GET', '/v1/mind/usage', call);
      expect(r.status).toBe(200);
      expect(Object.keys(r.body).sort()).toEqual(['budget', 'days', 'live', 'today']);
      expect(r.body.days).toHaveLength(7);
    }
  });
});
