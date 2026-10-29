// The night shift (RUNTIME.md §3, §12; API.md §11.8). The day roll fires mind-night once for the
// day it closed, and only while the task is connected (the `none` pair fires nothing). The run
// record takes its steps in order, skips the steps of later phases on the way, keeps a step's
// cursor, resumes a refired session where the last one stopped (a rerun day note stays version
// 1), records the steps a hard stop cut, and `done` ends the session and its wake. A closed day's
// input is in night-input.test.ts.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DayNote, ErrorBody, MindNightResponse, TodayResponse } from '../../../shared/contract/api';
import { fireConfig } from '../../src/areas/mind/fire';
import { nightWake } from '../../src/areas/mind/night';
import { dayBefore, HOUR } from '../../src/lib/time';
import { commit, type Writer } from '../../src/objects/commit';
import type { Core } from '../../src/objects/core';
import { apiJson, core, coreSql } from '../helpers';
import { as, brief, CHAT_SESSION, type Principals, principals } from '../memory-helpers';

let p: Principals;
let today = '';
let yday = '';
const stub = () => core() as unknown as DurableObjectStub<Core>;
const night = (body: Record<string, unknown>, session: string, token = p.N) =>
  apiJson<MindNightResponse & ErrorBody>('POST', '/v1/mind/night', { ...as(token, session), body });
const run = async (day: string) =>
  (
    await coreSql<{ step: number; steps_json: string; done_at: number | null }>(
      'SELECT step, steps_json, done_at FROM night_runs WHERE day = ?',
      day,
    )
  )[0];
const inCore = <T>(fn: (w: Writer) => T) =>
  runInDurableObject(
    stub(),
    (o: Core, state) => commit(state.storage, (o as unknown as { db: Writer['db'] }).db, fn).value,
  );
