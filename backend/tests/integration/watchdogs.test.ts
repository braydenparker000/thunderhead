// The watchdogs (OPERATIONS.md §8.2). Each built watchdog has a case that sets its condition with
// fixtures and a fake clock: exactly one ledger note per trip, none while it holds, one when it
// clears, and a new note when it trips again. mind-reflex's wake (RUNTIME.md §3): only once the
// task is connected, one open wake at a time, at most 4 in any 24 hours. These passes run watch()
// in the object through commit() at the clock each case sets. Then the whole path through the
// tick: a trip fires the connected task after the commit, the reflex session claims that wake, its
// briefing names the trip, and its report lands in the ledger. The drill and the routes are in
// watchdogs-drill.test.ts. Everything is synthetic.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BriefResponse } from '../../../shared/contract/api';
import type { WatchdogItem, WatchdogsResponse } from '../../../shared/contract/watchdogs.ts';
import { DAY, HOUR, MINUTE } from '../../src/lib/time';
import { apiJson, coreSql } from '../helpers';
import { SHA } from '../memory-helpers';
import {
  BIG,
  CLEAR,
  connected,
  errorsAt,
  job,
  notes,
  resetWatchdogs,
  setDay,
  setupWatchdogs,
  T0,
  TRIP,
  watch,
} from '../watchdog-helpers';

let R = '';
beforeAll(async () => {
  R = (await setupWatchdogs()).R;
});
beforeEach(resetWatchdogs);

describe('each built watchdog: one note per trip, none while it holds, one when it clears', () => {
  it('errors.spike: 20 new server errors in 60 min, or 5 of one fingerprint since the last check', async () => {
    await errorsAt('worker', 1);
    await watch(T0); // the first check only records
    await errorsAt('worker', 30);
    await watch(T0 + 15 * MINUTE);
    await watch(T0 + 30 * MINUTE); // still 29 within the hour
    await watch(T0 + 90 * MINUTE); // nothing new in the last hour
    await errorsAt('worker', 36);
    await watch(T0 + 105 * MINUTE); // 6 of one fingerprint
    expect(await notes('errors.spike')).toEqual([
      'watchdog errors.spike tripped: 29 new server errors in 60 min',
      CLEAR('errors.spike'),
      'watchdog errors.spike tripped: 6 of fingerprint fp-worker since the last check',
    ]);
  });

  it('client.errors: 50 client error reports in 60 min', async () => {
    await errorsAt('client', 1);
    await watch(T0);
    await errorsAt('client', 60);
    await watch(T0 + 15 * MINUTE);
    await watch(T0 + 30 * MINUTE);
    await watch(T0 + 90 * MINUTE);
    await errorsAt('client', 120);
    await watch(T0 + 105 * MINUTE);
    expect(await notes('client.errors')).toEqual([
      'watchdog client.errors tripped: 59 client error reports in 60 min',
      CLEAR('client.errors'),
      'watchdog client.errors tripped: 60 client error reports in 60 min',
    ]);
  });

  it('roll.stuck: the open day began more than 30 hours ago', async () => {
    await setDay('2026-10-18', T0 - 31 * HOUR);
    await watch(T0);
    await watch(T0 + 15 * MINUTE);
    await setDay('2026-10-20', T0 - HOUR);
    await watch(T0 + 30 * MINUTE);
    await setDay('2026-10-20', T0 - 31 * HOUR);
    await watch(T0 + 45 * MINUTE);
    expect(await notes('roll.stuck')).toEqual([
      'watchdog roll.stuck tripped: the day 2026-10-18 began 31 hours ago',
      CLEAR('roll.stuck'),
      TRIP('roll.stuck'),
    ]);
  });

  it('night.late: no day note by 09:00 local once the night shift is connected', async () => {
    await setDay('2026-10-20', T0 - 5 * HOUR);
    await watch(T0); // not connected: never
    const on = { nightConfigured: true };
    await watch(T0 + MINUTE, on);
    await watch(T0 + 15 * MINUTE, on);
    await watch(T0 + 22 * HOUR, on); // 08:00 the next morning
    await watch(T0 + 24 * HOUR, on);
    expect(await notes('night.late')).toEqual([
      "watchdog night.late tripped: no day note for 2026-10-19, and its run isn't done",
      CLEAR('night.late'),
      TRIP('night.late'),
    ]);
  });

  it('jobs.stuck: a job running for more than 2 hours, or one tried 5 times', async () => {
    await job('job-wd-1', 'running', T0 - 3 * HOUR);
    await watch(T0);
    await watch(T0 + 15 * MINUTE);
    await job('job-wd-1', 'done', T0);
    await watch(T0 + 30 * MINUTE);
    await job('job-wd-2', 'queued', T0, 5);
    await watch(T0 + 45 * MINUTE);
    expect(await notes('jobs.stuck')).toEqual([
      'watchdog jobs.stuck tripped: job job-wd-1 (import) is running after 0 attempts',
      CLEAR('jobs.stuck'),
      'watchdog jobs.stuck tripped: job job-wd-2 (import) is queued after 5 attempts',
    ]);
  });

  it('db.size: the Core object holds more than 700 MB', async () => {
    await watch(T0, { dbBytes: BIG });
    await watch(T0 + 15 * MINUTE, { dbBytes: BIG });
    await watch(T0 + 30 * MINUTE);
    await watch(T0 + 45 * MINUTE, { dbBytes: BIG });
    expect(await notes('db.size')).toEqual([
      'watchdog db.size tripped: Core holds 800 MB',
      'watchdog db.size cleared after 30 min',
      'watchdog db.size tripped: Core holds 800 MB',
    ]);
  });
});

