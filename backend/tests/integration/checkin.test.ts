// The mind's check-ins (areas/mind/checkin*.ts; owner, 2026-11-22), with fake time: each slot fires
// once at its time in the owner's zone, at most 90 minutes late; every skip reason; the check-in
// claim's briefing (the chat's, never "night already done"); the one message, which notifies no
// one; a normal night session still writes no message; the 10-minute end; the settings and the
// meter's kind.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { TodayResponse } from '../../../shared/contract/api';
import { SETTINGS } from '../../../shared/contract/settings.ts';
import { causeOf } from '../../src/areas/mind/watches/usage';
import { uuidv7 } from '../../src/lib/ids';
import { dayBefore, MINUTE, zonedMinute } from '../../src/lib/time';
import type { Core } from '../../src/objects/core';
import { api, apiJson, authSql, core, coreSql } from '../helpers';
import { as, brief, NIGHT_SESSION, ownerSays, type Principals, principals } from '../memory-helpers';

const TZ = 'Asia/Tokyo';
let p: Principals;
let today = '';
const stub = () => core() as unknown as DurableObjectStub<Core>;
const at = (day: string, hhmm: string) => zonedMinute(day, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);
const fires: string[] = [];

/** The cron's check-in step at `now`, with the night task connected (or not). */
const tick = (now: number, connected = true) =>
  runInDurableObject(stub(), async (o: Core) => {
    const self = o as unknown as { env: Env };
    const before = self.env;
    if (connected)
      self.env = { ...before, ROUTINE_NIGHT_URL: 'https://api.example.test/night', ROUTINE_NIGHT_TOKEN: 'tok' };
    const fake = (async (url: string) => {
      fires.push(url);
      return Response.json({ claude_code_session_id: 'session_checkin' });
    }) as unknown as typeof fetch;
    try {
      return await o.checkinTick(now, fake);
    } finally {
      self.env = before;
    }
  });
const row = async (day: string, slot: string) =>
  (
    await coreSql<{ outcome: string; why: string | null; wake_id: string | null }>(
      'SELECT outcome, why, wake_id FROM checkins WHERE day = ? AND slot = ?',
      day,
      slot,
    )
  )[0];
