// SQL for backups, drills and exports (migrations.ts): counts and keys only, never content.
import type { BackupClass, BackupItem } from '../../../../shared/contract/backups.ts';
import { DAY } from '../../lib/time';
import type { Db } from '../../objects/base';

export type RunState = 'running' | 'complete' | 'failed';

export interface BackupRow {
  id: string;
  date: string;
  class: BackupClass;
  state: RunState;
  job_id: string;
  started_at: number;
  finished_at: number | null;
  rows: number;
  bytes: number;
  parts: number;
  manifest_key: string | null;
}

export const backupId = (date: string, cls: BackupClass) => `${date}/${cls}`;

export const backup = (db: Db, id: string) => db.one<BackupRow>('SELECT * FROM backups WHERE id = ?', id);

export function insertBackup(
  db: Db,
  r: { id: string; date: string; cls: BackupClass; job_id: string; at: number },
): void {
  db.run(
    `INSERT INTO backups (id, date, class, state, job_id, started_at) VALUES (?, ?, ?, 'running', ?, ?)
     ON CONFLICT (id) DO UPDATE SET state = 'running', job_id = excluded.job_id, started_at = excluded.started_at,
       finished_at = NULL, rows = 0, bytes = 0, parts = 0, manifest_key = NULL`,
    r.id,
    r.date,
    r.cls,
    r.job_id,
    r.at,
  );
}

export function progressBackup(db: Db, id: string, rows: number, bytes: number, parts: number): void {
  db.run('UPDATE backups SET rows = ?, bytes = ?, parts = ? WHERE id = ?', rows, bytes, parts, id);
}

export function finishBackup(db: Db, id: string, at: number, manifestKey: string): void {
  db.run("UPDATE backups SET state = 'complete', finished_at = ?, manifest_key = ? WHERE id = ?", at, manifestKey, id);
}

export function failBackup(db: Db, id: string, at: number): void {
  db.run("UPDATE backups SET state = 'failed', finished_at = ? WHERE id = ?", at, id);
}

/** The newest complete backup, if any (on the index `backups_done`). */
export const lastComplete = (db: Db) =>
  db.one<BackupRow>("SELECT * FROM backups WHERE state = 'complete' ORDER BY finished_at DESC LIMIT 1");

export const runningBackup = (db: Db) =>
  db.one<BackupRow>("SELECT * FROM backups WHERE state = 'running' ORDER BY started_at DESC LIMIT 1");

export function list(db: Db, limit: number): BackupItem[] {
  return db.all<BackupRow>('SELECT * FROM backups ORDER BY date DESC, class LIMIT ?', limit).map((r) => ({
    date: r.date,
    class: r.class,
    rows: r.rows,
    bytes: r.bytes,
    complete: r.state === 'complete',
    started_at: r.started_at,
    finished_at: r.finished_at,
  }));
}

export interface DrillRow {
  month: string;
  backup_date: string;
  state: 'running' | 'passed' | 'failed';
  job_id: string;
  started_at: number;
  finished_at: number | null;
  report_key: string | null;
  problems: number;
}

export const drill = (db: Db, month: string) => db.one<DrillRow>('SELECT * FROM drills WHERE month = ?', month);
export const lastDrill = (db: Db) =>
  db.one<DrillRow>("SELECT * FROM drills WHERE state != 'running' ORDER BY finished_at DESC LIMIT 1");

export function insertDrill(db: Db, r: { month: string; backup_date: string; job_id: string; at: number }): void {
  db.run(
    `INSERT INTO drills (month, backup_date, state, job_id, started_at) VALUES (?, ?, 'running', ?, ?)
     ON CONFLICT (month) DO UPDATE SET backup_date = excluded.backup_date, state = 'running', job_id = excluded.job_id,
       started_at = excluded.started_at, finished_at = NULL, report_key = NULL, problems = 0`,
    r.month,
    r.backup_date,
    r.job_id,
    r.at,
  );
}

export function finishDrill(
  db: Db,
  month: string,
  passed: boolean,
  at: number,
  reportKey: string | null,
  problems: number,
): void {
  db.run(
    'UPDATE drills SET state = ?, finished_at = ?, report_key = ?, problems = ? WHERE month = ?',
    passed ? 'passed' : 'failed',
    at,
    reportKey,
    problems,
    month,
  );
}

export interface ExportFile {
  /** The name inside the ZIP. */
  name: string;
  /** Where its deflated bytes are in the bucket. */
  key: string;
  crc: number;
  size: number;
  csize: number;
}

export interface ExportRow {
  id: string;
  state: 'building' | 'ready' | 'failed' | 'expired';
  job_id: string;
  session_id: string | null;
  created_at: number;
  ready_at: number | null;
  expires_at: number | null;
  progress: number;
  bytes: number;
  files_json: string;
}

export const exportRow = (db: Db, id: string) => db.one<ExportRow>('SELECT * FROM exports WHERE id = ?', id);
export const buildingExport = (db: Db) =>
  db.one<ExportRow>("SELECT * FROM exports WHERE state = 'building' ORDER BY created_at DESC LIMIT 1");

export function insertExport(db: Db, r: { id: string; job_id: string; session_id: string | null; at: number }): void {
  db.run(
    "INSERT INTO exports (id, state, job_id, session_id, created_at) VALUES (?, 'building', ?, ?, ?)",
    r.id,
    r.job_id,
    r.session_id,
    r.at,
  );
}

export function progressExport(db: Db, id: string, progress: number, files: ExportFile[]): void {
  db.run('UPDATE exports SET progress = ?, files_json = ? WHERE id = ?', progress, JSON.stringify(files), id);
}

export function readyExport(db: Db, id: string, at: number, ttl: number, bytes: number, files: ExportFile[]): void {
  db.run(
    "UPDATE exports SET state = 'ready', ready_at = ?, expires_at = ?, progress = 100, bytes = ?, files_json = ? WHERE id = ?",
    at,
    at + ttl,
    bytes,
    JSON.stringify(files),
    id,
  );
}

export function failExport(db: Db, id: string): void {
  db.run("UPDATE exports SET state = 'failed' WHERE id = ?", id);
}

/** Ready exports past their hour, whose files the tick removes from the bucket. */
export const expiredExports = (db: Db, now: number) =>
  db.all<ExportRow>(
    "SELECT * FROM exports WHERE state IN ('ready', 'failed') AND coalesce(expires_at, created_at + 86400000) < ? LIMIT 20",
    now,
  );

export function markExpired(db: Db, id: string): void {
  db.run("UPDATE exports SET state = 'expired', files_json = '[]' WHERE id = ?", id);
}

/** An export row goes a day after it expired (its files are gone by then). */
export function pruneExports(db: Db, now: number, max: number): number {
  return db.all(
    `DELETE FROM exports WHERE id IN (SELECT id FROM exports WHERE state = 'expired' AND coalesce(expires_at, created_at) < ? LIMIT ?) RETURNING 1`,
    now - DAY,
    max,
  ).length;
}
