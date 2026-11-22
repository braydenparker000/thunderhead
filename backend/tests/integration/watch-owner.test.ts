// What is wrong, told to the owner (OPERATIONS.md §8.5). Each watchdog trips here from a real cause
// where one can be made in a test (a route that throws, the phone's error reports, a job that keeps
// failing, an owner message nobody answers, a day the cron stopped rolling, a night that never
// finished), not from a row put in its table; each open trip is one plain line on the Briefing, gone
// when it clears; the serious ones go as one bundled push a day, held by quiet hours. Synthetic.
import { createExecutionContext, runInDurableObject, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BriefingResponse } from '../../../shared/contract/briefing.ts';
import { runJobs } from '../../src/areas/jobs/runner';
import { insertJob } from '../../src/areas/jobs/store';
import { useFetch } from '../../src/areas/push/outbox';
import { deliver } from '../../src/areas/push/routes';
import { alarmPush, alarms } from '../../src/areas/watchdogs/owner';
import { onError } from '../../src/http/errors';
import { forgetReports } from '../../src/http/report';
import { DAY, HOUR, MINUTE } from '../../src/lib/time';
import type { Db } from '../../src/objects/base';
import type { Writer } from '../../src/objects/commit';
import type { Core } from '../../src/objects/core';
import { api, apiJson, coreSql } from '../helpers';
import { ownerSays } from '../memory-helpers';
import { phone, received } from '../push-helpers';
import { BIG, notes, resetWatchdogs, setupWatchdogs, stub, TRIP, watch } from '../watchdog-helpers';

let D = '';
beforeAll(async () => {
  D = (await setupWatchdogs()).D;
});

const lines = async () => (await apiJson<BriefingResponse>('GET', '/v1/briefing', { token: D })).body.alarms ?? [];
const inCore = <T>(fn: (db: Db, o: Core) => T | Promise<T>) =>
  runInDurableObject(stub(), (o: Core) => fn((o as unknown as { db: Db }).db, o));
const noQuiet = () =>
  apiJson('PATCH', '/v1/settings', { token: D, body: { 'quiet.start': '06:30', 'quiet.end': '06:30' } });

class BrokenThing extends Error {
  override name = 'BrokenThing';
}
const broken = new Hono<{ Bindings: Env }>()
  .get('/v1/boom/:id', () => {
    throw new BrokenThing('synthetic');
  })
  .onError(onError);
const boom = async () => {
  const ctx = createExecutionContext();
  await broken.request('/v1/boom/1', {}, env, ctx);
  await waitOnExecutionContext(ctx);
};

