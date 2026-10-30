// The night shift's predictions (P9, EVALS.md M-18): one row each, resolved by a fixed resolver
// once its day is over, with the base rate it is scored against.
import type { Migration, TableInfo } from '../../objects/base';

export const PREDICTIONS_MIGRATIONS: Migration[] = [
  {
    version: 20,
    name: 'predictions',
    kind: 'expand',
    sql: [
      `CREATE TABLE predictions (
        id TEXT PRIMARY KEY,
        made_at INTEGER NOT NULL,
        made_by TEXT NOT NULL,
        category TEXT NOT NULL,
        args_json TEXT NOT NULL,
        day TEXT NOT NULL,
        p REAL NOT NULL,
        why TEXT NOT NULL,
        outcome INTEGER,
        base REAL,
        resolved_at INTEGER,
        req_sha256 TEXT NOT NULL
      ) WITHOUT ROWID`,
      'CREATE INDEX predictions_open ON predictions (day) WHERE resolved_at IS NULL',
      'CREATE INDEX predictions_category ON predictions (category, resolved_at)',
      'CREATE INDEX predictions_made ON predictions (made_at)',
    ],
  },
];

export const PREDICTIONS_TABLES: Record<string, TableInfo> = {
  predictions: { retention: 'forever (at most 12 rows a day; the meter reads them all)', backup: true, export: true },
};