const setting = (key: string, value: unknown) =>
  coreSql(
    `INSERT INTO settings (key, value_json, updated_at, actor) VALUES (?, ?, 0, 'test')
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
    key,
    JSON.stringify(value),
  );

beforeAll(async () => {
  p = await principals();
  await apiJson('PATCH', '/v1/settings', {
    token: p.D,
    body: { 'owner.tz': TZ, 'quiet.start': '06:30', 'quiet.end': '06:30' },
  });
  today = (await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: p.D })).body.day;
});

describe('when a check-in fires', () => {
  it('two a day: 12:30 and 18:30 in the owner zone, each once; one a day: 15:00', async () => {
    const day = '2031-03-04';
    expect(await tick(at(day, '12:29'))).toBeNull();
    const first = await tick(at(day, '12:30'));
    expect(first).not.toBeNull();
    expect(await row(day, '12:30')).toMatchObject({ outcome: 'fired', wake_id: first });
    const [w] = await coreSql('SELECT task, reason, fire_status, session_id FROM wakes WHERE id = ?', first);
    expect(w).toEqual({ task: 'night', reason: 'checkin', fire_status: 200, session_id: 'session_checkin' });
    expect(await tick(at(day, '12:45'))).toBeNull();
    expect(await tick(at(day, '13:59'))).toBeNull();
    const second = await tick(at(day, '18:30'));
    expect(second).not.toBeNull();
    // Nobody claimed the first: after 30 minutes it ended unclaimed, its wake failed.
    expect((await row(day, '12:30')).outcome).toBe('unclaimed');
    expect((await coreSql('SELECT status FROM wakes WHERE id = ?', first))[0]).toEqual({ status: 'failed' });
    await setting('mind.checkins', '1');
    const next = '2031-03-05';
    expect(await tick(at(next, '12:30'))).toBeNull();
    expect(await tick(at(next, '15:00'))).not.toBeNull();
    expect(await row(next, '12:30')).toBeUndefined();
    await setting('mind.checkins', '0');
    expect(await tick(at('2031-03-06', '15:00'))).toBeNull();
    await setting('mind.checkins', '1');
  });

  it('late by at most 90 minutes; later, skipped for the day', async () => {
    expect(await tick(at('2031-03-07', '16:31'))).toBeNull();
    expect(await row('2031-03-07', '15:00')).toMatchObject({ outcome: 'skipped', why: 'late' });
    expect(await tick(at('2031-03-07', '17:00'))).toBeNull();
    expect(await tick(at('2031-03-08', '16:29'))).not.toBeNull();
  });

  it('skips with why: each reason; a skip inside the 90 minutes is tried again', async () => {
    const cases: [string, (now: number) => Promise<unknown>, (now: number) => Promise<unknown>][] = [
      ['unconfigured', async () => {}, async () => {}],
      ['quiet', () => setting('quiet.start', '12:00'), () => setting('quiet.start', '06:30')],
      ['silent', () => setting('mind.speech', 'silent'), () => setting('mind.speech', 'as_needed')],
      [
        'limited',
        (n) => setting('mind.backoff', { until: n + 3_600_000, step: 0 }),
        () => setting('mind.backoff', { until: 0, step: -1 }),
      ],
      [
        'chat_live',
        (n) => coreSql("UPDATE leases SET renewed_at = ? WHERE task = 'chat'", n),
        () => coreSql("UPDATE leases SET renewed_at = 0 WHERE task = 'chat'"),
      ],
      [
        'owner_recent',
        async (n) =>
          coreSql(
            'UPDATE messages SET created_at = ? WHERE id = ?',
            n - 10 * MINUTE,
            await ownerSays(p.D, 'Back soon.'),
          ),
        () => coreSql("UPDATE messages SET created_at = 0 WHERE author = 'owner'"),
      ],
      [
        'night',
        (n) =>
          coreSql(
            "INSERT INTO wakes (id, at, task, reason, status, fired_at) VALUES ('roll-open', ?, 'night', 'roll', 'fired', ?)",
            n - 3_600_000,
            n - 3_600_000,
          ),
        () => coreSql("DELETE FROM wakes WHERE id = 'roll-open'"),
      ],
      [
        'cap_hour',
        async (n) => {
          for (let i = 0; i < 20; i++)
            await coreSql(
              "INSERT INTO wakes (id, at, task, reason, status) VALUES (?, ?, 'chat', 'message', 'ended')",
              `cap-h-${i}`,
              n - MINUTE,
            );
        },
        () => coreSql("DELETE FROM wakes WHERE id LIKE 'cap-h-%'"),
      ],
      [
        'cap_day',
        async (n) => {
          for (let i = 0; i < 80; i++)
            await coreSql(
              "INSERT INTO wakes (id, at, task, reason, status) VALUES (?, ?, 'reflex', 'watchdog', 'ended')",
              `cap-d-${i}`,
              n - 2 * 3_600_000,
            );
        },
        () => coreSql("DELETE FROM wakes WHERE id LIKE 'cap-d-%'"),
      ],
    ];
    for (const [i, [why, set, clear]] of cases.entries()) {
      const day = `2031-04-${String(10 + i).padStart(2, '0')}`;
      const now = at(day, '15:00');
      await set(now);
      expect(await tick(now, why !== 'unconfigured'), why).toBeNull();
      expect(await row(day, '15:00'), why).toMatchObject({ outcome: 'skipped', why });
      await clear(now);
      // Looked at again on the next tick, inside the 90 minutes.
      expect(await tick(now + 15 * MINUTE), why).not.toBeNull();
      expect((await row(day, '15:00')).outcome, why).toBe('fired');
    }
  });
});

describe('a check-in session', () => {
  /** A check-in fired just now, answered by `session` (an exact claim). */
  async function firedCheckin(slot: string, session: string) {
    const id = uuidv7();
    const now = Date.now();
    await coreSql(
      `INSERT INTO wakes (id, at, task, reason, status, fired_at, session_id) VALUES (?, ?, 'night', 'checkin', 'fired', ?, ?)`,
      id,
      now,
      now,
      session.replace(/^cse_/, 'session_'),
    );
    await coreSql(
      `INSERT INTO checkins (day, slot, due_at, at, fired_at, wake_id, outcome) VALUES (?, ?, ?, ?, ?, ?, 'fired')`,
      today,
      slot,
      now,
      now,
      now,
      id,
    );
    return id;
  }
  const say = (session: string, body: string, id = uuidv7()) =>
    apiJson<{ message_id: string; error?: { code: string } }>('POST', '/v1/mind/checkin', {
      ...as(p.N, session),
      body: { action: 'say', id, body },
    });

  it('gets the chat briefing with the check-in section, never "night already done"; says once, without a notification', async () => {
    await coreSql(
      `INSERT INTO night_runs (day, started_at, step, steps_json, done_at, session_id) VALUES (?, 1, 13, '{}', 2, 'cse_gone')
       ON CONFLICT (day) DO UPDATE SET done_at = 2`,
      dayBefore(today),
    );
    const wake = await firedCheckin('00:01', 'cse_ci_one');
    const b = await brief(p.N, 'cse_ci_one', 'night');
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ night_done: false, role_section: 'checkin', day: today });
    expect(b.body.wake).toEqual({ id: wake, reason: 'checkin', claim_match: 'exact' });
    expect((await coreSql('SELECT status FROM wakes WHERE id = ?', wake))[0]).toEqual({ status: 'claimed' });
    const pushesBefore = (await authSql<{ n: number }>('SELECT count(*) AS n FROM pushes'))[0].n;
    const id = uuidv7();
    const first = await say('cse_ci_one', 'You said you would try the new trail today. How was it?', id);
    expect(first.status).toBe(200);
    const [m] = await coreSql('SELECT author, kind, reply_to, session_id FROM messages WHERE id = ?', id);
    expect(m).toEqual({ author: 'mind', kind: 'text', reply_to: null, session_id: 'cse_ci_one' });
    const thread = (await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: p.D })).body;
    expect(thread.messages.map((x) => x.id)).toContain(id);
    // The same id is the same answer; a second message is refused.
    expect((await say('cse_ci_one', 'You said you would try the new trail today. How was it?', id)).status).toBe(200);
    const again = await say('cse_ci_one', 'And one more thing.');
    expect([again.status, again.body.error?.code]).toEqual([409, 'conflict']);
    expect((await authSql<{ n: number }>('SELECT count(*) AS n FROM pushes'))[0].n).toBe(pushesBefore);
    const done = await apiJson('POST', '/v1/mind/checkin', { ...as(p.N, 'cse_ci_one'), body: { action: 'done' } });
    expect(done.body).toEqual({ outcome: 'said', slot: '00:01' });
    expect((await coreSql('SELECT status FROM wakes WHERE id = ?', wake))[0]).toEqual({ status: 'ended' });
    expect(
      (await apiJson('POST', '/v1/mind/checkin', { ...as(p.N, 'cse_ci_one'), body: { action: 'done' } })).body,
    ).toEqual({ outcome: 'said', slot: '00:01' });
    // Ended: no more words from it.
    expect((await say('cse_ci_one', 'Late words.')).status).toBe(403);
  });

  it('a normal night session still writes no message; nor does the chat key here', async () => {
    const r = await say(NIGHT_SESSION, 'Not a check-in.');
    expect([r.status, r.body.error?.code]).toEqual([403, 'forbidden']);
    expect(
      (await api('PUT', `/v1/messages/${uuidv7()}`, { ...as(p.N, NIGHT_SESSION), body: { body: 'Hello.' } })).status,
    ).toBe(403);
    expect(
      (await api('POST', '/v1/mind/checkin', { ...as(p.C, 'cse_memory_chat_1'), body: { action: 'done' } })).status,
    ).toBe(403);
  });

  it('ends by itself after 10 minutes, saying nothing, with why', async () => {
    const wake = await firedCheckin('00:02', 'cse_ci_two');
    expect((await brief(p.N, 'cse_ci_two', 'night')).status).toBe(200);
    const past = Date.now() - 11 * MINUTE;
    await coreSql('UPDATE mind_sessions SET claimed_at = ? WHERE session_id = ?', past, 'cse_ci_two');
    await coreSql('UPDATE wakes SET claimed_at = ? WHERE id = ?', past, wake);
    expect((await say('cse_ci_two', 'Too late.')).status).toBe(403);
    await setting('mind.checkins', '0');
    await tick(Date.now());
    expect(await row(today, '00:02')).toMatchObject({ outcome: 'timeout', why: 'timeout' });
    const [s] = await coreSql<{ ended_at: number | null }>(
      'SELECT ended_at FROM mind_sessions WHERE session_id = ?',
      'cse_ci_two',
    );
    expect(s.ended_at).not.toBeNull();
  });

  it('done --nothing records why', async () => {
    await firedCheckin('00:03', 'cse_ci_three');
    await brief(p.N, 'cse_ci_three', 'night');
    const r = await apiJson('POST', '/v1/mind/checkin', {
      ...as(p.N, 'cse_ci_three'),
      body: { action: 'done', nothing: 'nothing worth a note' },
    });
    expect(r.body).toEqual({ outcome: 'nothing', slot: '00:03' });
    expect(await row(today, '00:03')).toMatchObject({ outcome: 'nothing', why: 'nothing: nothing worth a note' });
  });
});

describe('the settings and the meter', () => {
  it('mind.checkins: 0, 1 or 2, default 2, on Reaching you; mind.pushes: never by default', () => {
    const c = SETTINGS.find((s) => s.key === 'mind.checkins');
    expect(c).toMatchObject({ kind: 'choice', default: '2', section: 'Reaching you', label: 'Check-ins a day' });
    expect(c?.options?.map((o) => o.value)).toEqual(['0', '1', '2']);
    expect(c?.detail).toContain('No notification.');
    expect(SETTINGS.find((s) => s.key === 'mind.pushes')?.default).toBe('never');
  });

  it('counts a check-in as its own kind of wake', () => {
    expect(causeOf('night', 'checkin')).toBe('checkin');
    expect(causeOf('night', 'roll')).toBe('roll');
  });
});
