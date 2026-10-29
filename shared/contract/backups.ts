// Backups, the restore drill and "download everything" (DATA.md §11, OPERATIONS.md §4.4,
// MENU-AND-SETTINGS.md §4.9): what the Worker writes to the private bucket and what the routes
// answer. A backup is complete only once its manifest is written, and it is written last.

export const BACKUP_LIMITS = {
  /** Rows per part file (JOBS.md §4.4 `export.weekly`). */
  part_rows: 5_000,
  /** Local time the weekly backup starts on Sundays. */
  weekly_local: '02:30',
  /** A table over this many rows is restored in the drill as every k-th row (DATA.md §11.4). */
  drill_sample_over: 30_000,
  /** `backup.stale`: the newest complete backup is older than this. */
  stale_days: 8,
  /** `drill.overdue`: no drill for this long (once a backup exists). */
  drill_overdue_days: 35,
  /** A download link (the export's ZIP) lives this long once ready. */
  export_ttl_min: 60,
} as const;

export type BackupClass = 'core';

export interface BackupPart {
  key: string;
  rows: number;
  bytes: number;
  sha256: string;
}

export interface BackupTable {
  name: string;
  rows: number;
  parts: BackupPart[];
}

/** `backups/<date>/<class>/manifest.json` (DATA.md §11.2). */
export interface BackupManifest {
  v: 1;
  date: string;
  class: BackupClass;
  schema_version: number;
  bookmark: string | null;
  started_at: number;
  finished_at: number;
  tables: BackupTable[];
}

/** One row of `GET /v1/ops/backups`. */
export interface BackupItem {
  date: string;
  class: BackupClass;
  rows: number;
  bytes: number;
  complete: boolean;
  started_at: number;
  finished_at: number | null;
}

/** `POST /v1/ops/backups/run`: the backup job started (or the one already running today). */
export interface BackupRunResponse {
  job_ids: string[];
}

/** `POST /v1/ops/drill/run`. */
export interface DrillRunResponse {
  job_id: string;
}

/** One table's line in the drill report. */
export interface DrillTable {
  name: string;
  /** Rows the manifest lists, and the rows the drill should find (the sample, above 30,000). */
  rows: number;
  expected: number;
  restored: number;
  sampled: boolean;
  /** Every part's SHA-256 matched the manifest. */
  parts_ok: boolean;
}

/** `drills/<YYYY-MM>/report.json`: counts and names only. */
export interface DrillReport {
  v: 1;
  month: string;
  backup_date: string;
  started_at: number;
  finished_at: number;
  passed: boolean;
  tables: DrillTable[];
  problems: string[];
}

/** `POST /v1/export`: the password again (step-up, MENU-AND-SETTINGS.md §4.9). */
export interface ExportStartRequest {
  password: string;
}

export interface ExportStartResponse {
  export_id: string;
}

/** `GET /v1/export/:id`. While building, `progress` runs 0–100; once ready, one item: the ZIP,
 * downloaded from `url` (with the device's sign-in) until `expires_at`. */
export interface ExportStatus {
  status: 'building' | 'ready' | 'failed' | 'expired';
  progress: number;
  items: { label: string; url: string; bytes: number; expires_at: number }[];
  /** The newest complete automatic backup, for the page's line. */
  last_backup: { date: string; finished_at: number } | null;
}
