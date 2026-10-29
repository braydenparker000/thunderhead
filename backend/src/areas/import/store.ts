// SQL for the import's own tables (DATA.md §4.4): the runs and the raw imported documents.
// Stores never write the change feed.
import type { ImportCounts, ImportDataset, ImportState, ImportStatus } from '../../../../shared/contract/api';
import { DAY } from '../../lib/time';
import type { Db } from '../../objects/base';

export interface ImportRow {
  id: string;
  run_id: string;
  dataset: ImportDataset;
  state: ImportState;
  counts_json: string;
  report_json: string | null;
  started_at: number;
  finished_at: number | null;
  job_id: string | null;
  last_error: string | null;
}

/** What a run counts as it goes; `rows_changed` is kept for the report. */
export interface RunCounts extends ImportCounts {
  rows_changed: number;
}

const COLS = 'id, run_id, dataset, state, counts_json, report_json, started_at, finished_at, job_id, last_error';

export function importRow(db: Db, id: string): ImportRow | null {
  return db.one<ImportRow>(`SELECT ${COLS} FROM imports WHERE id = ?`, id);
}

export function insertImport(
  db: Db,
  r: {
    id: string;
    run_id: string;
    dataset: ImportDataset;
    prefix: string;
    counts: RunCounts;
    job_id: string;
    at: number;
  },
): void {
  db.run(
    `INSERT INTO imports (id, source, dataset, r2_prefix, state, counts_json, started_at, run_id, job_id)
     VALUES (?, 'old_worker', ?, ?, 'queued', ?, ?, ?, ?)`,
    r.id,
    r.dataset,
    r.prefix,
    JSON.stringify(r.counts),
    r.at,
    r.run_id,
    r.job_id,
  );
}

export function setImport(
  db: Db,
  id: string,
  u: {
    state: ImportState;
    counts?: RunCounts;
    report?: unknown;
    finished_at?: number | null;
    last_error?: string | null;
  },
): void {
  db.run(
    `UPDATE imports SET state = ?, counts_json = coalesce(?, counts_json), report_json = coalesce(?, report_json),
       finished_at = coalesce(?, finished_at), last_error = ? WHERE id = ?`,
    u.state,
    u.counts ? JSON.stringify(u.counts) : null,
    u.report === undefined ? null : JSON.stringify(u.report),
    u.finished_at ?? null,
    u.last_error ?? null,
    id,
  );
}

/** Whether a run of this dataset of this export run is still going, on `imports_run`. */
export function going(db: Db, runId: string, dataset: string): boolean {
  return (
    (db.one<{ n: number }>(
      "SELECT count(*) AS n FROM imports WHERE run_id = ? AND dataset = ? AND state IN ('queued', 'running', 'verifying')",
      runId,
      dataset,
    )?.n ?? 0) > 0
  );
}

/** Whether this dataset of this export run finished before (another import id), on `imports_run`. */
export function doneBefore(db: Db, runId: string, dataset: string, except: string): boolean {
  return (
    (db.one<{ n: number }>(
      "SELECT count(*) AS n FROM imports WHERE run_id = ? AND dataset = ? AND state = 'done' AND id != ?",
      runId,
      dataset,
      except,
    )?.n ?? 0) > 0
  );
}

export function toStatus(r: ImportRow): ImportStatus {
  const { rows_changed: _changed, ...counts } = JSON.parse(r.counts_json) as RunCounts;
  return {
    id: r.id,
    run_id: r.run_id,
    dataset: r.dataset,
    state: r.state,
    counts,
    report: r.report_json ? (JSON.parse(r.report_json) as ImportStatus['report']) : null,
    last_error: r.last_error,
    started_at: r.started_at,
    finished_at: r.finished_at,
  };
}

// --- raw imported documents ------------------------------------------------------------------

export interface ItemRow {
  id: string;
  run_id: string;
  dataset: string;
  key: string;
  body_json: string;
  converted_at: number | null;
}

export function item(db: Db, id: string): ItemRow | null {
  return db.one<ItemRow>('SELECT id, run_id, dataset, key, body_json, converted_at FROM import_items WHERE id = ?', id);
}

/** Puts a document by its id; a run that finds the same body writes nothing. Returns rows written. */
export function putItem(db: Db, i: { id: string; run_id: string; dataset: string; key: string; body: string }): number {
  return db.run(
    `INSERT INTO import_items (id, run_id, dataset, key, body_json) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET body_json = excluded.body_json, run_id = excluded.run_id
     WHERE import_items.body_json IS NOT excluded.body_json`,
    i.id,
    i.run_id,
    i.dataset,
    i.key,
    i.body,
  );
}

/** A document the mind converted goes 30 days later (DATA.md §4.4). */
export function pruneItems(db: Db, now: number, max: number): number {
  return db.all(
    `DELETE FROM import_items WHERE id IN
       (SELECT id FROM import_items WHERE converted_at IS NOT NULL AND converted_at < ? LIMIT ?) RETURNING 1`,
    now - 30 * DAY,
    max,
  ).length;
}
