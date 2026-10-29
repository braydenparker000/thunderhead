// Backups, drills and exports (DATA.md §11, OPERATIONS.md §4.4, MENU-AND-SETTINGS.md §4.9): one
// row per weekly backup (`<date>/<class>`, its counts once the manifest is written), one per
// monthly drill (its result and where its report is), and one per "download everything" (the
// ZIP's files with their CRC-32 and sizes, so the download streams it without building it twice).
// The bucket holds the data; these rows hold counts and keys only.
import type { Migration, TableInfo } from '../../objects/base';
import { pruneExports } from './store';

export const BACKUPS_MIGRATIONS: Migration[] = [
  {
    version: 18,
    name: 'backups',
    kind: 'expand',
    sql: [
      `CREATE TABLE backups (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        class TEXT NOT NULL,
        state TEXT NOT NULL,
        job_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        rows INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL DEFAULT 0,
        parts INTEGER NOT NULL DEFAULT 0,
        manifest_key TEXT
      ) WITHOUT ROWID`,
      'CREATE INDEX backups_done ON backups (state, finished_at)',
      `CREATE TABLE drills (
        month TEXT PRIMARY KEY,
        backup_date TEXT NOT NULL,
        state TEXT NOT NULL,
        job_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        report_key TEXT,
        problems INTEGER NOT NULL DEFAULT 0
      ) WITHOUT ROWID`,
      `CREATE TABLE exports (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        job_id TEXT NOT NULL,
        session_id TEXT,
        created_at INTEGER NOT NULL,
        ready_at INTEGER,
        expires_at INTEGER,
        progress INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL DEFAULT 0,
        files_json TEXT NOT NULL DEFAULT '[]'
      ) WITHOUT ROWID`,
    ],
  },
];

export const BACKUPS_TABLES: Record<string, TableInfo> = {
  backups: { retention: 'forever (one row a week, counts only)', backup: true, export: false },
  drills: { retention: 'forever (one row a month, counts only)', backup: true, export: false },
  exports: {
    retention: '1 day after it expires (its files go from the bucket with it)',
    backup: false,
    export: false,
    prune: pruneExports,
  },
};
