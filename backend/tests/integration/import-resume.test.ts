// The import job's resume and lane (TESTING.md §8, JOBS.md §4): a seeded export of 50 old chats
// and 2,000 messages is imported twice under two sets of old ids, once straight through and once
// with the job killed inside its third step (a throw after the step's writes, so its transaction
// rolls back); resumed, the killed run ends in the same state as the straight one, counted once.
// A run past the bulk lane's 40,000 rows a day pauses until 00:05 UTC and then finishes.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ImportStatus } from '../../../shared/contract/api';
import { importJob } from '../../src/areas/import/job';
import type { JobHandler } from '../../src/areas/jobs/runner';
import { importedId, uuidv7 } from '../../src/lib/ids';
import { utcDay } from '../../src/lib/time';
import { apiJson, coreSql } from '../helpers';
import { exportRun, oldChats, parts, runJobsWith, untilDone } from '../import-helpers';
import { type Principals, principals } from '../memory-helpers';

let p: Principals;
const MINUTE = 60_000;
const REAL = { [importJob.kind]: importJob };
const start = async (run: string, dataset: string) =>
  (
    await apiJson<{ import_id: string }>('POST', '/v1/import/runs', {
      token: p.D,
      body: { id: uuidv7(), run_id: run, dataset },
    })
  ).body.import_id;
const status = async (id: string) => (await apiJson<ImportStatus>('GET', `/v1/import/runs/${id}`, { token: p.D })).body;

async function exportChats(run: string, prefix: string) {
  const { threads, messages } = oldChats(prefix, 7);
  await exportRun(p.C, run, {
    'claude-chat-v1/cc_threads': [threads],
    'claude-chat-v1/cc_messages': parts(messages, 700),
  });
  return threads;
}

/** What a run wrote, without its ids: each thread and its messages in order, replies by time. */
async function state(prefix: string, threads: { id: string; created_ms: number }[]) {
  const ids = await Promise.all(threads.map((t) => importedId('threads', t.id, t.created_ms)));
  const one = async (id: string) => ({
    thread: (
      await coreSql(
        'SELECT kind, status, title, day, started_at, filed_at, message_count FROM threads WHERE id = ?',
        id,
      )
    )[0],
    messages: await coreSql(
      `SELECT m.created_at, m.author, m.origin, m.kind, m.body, r.created_at AS reply_at, m.delivered_at,
         m.answered_at FROM messages m LEFT JOIN messages r ON r.id = m.reply_to WHERE m.thread_id = ?
       ORDER BY m.created_at`,
      id,
    ),
  });
  const out = [];
  for (const id of ids) out.push(await one(id));
  expect(out.length, prefix).toBe(50);
  return out;
}
const same = (s: ImportStatus) => ({
  state: s.state,
  counts: s.counts,
  last_error: s.last_error,
  checked: s.report?.spot_checks.checked,
  passed: s.report?.spot_checks.passed,
  shapes: s.report?.thread_shapes,
  rows_changed: s.report?.rows_changed,
});

beforeAll(async () => {
  p = await principals();
});

describe('a killed import resumes', () => {
  it('to the state of a run straight through, across four steps, counting each row once', async () => {
    const a = await exportChats('run-a', 'a');
    expect((await untilDone(p.D, await start('run-a', 'threads'))).state).toBe('done');
    const straight = await untilDone(p.D, await start('run-a', 'messages'));
    expect(straight).toMatchObject({
      state: 'done',
      counts: { expected: 2_000, skipped: 31, skip_reasons: { empty: 21, invalid_ref: 10 } },
      report: { spot_checks: { checked: 20, passed: 20, failed: [] }, thread_shapes: { checked: 50, failed: [] } },
    });

    const b = await exportChats('run-b', 'b');
    expect((await untilDone(p.D, await start('run-b', 'threads'))).state).toBe('done');
    const id = await start('run-b', 'messages');
    let steps = 0;
    const killer: JobHandler = {
      ...importJob,
      step(w, payload, cursor, input) {
        const r = importJob.step(w, payload, cursor, input);
        if (++steps === 3) throw new Error('killed');
        return r;
      },
    };
    for (let i = 0; i < 10 && steps < 3; i++) await runJobsWith({ import: killer });
    const [job] = await coreSql<{ attempts: number; last_error: string; cursor_json: string; rows_written: number }>(
      'SELECT j.attempts, j.last_error, j.cursor_json, j.rows_written FROM jobs j JOIN imports i ON i.job_id = j.id WHERE i.id = ?',
      id,
    );
    expect(job).toMatchObject({ attempts: 1, last_error: 'step_failed:Error' });
    expect(JSON.parse(job.cursor_json)).toMatchObject({ phase: 'rows', part: 3 });
    const killed = await status(id);
    expect(killed.state).toBe('running');
    expect(killed.counts.imported + killed.counts.skipped).toBe(1_400);

    // Resumed after the retry's minute, with the real handler.
    for (let i = 0; i < 10 && (await status(id)).state !== 'done'; i++)
      await runJobsWith(REAL, Date.now() + 2 * MINUTE);
    const resumed = await status(id);
    expect(same(resumed)).toEqual(same(straight));
    expect(await state('b', b)).toEqual(await state('a', a));
    const dangling = await coreSql(
      `SELECT m.id FROM messages m WHERE m.origin = 'import' AND m.reply_to IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM messages r WHERE r.id = m.reply_to)`,
    );
    expect(dangling).toEqual([]);
  });
});

describe('the bulk lane', () => {
  it('pauses a run past 40,000 rows today until 00:05 UTC, then finishes it', async () => {
    const { threads } = oldChats('l', 11, 10, 0);
    await exportRun(p.C, 'run-lane', { 'claude-chat-v1/cc_threads': [threads] });
    const id = await start('run-lane', 'threads');
    const now = Date.now();
    await coreSql(
      `INSERT INTO settings (key, value_json, updated_at, actor) VALUES ('bulk.day', ?, ?, 'worker')
       ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
      JSON.stringify({ day: utcDay(now), rows: 40_000 }),
      now,
    );
    await runJobsWith(REAL, now);
    const [job] = await coreSql<{ state: string; due_at: number }>(
      'SELECT j.state, j.due_at FROM jobs j JOIN imports i ON i.job_id = j.id WHERE i.id = ?',
      id,
    );
    const opens = Date.parse(`${utcDay(now + 86_400_000)}T00:05:00Z`);
    expect(job).toEqual({ state: 'paused', due_at: opens });
    expect((await status(id)).counts.imported).toBe(0);

    for (let i = 0; i < 5 && (await status(id)).state !== 'done'; i++) await runJobsWith(REAL, opens);
    expect(await status(id)).toMatchObject({ state: 'done', counts: { expected: 10, imported: 10 } });
    const [lane] = await coreSql<{ value_json: string }>("SELECT value_json FROM settings WHERE key = 'bulk.day'");
    expect(JSON.parse(lane.value_json)).toMatchObject({ day: utcDay(opens) });
  });
});
