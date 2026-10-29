// The chunked job runner (JOBS.md §4), run from Core's alarm: the job due first, one step at a
// time, at most 5 steps or 1 s an alarm. A step is the handler's async `load` (an R2 read,
// outside any transaction) and then its synchronous `step` inside one commit with the job's new
// cursor, so a step is all or nothing and a crash resumes from the stored cursor. A failure
// retries after 1 min, 5 min, 30 min, 2 h, 12 h (or the handler's own limit), then fails the job.
// Lane jobs share the bulk lane's 40,000 rows a day (DATA.md §8.3) and pause until 00:05 UTC past
// it. `last_error` keeps a code and the error's name only, never a message that could hold data.
import { DAY, MINUTE, utcDay } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import * as settings from '../settings/store';
import * as store from './store';

/** A failure with a code from the job's own fixed list (e.g. `missing_part`). */
export class JobError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export interface JobHandler {
  kind: string;
  /** Uses the bulk lane and its cap. */
  lane: boolean;
  /** Failures in a row before the job fails (default 6: five retries). */
  maxAttempts?: number;
  /** What the step needs from outside the object (R2), read before its transaction. */
  load(env: Env, db: Db, payload: unknown, cursor: unknown): Promise<unknown>;
  /** One all-or-nothing step: its writes, then the next cursor or done. */
  step(w: Writer, payload: unknown, cursor: unknown, input: unknown): { next: unknown } | { done: true };
  /** The job failed for good: what the area records about it. */
  failed?(w: Writer, payload: unknown, code: string): void;
}

export interface JobHost {
  env: Env;
  db: Db;
  write<T>(fn: (w: Writer) => T, at?: number): T;
}

export const LANE_ROWS_PER_DAY = 40_000;
const RETRY_MS = [MINUTE, 5 * MINUTE, 30 * MINUTE, 120 * MINUTE, 720 * MINUTE];
const STEPS_PER_ALARM = 5;
const WALL_MS = 1_000;

interface Lane {
  day: string;
  rows: number;
}
const lane = (db: Db, now: number): Lane => {
  const l = settings.getSetting(db, 'bulk.day') as Lane | undefined;
  return l && l.day === utcDay(now) ? l : { day: utcDay(now), rows: 0 };
};
/** 00:05 UTC of the next day, when the lane opens again. */
const nextLaneDay = (now: number) => Date.parse(`${utcDay(now + DAY)}T00:05:00Z`);

/** Runs due jobs; returns how many steps ran. */
export async function runJobs(host: JobHost, handlers: Record<string, JobHandler>, now = Date.now()): Promise<number> {
  const started = Date.now();
  let steps = 0;
  while (steps < STEPS_PER_ALARM && Date.now() - started < WALL_MS) {
    const job = store.firstDue(host.db, now);
    if (!job) break;
    const h = handlers[job.kind];
    if (!h) {
      host.write((w) => fail(w, job, 'unknown_kind', undefined));
      continue;
    }
    if (h.lane && lane(host.db, now).rows >= LANE_ROWS_PER_DAY) {
      host.write((w) =>
        store.updateJob(w.db, job.id, { ...same(job), state: 'paused', due_at: nextLaneDay(now), rows: 0, at: now }),
      );
      continue;
    }
    steps++;
    const payload = JSON.parse(job.payload_json) as unknown;
    const cursor = job.cursor_json === null ? null : (JSON.parse(job.cursor_json) as unknown);
    let input: unknown;
    try {
      input = await h.load(host.env, host.db, payload, cursor);
    } catch (e) {
      host.write((w) => retry(w, job, h, codeOf(e, 'load_failed'), now));
      continue;
    }
    try {
      host.write((w) => {
        // Only the alarm moves a job, but check: the cursor this step loaded for is still the job's.
        const fresh = store.job(w.db, job.id);
        if (!fresh || fresh.cursor_json !== job.cursor_json || fresh.state === 'done' || fresh.state === 'failed')
          return;
        const before = w.db.meter.rowsWritten;
        const r = h.step(w, payload, cursor, input);
        const rows = w.db.meter.rowsWritten - before;
        const done = 'done' in r;
        store.updateJob(w.db, job.id, {
          state: done ? 'done' : 'running',
          due_at: now,
          cursor: done ? undefined : r.next,
          attempts: 0,
          last_error: null,
          rows,
          at: now,
        });
        if (h.lane) {
          const l = lane(w.db, now);
          settings.putSetting(w.db, 'bulk.day', { day: l.day, rows: l.rows + rows }, 'worker', now);
        }
      }, now);
    } catch (e) {
      host.write((w) => retry(w, job, h, codeOf(e, 'step_failed'), now));
    }
  }
  return steps;
}

const same = (j: store.JobRow) => ({ attempts: j.attempts, last_error: j.last_error });
const codeOf = (e: unknown, fallback: string) =>
  e instanceof JobError ? e.code : `${fallback}:${(e as Error)?.name ?? 'Error'}`.slice(0, 60);

function retry(w: Writer, job: store.JobRow, h: JobHandler, code: string, now: number): void {
  const attempts = job.attempts + 1;
  if (attempts >= (h.maxAttempts ?? RETRY_MS.length + 1)) return fail(w, { ...job, attempts }, code, h);
  const delay = RETRY_MS[Math.min(attempts - 1, RETRY_MS.length - 1)];
  store.updateJob(w.db, job.id, {
    state: job.state,
    due_at: now + delay,
    attempts,
    last_error: code,
    rows: 0,
    at: now,
  });
}

function fail(w: Writer, job: store.JobRow, code: string, h: JobHandler | undefined): void {
  store.updateJob(w.db, job.id, {
    state: 'failed',
    due_at: job.due_at,
    attempts: job.attempts,
    last_error: code,
    rows: 0,
    at: w.at,
  });
  h?.failed?.(w, JSON.parse(job.payload_json), code);
}
