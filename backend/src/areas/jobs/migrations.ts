// Chunked alarm jobs (DATA.md §3, JOBS.md §4): the shared `jobs` table, first used by the import
// (P3), with its retention (§10).
import type { Migration, TableInfo } from '../../objects/base';
import { pruneJobs } from './store';

export const JOBS_MIGRATIONS: Migration[] = [
  {
    version: 12,
    name: 'jobs',
    kind: 'expand',
    sql: [
      `CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        state TEXT NOT NULL,
        due_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        cursor_json TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        rows_written INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) WITHOUT ROWID`,
      "CREATE INDEX jobs_due ON jobs (due_at) WHERE state IN ('queued', 'running', 'paused')",
    ],
  },
];

export const JOBS_TABLES: Record<string, TableInfo> = {
  jobs: { retention: '30 days after done or failed', backup: false, export: false, prune: pruneJobs },
};