/** Makes the roll due: an older open day, and a conversation quiet for two hours. */
async function rollDue() {
  await coreSql(
    `INSERT INTO settings (key, value_json, updated_at, actor) VALUES ('day.current', ?, 0, 'worker')
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
    JSON.stringify(dayBefore(today, 5)),
  );
  await coreSql('UPDATE messages SET created_at = created_at - 7200000');
}

beforeAll(async () => {
  p = await principals();
  today = (await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: p.D })).body.day;
  yday = dayBefore(today);
});

describe('the day roll fires the night shift', () => {
  it('reads the mind-night pair: none (or not https) is not connected, and the chat pair is its own', () => {
    const pair = { ROUTINE_CHAT_URL: 'none', ROUTINE_CHAT_TOKEN: 'none' };
    const on = { ...pair, ROUTINE_NIGHT_URL: 'https://api.example.test/night', ROUTINE_NIGHT_TOKEN: 'tok' } as Env;
    expect(fireConfig(on, 'night')).toEqual({ url: 'https://api.example.test/night', token: 'tok' });
    expect(fireConfig(on, 'chat')).toBeNull();
    expect(fireConfig({ ...on, ROUTINE_NIGHT_TOKEN: 'none' } as Env, 'night')).toBeNull();
    expect(fireConfig({ ...on, ROUTINE_NIGHT_URL: 'http://api.example.test/night' } as Env, 'night')).toBeNull();
    expect(fireConfig(on, 'reflex')).toBeNull();
  });

  it('while the pair is none, the roll fires nothing', async () => {
    await rollDue();
    const r = await runInDurableObject(stub(), (o: Core) => o.tick());
    expect(r.rolled).toBe(today);
    expect(r.night).toBeNull();
    expect(await coreSql("SELECT id FROM wakes WHERE task = 'night' AND reason = 'roll'")).toEqual([]);
  });

  it('once connected, the roll fires mind-night once, records the fire, and that session claims it exactly', async () => {
    await rollDue();
    const calls: { url: string; body: unknown }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body });
      return Response.json({ claude_code_session_id: 'session_nightroll' });
    }) as unknown as typeof fetch;
    const r = await runInDurableObject(stub(), async (o: Core) => {
      const self = o as unknown as { env: Env };
      const before = self.env;
      self.env = { ...before, ROUTINE_NIGHT_URL: 'https://api.example.test/night', ROUTINE_NIGHT_TOKEN: 'tok' };
      try {
        return await o.tick(Date.now(), fake);
      } finally {
        self.env = before;
      }
    });
    expect(r.rolled).toBe(today);
    expect(calls).toEqual([{ url: 'https://api.example.test/night', body: '{"text":"wake"}' }]);
    const [w] = await coreSql('SELECT task, reason, status, fire_status, session_id FROM wakes WHERE id = ?', r.night);
    expect(w).toEqual({
      task: 'night',
      reason: 'roll',
      status: 'fired',
      fire_status: 200,
      session_id: 'session_nightroll',
    });
    const b = await brief(p.N, 'cse_nightroll', 'night');
    expect(b.body.wake).toEqual({ id: r.night, reason: 'roll', claim_match: 'exact' });
    expect(b.body.day).toBe(yday);
    expect(b.body.night_done).toBe(false);
  });

  it('a night wake open for under 12 hours is not fired again; an older one nobody claimed has failed', async () => {
    const first = await inCore((w) => nightWake(w, today, true));
    expect(first).toMatchObject({ task: 'night' });
    expect(await inCore((w) => nightWake(w, today, true))).toBeNull();
    await coreSql('UPDATE wakes SET at = at - ? WHERE id = ?', 13 * HOUR, first?.id);
    const second = await inCore((w) => nightWake(w, today, true));
    expect(second).not.toBeNull();
    expect((await coreSql('SELECT status FROM wakes WHERE id = ?', first?.id))[0]).toEqual({ status: 'failed' });
    expect(await inCore((w) => nightWake(w, today, false))).toBeNull();
    // A night that already finished is not fired again.
    const done = dayBefore(today, 6);
    await coreSql(
      "INSERT INTO night_runs (day, started_at, step, steps_json, done_at) VALUES (?, 1, 10, '{}', 2)",
      done,
    );
    expect(await inCore((w) => nightWake(w, dayBefore(done, -1), true))).toBeNull();
    // Tidy up: nothing open for the run tests below to claim.
    await coreSql("UPDATE wakes SET status = 'failed' WHERE task = 'night' AND status = 'fired'");
  });
});

describe('the run record', () => {
  it('a new run starts at step 1; a step ahead of it is 409 with where the run is; a step again changes nothing', async () => {
    const b = await brief(p.N, 'cse_night_a', 'night');
    expect(b.body.day).toBe(yday);
    expect(b.body.core).toContain(`day ${yday} · role night`);
    expect(b.body.core).toContain(`## 2. Waiting\nYesterday's thread: none, 0 messages; run th day ${yday}`);
    expect(b.body.full).toContain('night shift: not connected yet (SETUP.md L1)');
    expect((await night({ day: yday, action: 'start' }, 'cse_night_a')).body).toEqual({
      resume_from: 1,
      done: false,
      cursor: null,
      skipped: [],
    });
    const ahead = await night({ day: yday, action: 'step_done', step: 2 }, 'cse_night_a');
    expect(ahead.status).toBe(409);
    expect(ahead.body.error).toMatchObject({ code: 'conflict', details: { resume_from: 1 } });
    expect((await night({ day: yday, action: 'step_done', step: 1 }, 'cse_night_a')).body.resume_from).toBe(2);
    const before = await run(yday);
    expect((await night({ day: yday, action: 'step_done', step: 1 }, 'cse_night_a')).body.resume_from).toBe(2);
    expect(await run(yday)).toEqual(before);
    expect((await night({ day: yday, action: 'step_done', step: 12 }, 'cse_night_a')).status).toBe(422);
    expect((await night({ day: yday, action: 'cursor', step: 2, cursor: 'x' }, 'cse_night_a')).status).toBe(422);
  });

  it('a refire resumes where the last session stopped: the day note stays version 1, a step cursor comes back', async () => {
    const note = { summary: 'A quiet day with tea.', decisions: [], importance: 3 };
    const put = (session: string) =>
      apiJson<DayNote>('PUT', `/v1/memory/day-notes/${yday}`, { ...as(p.N, session), body: note });
    expect((await put('cse_night_a')).body.version).toBe(1);
    // Session a is killed after writing the note, before reporting step 2.
    await brief(p.N, 'cse_night_b', 'night');
    expect((await night({ day: yday, action: 'start' }, 'cse_night_b')).body.resume_from).toBe(2);
    expect((await put('cse_night_b')).body.version).toBe(1);
    await night({ day: yday, action: 'step_done', step: 2 }, 'cse_night_b');
    await night({ day: yday, action: 'step_done', step: 3 }, 'cse_night_b');
    expect((await night({ day: yday, action: 'cursor', step: 4, cursor: 'msg:part-1' }, 'cse_night_b')).body).toEqual({
      resume_from: 4,
      done: false,
      cursor: 'msg:part-1',
      skipped: [],
    });
    // Session b is killed in step 4; the refire resumes at 4 with its cursor.
    await brief(p.N, 'cse_night_c', 'night');
    expect((await night({ day: yday, action: 'start' }, 'cse_night_c')).body).toEqual({
      resume_from: 4,
      done: false,
      cursor: 'msg:part-1',
      skipped: [],
    });
    expect((await coreSql('SELECT version FROM day_notes WHERE day = ?', yday))[0]).toEqual({ version: 1 });
  });

  it('the steps of later phases are skipped on the way, each with why', async () => {
    expect((await night({ day: yday, action: 'step_done', step: 4 }, 'cse_night_c')).body.resume_from).toBe(5);
    expect((await night({ day: yday, action: 'step_done', step: 5 }, 'cse_night_c')).body).toEqual({
      resume_from: 7,
      done: false,
      cursor: null,
      skipped: [6],
    });
    expect((await night({ day: yday, action: 'step_done', step: 7 }, 'cse_night_c')).body).toEqual({
      resume_from: 10,
      done: false,
      cursor: null,
      skipped: [6, 8, 9],
    });
    const r = await run(yday);
    expect(r.step).toBe(9);
    const steps = JSON.parse(r.steps_json);
    expect([steps[6].skipped, steps[8].skipped, steps[9].skipped]).toEqual(['later', 'later', 'later']);
    expect(steps[1]).toMatchObject({ done: true, session: 'cse_night_a' });
    expect(steps[4]).toMatchObject({ done: true, session: 'cse_night_c' });
  });

  it('done ends the session and its wake; the fallback after it is told at once and ends too', async () => {
    expect((await night({ day: yday, action: 'done' }, 'cse_night_c')).body).toEqual({
      resume_from: 11,
      done: true,
      cursor: null,
      skipped: [6, 8, 9],
    });
    const ended = async (session: string) => {
      const [s] = await coreSql<{ ended_at: number | null; wake_id: string }>(
        'SELECT ended_at, wake_id FROM mind_sessions WHERE session_id = ?',
        session,
      );
      const [w] = await coreSql('SELECT status, end_reason FROM wakes WHERE id = ?', s.wake_id);
      return { ended: s.ended_at !== null, wake: w };
    };
    expect(await ended('cse_night_c')).toEqual({ ended: true, wake: { status: 'ended', end_reason: 'night_done' } });
    expect((await run(yday)).done_at).not.toBeNull();
    // The 06:07 schedule's session: its briefing says the night is done and its wake ends at the
    // claim; its `th night start` (done at once) ends the session too.
    const late = await brief(p.N, 'cse_night_d', 'night');
    expect(late.body.night_done).toBe(true);
    expect(late.body.full).toContain(`night shift: ${yday} done`);
    expect(await ended('cse_night_d')).toEqual({ ended: false, wake: { status: 'ended', end_reason: 'night_done' } });
    const before = await run(yday);
    expect((await night({ day: yday, action: 'start' }, 'cse_night_d')).body).toMatchObject({
      resume_from: 11,
      done: true,
    });
    expect(await ended('cse_night_d')).toEqual({ ended: true, wake: { status: 'ended', end_reason: 'night_done' } });
    expect((await night({ day: yday, action: 'done' }, 'cse_night_d')).body.done).toBe(true);
    expect(await run(yday)).toEqual(before);
  });

  it('done before the last step is 409 unless the hard stop cut the run: then the rest is skipped', async () => {
    const d2 = dayBefore(today, 2);
    await brief(p.N, 'cse_night_e', 'night');
    await night({ day: d2, action: 'start' }, 'cse_night_e');
    await night({ day: d2, action: 'step_done', step: 1 }, 'cse_night_e');
    const early = await night({ day: d2, action: 'done' }, 'cse_night_e');
    expect(early.status).toBe(409);
    expect(early.body.error.details).toEqual({ resume_from: 2 });
    expect((await night({ day: d2, action: 'step_done', step: 2, partial: true }, 'cse_night_e')).status).toBe(422);
    expect((await night({ day: d2, action: 'done', partial: true }, 'cse_night_e')).body).toEqual({
      resume_from: 11,
      done: true,
      cursor: null,
      skipped: [2, 3, 4, 5, 6, 7, 8, 9],
    });
    const steps = JSON.parse((await run(d2)).steps_json);
    expect([2, 3, 4, 5, 6, 7, 8, 9].map((n) => steps[n].skipped)).toEqual([
      'hard_stop',
      'hard_stop',
      'hard_stop',
      'hard_stop',
      'later',
      'hard_stop',
      'later',
      'later',
    ]);
    expect(steps[10]).toMatchObject({ done: true, session: 'cse_night_e' });
  });

  it('works on a closed day of the last week only, from a claimed night session only', async () => {
    await brief(p.N, 'cse_night_f', 'night');
    for (const day of [today, dayBefore(today, 8), '2026-13-01x'])
      expect((await night({ day, action: 'start' }, 'cse_night_f')).status, day).toBe(422);
    const stray = await night({ day: dayBefore(today, 3), action: 'start' }, 'cse_never_claimed');
    expect(stray.status).toBe(403);
    expect(stray.body.error.code).toBe('session_required');
    expect((await night({ day: yday, action: 'start' }, CHAT_SESSION, p.C)).status).toBe(403);
    expect(await run(dayBefore(today, 3))).toBeUndefined();
  });
});
