// SQL for chunked alarm jobs (DATA.md §3, JOBS.md §4): one row per job with its state, when it is
// due, its payload and the cursor its last step stored. Stores never write the change feed.
import { DAY } from '../../lib/time';
import type { Db } from '../../objects/base';

export type JobState = 'queued' | 'running' | 'paused' | 'done' | 'failed';
export interface JobRow {
  id: string;
  kind: string;
  state: JobState;
  due_at: number;
  payload_json: string;
  cursor_json: string | null;
  attempts: number;
  last_error: string | null;
  rows_written: number;
  created_at: number;
  updated_at: number;
}

const COLS =
  'id, kind, state, due_at, payload_json, cursor_json, attempts, last_error, rows_written, created_at, updated_at';
const RUNNABLE = "state IN ('queued', 'running', 'paused')";

export function job(db: Db, id: string): JobRow | null {
  return db.one<JobRow>(`SELECT ${COLS} FROM jobs WHERE id = ?`, id);
}

export function insertJob(db: Db, j: { id: string; kind: string; payload: unknown; at: number }): void {
  db.run(
    `INSERT INTO jobs (id, kind, state, due_at, payload_json, cursor_json, attempts, rows_written, created_at, updated_at)
     VALUES (?, ?, 'queued', ?, ?, NULL, 0, 0, ?, ?)`,
    j.id,
    j.kind,
    j.at,
    JSON.stringify(j.payload),
    j.at,
    j.at,
  );
}

/** The job due first, on the partial index `jobs_due`. */
export function firstDue(db: Db, now: number): JobRow | null {
  return db.one<JobRow>(`SELECT ${COLS} FROM jobs WHERE ${RUNNABLE} AND due_at <= ? ORDER BY due_at LIMIT 1`, now);
}

/** When the alarm must next run for a job (null: none waits). */
export function nextDue(db: Db): number | null {
  return db.one<{ t: number | null }>(`SELECT min(due_at) AS t FROM jobs WHERE ${RUNNABLE}`)?.t ?? null;
}

export function backlog(db: Db): number {
  return db.one<{ n: number }>(`SELECT count(*) AS n FROM jobs WHERE ${RUNNABLE}`)?.n ?? 0;
}

export function updateJob(
  db: Db,
  id: string,
  u: {
    state: JobState;
    due_at: number;
    cursor?: unknown;
    attempts: number;
    last_error: string | null;
    rows: number;
    at: number;
  },
): void {
  db.run(
    `UPDATE jobs SET state = ?, due_at = ?, cursor_json = coalesce(?, cursor_json), attempts = ?, last_error = ?,
       rows_written = rows_written + ?, updated_at = ? WHERE id = ?`,
    u.state,
    u.due_at,
    u.cursor === undefined ? null : JSON.stringify(u.cursor),
    u.attempts,
    u.last_error,
    u.rows,
    u.at,
    id,
  );
}

/** A finished or failed job goes 30 days after its last change (DATA.md §10). */
export function pruneJobs(db: Db, now: number, max: number): number {
  return db.all(
    `DELETE FROM jobs WHERE id IN (SELECT id FROM jobs WHERE state IN ('done', 'failed') AND updated_at < ? LIMIT ?) RETURNING 1`,
    now - 30 * DAY,
    max,
  ).length;
}