describe('mind-reflex', () => {
  it('a trip wakes it once connected: one open wake at a time, at most 4 in any 24 hours', async () => {
    const big = { dbBytes: BIG, reflexOn: true };
    const small = { reflexOn: true };
    expect(await watch(T0, { dbBytes: BIG })).toBeNull(); // not connected: noted, nobody woken
    await watch(T0 + MINUTE, small);
    const first = await watch(T0 + 2 * MINUTE, big);
    expect(first?.task).toBe('reflex');
    await watch(T0 + 3 * MINUTE, small);
    expect(await watch(T0 + 4 * MINUTE, big)).toBeNull(); // the first wake is still open
    // A wake nobody claimed in 30 minutes has failed and no longer blocks; the fifth in 24 hours waits.
    let at = T0 + 4 * MINUTE;
    const later: (string | undefined)[] = [];
    for (let k = 0; k < 4; k++) {
      at += 31 * MINUTE;
      await watch(at, small);
      at += MINUTE;
      later.push((await watch(at, big))?.id);
    }
    expect(later.map(Boolean)).toEqual([true, true, true, false]);
    const rows = await coreSql<{ reason: string; status: string }>(
      "SELECT reason, status FROM wakes WHERE task = 'reflex' ORDER BY at",
    );
    expect(rows.map((r) => r.reason)).toEqual(Array(4).fill('watchdog:db.size'));
    expect(rows.slice(0, 3).map((r) => r.status)).toEqual(['failed', 'failed', 'failed']);
    // A day after the first, there is room again.
    at = T0 + 3 * MINUTE + DAY;
    await watch(at, small);
    expect((await watch(at + MINUTE, big))?.task).toBe('reflex');
    expect((await notes('db.size')).filter((n) => n.includes('tripped'))).toHaveLength(8);
  });

  it('end to end: the tick fires it after the commit, the session claims that wake and reads the trip, and its report is kept', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body });
      return Response.json({ claude_code_session_id: 'session_reflexwd' });
    }) as unknown as typeof fetch;
    const tick = (at: number) => connected((o) => o.tick(at, fake));
    const now = Date.now();
    await errorsAt('worker', 1);
    expect((await tick(now - 15 * MINUTE)).reflex).toBeNull();
    await errorsAt('worker', 40);
    const r = await tick(now);
    expect(r.reflex).toEqual(expect.any(String));
    expect(calls).toEqual([{ url: 'https://api.example.test/reflex', body: '{"text":"wake"}' }]);
    const [w] = await coreSql('SELECT task, reason, status, fire_status, session_id FROM wakes WHERE id = ?', r.reflex);
    expect(w).toEqual({
      task: 'reflex',
      reason: 'watchdog:errors.spike',
      status: 'fired',
      fire_status: 200,
      session_id: 'session_reflexwd',
    });
    const session = 'cse_reflexwd';
    const b = await apiJson<BriefResponse>('POST', '/v1/mind/brief', {
      token: R,
      headers: { 'TH-Session': session },
      body: { claim: true, session_id: session, role: 'reflex', constitution_sha256: SHA, th_version: '0.1.0' },
    });
    expect(b.status).toBe(200);
    expect(b.body.wake).toEqual({ id: r.reflex, reason: 'watchdog:errors.spike', claim_match: 'exact' });
    expect(b.body.core).toMatch(/^watchdogs tripped: errors\.spike since \d\d:\d\d · th reflex$/m);
    const spike = (await apiJson<WatchdogsResponse>('GET', '/v1/ops/watchdogs', { token: R })).body.items.find(
      (i) => i.name === 'errors.spike',
    );
    expect(spike).toMatchObject({ state: 'tripped', detail: '39 new server errors in 60 min', handled: null });
    const note = 'No deploy behind it; reported to the owner.';
    const h = await apiJson<WatchdogItem>('POST', '/v1/ops/watchdogs/errors.spike/handled', {
      token: R,
      headers: { 'TH-Session': session },
      body: { outcome: 'reported', note },
    });
    expect(h.status).toBe(200);
    expect(h.body.handled).toMatchObject({ outcome: 'reported', note });
    expect(await notes('errors.spike')).toEqual([
      'watchdog errors.spike tripped: 39 new server errors in 60 min',
      `handled watchdog errors.spike (reported): ${note}`,
    ]);
    const again = await apiJson<BriefResponse>('POST', '/v1/mind/brief', {
      token: R,
      headers: { 'TH-Session': session },
      body: { claim: false, session_id: session, role: 'reflex', constitution_sha256: SHA, th_version: '0.1.0' },
    });
    expect(again.body.core).toMatch(/^watchdogs tripped: errors\.spike since \d\d:\d\d \(reported\) · th reflex$/m);
  });
});