describe('each watchdog trips from a real cause, and the Briefing says so in one line', () => {
  it('errors.spike: a route that keeps throwing (http/report.ts is its input)', async () => {
    await resetWatchdogs();
    const t = Date.now();
    await watch(t); // the first check only records
    forgetReports();
    for (let i = 0; i < 5; i++) await boom();
    await watch(t + 15 * MINUTE);
    expect(await notes('errors.spike')).toEqual([TRIP('errors.spike')]);
    expect(await lines()).toEqual(['The server is failing more often than usual. Nothing needed from you.']);
    await watch(t + 30 * MINUTE); // nothing new since the last check
    expect(await lines()).toEqual([]);
  });

  it('client.errors: the phone reports 50 errors in an hour', async () => {
    await resetWatchdogs();
    const t = Date.now();
    await watch(t);
    const item = { source: 'client', code: 'TypeError', message: 'x is undefined', build: 1, at: t };
    const r = await api('POST', '/v1/ops/errors', {
      token: D,
      body: { items: Array.from({ length: 50 }, () => item) },
    });
    expect(r.status).toBe(204);
    await watch(t + 15 * MINUTE);
    expect(await notes('client.errors')).toEqual([TRIP('client.errors')]);
    expect(await lines()).toEqual([
      'The site is hitting errors on your phone more than usual. Nothing needed from you.',
    ]);
  });

  it('jobs.stuck: a job whose every step fails, five times', async () => {
    await resetWatchdogs();
    const t = Date.now();
    const handler = {
      kind: 'wd-boom',
      lane: false,
      load: async () => null,
      step: () => {
        throw new Error('synthetic');
      },
    };
    await inCore(async (db, o) => {
      const host = o as unknown as { write<T>(fn: (w: Writer) => T, at?: number): T };
      const write = host.write.bind(o);
      write((w) => insertJob(w.db, { id: 'job-wd-boom', kind: 'wd-boom', payload: {}, at: t }), t);
      // Each retry after its wait (1, 5, 30 minutes, 2 hours): five failures in a row.
      for (const at of [t, t + 2 * MINUTE, t + 8 * MINUTE, t + 40 * MINUTE, t + 3 * HOUR])
        await runJobs({ env, db, write }, { 'wd-boom': handler }, at);
    });
    await watch(t + 3 * HOUR + MINUTE);
    expect(await notes('jobs.stuck')).toEqual([
      'watchdog jobs.stuck tripped: job job-wd-boom (wd-boom) is queued after 5 attempts',
    ]);
    expect(await lines()).toEqual(['A background task is stuck. Nothing needed from you.']);
    await coreSql("DELETE FROM jobs WHERE id = 'job-wd-boom'");
  });

  it('reply.late: an owner message nobody answers for 30 minutes', async () => {
    await resetWatchdogs();
    await noQuiet();
    await ownerSays(D, 'Is anyone there');
    await watch(Date.now() + 31 * MINUTE);
    expect(await notes('reply.late')).toEqual([TRIP('reply.late')]);
    expect(await lines()).toContain(
      "A message has waited over 30 minutes for a reply. It's kept. Nothing needed from you.",
    );
    await coreSql("UPDATE messages SET answered_at = 1 WHERE author = 'owner'");
    await watch(Date.now() + 32 * MINUTE);
    expect(await lines()).toEqual([]);
  });

  it('night.late three nights running, then roll.stuck: the cron rolled a day and then stopped', async () => {
    await resetWatchdogs();
    const day0 = new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10);
    const t = Date.parse(`${day0}T10:00:00Z`);
    // The day roll, as the cron runs it: then no cron for 31 hours.
    const rolled = await inCore((_db, o) => o.tick(t));
    expect(rolled.rolled).toBe(day0);
    await watch(t + 3 * HOUR, { nightConfigured: true });
    expect(await notes('night.late')).toEqual([TRIP('night.late')]);
    const at1 = t + 3 * HOUR;
    expect(await inCore((db) => alarms(db, at1, 'UTC').lines)).toEqual([
      "The night shift didn't finish last night. Nothing needed from you.",
    ]);
    // No night shift's work for three nights: serious, the day's one push.
    expect(await inCore((db) => alarmPush(db, at1, 'UTC'))).toEqual({
      id: `alarm-${day0}`,
      at: at1,
      until: at1 + DAY,
      body: "The night shift hasn't finished for 3 nights. More on the Briefing.",
    });
    const at2 = t + 31 * HOUR;
    await watch(at2, { nightConfigured: true });
    expect(await notes('roll.stuck')).toEqual([`watchdog roll.stuck tripped: the day ${day0} began 31 hours ago`]);
    expect(await inCore((db) => alarms(db, at2, 'UTC').lines)).toContain(
      "Yesterday hasn't been closed off, so today's pages may be behind. Nothing needed from you.",
    );
    // The next day: a new serious one, so that day's push names both.
    expect((await inCore((db) => alarmPush(db, at2, 'UTC')))?.body).toBe(
      "2 things aren't working right. More on the Briefing.",
    );
    await coreSql("DELETE FROM settings WHERE key = 'day.current'");
  });

  it('a drill is not a line: nothing is wrong', async () => {
    await resetWatchdogs();
    await coreSql(
      `INSERT INTO watchdogs (name, state, since, detail, trips, checked_at) VALUES ('db.size', 'tripped', ?, 'a drill: tripped by hand, nothing is wrong', 1, ?)`,
      Date.now(),
      Date.now(),
    );
    expect(await lines()).toEqual([]);
  });
});

describe('the bundled push', () => {
  const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/test-alarm-phone';
  let got: Uint8Array[] = [];
  afterAll(() => useFetch((...a) => fetch(...a)));

  it('goes once a day, held by quiet hours and sent at their end, its words fetched with the session', async () => {
    await resetWatchdogs();
    useFetch(async (_input, init) => {
      got.push(new Uint8Array(await new Response(init?.body).arrayBuffer()));
      return new Response(null, { status: 201 });
    });
    const mine = await phone();
    expect(
      (await api('PUT', '/v1/push/subscription', { token: D, body: { endpoint: ENDPOINT, keys: mine.keys } })).status,
    ).toBe(204);
    const alarmPushes = async () =>
      (
        await Promise.all(got.map(async (b) => JSON.parse(await received(mine, b)) as { k: string; id: string }))
      ).filter((p) => p.k === 'alarm');
    await deliver(env);
    got = [];
    // Storage nearly full (serious), inside quiet hours: held.
    await watch(Date.now(), { dbBytes: BIG });
    await apiJson('PATCH', '/v1/settings', { token: D, body: { 'quiet.start': '00:00', 'quiet.end': '23:59' } });
    await deliver(env);
    expect(await alarmPushes()).toEqual([]);
    // Quiet hours end: it goes, once.
    await noQuiet();
    await deliver(env);
    await deliver(env);
    const sent = await alarmPushes();
    expect(sent).toHaveLength(1);
    expect((await apiJson('GET', `/v1/push/items/${sent[0].id}`, { token: D })).body).toEqual({
      title: 'Thunderhead',
      body: 'Storage is getting full. More on the Briefing.',
      url: '/',
    });
    // Another serious one the same day: no second push that day.
    await watch(Date.now(), { dbBytes: BIG, nightConfigured: false });
    await resetWatchdogs();
    await watch(Date.now() + MINUTE, { dbBytes: BIG });
    got = [];
    await deliver(env);
    expect(await alarmPushes()).toEqual([]);
  });
});
