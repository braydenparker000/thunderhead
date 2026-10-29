// The eval record (EVALS.md §8): one row per finished suite, numbers and ids only, in the owner's
// Core. The sandbox's own state (its seed, what was tried) lives in the sandbox instance and is
// wiped by each reset.
import type { Migration, TableInfo } from '../../objects/base';

export const EVALS_MIGRATIONS: Migration[] = [
  {
    version: 16,
    name: 'eval_runs',
    kind: 'expand',
    sql: [
      `CREATE TABLE eval_runs (
        id TEXT PRIMARY KEY,
        at INTEGER NOT NULL,
        suite TEXT NOT NULL,
        git_sha TEXT NOT NULL,
        n INTEGER NOT NULL,
        passed INTEGER NOT NULL,
        score REAL NOT NULL,
        failures_json TEXT NOT NULL,
        skipped_json TEXT NOT NULL,
        judged INTEGER NOT NULL DEFAULT 0,
        session_id TEXT,
        req_sha256 TEXT
      ) WITHOUT ROWID`,
      'CREATE INDEX eval_runs_suite ON eval_runs (suite, at)',
    ],
  },
];

export const EVALS_TABLES: Record<string, TableInfo> = {
  eval_runs: { retention: 'forever (one row per suite a week)', backup: true, export: false },
};
