// Schema steps for the Core object, P1 tables only (DATA.md §4.1, §9). Expand-only.
import type { Migration } from './base';

export const CORE_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'settings, changes, errors, perf_days',
    kind: 'expand',
    sql: [
      `CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        actor TEXT NOT NULL
      ) WITHOUT ROWID`,
      `CREATE TABLE changes (
        seq INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        ref TEXT,
        at INTEGER NOT NULL
      )`,
      `CREATE TABLE errors (
        fingerprint TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        route TEXT,
        code TEXT NOT NULL,
        message TEXT NOT NULL,
        count INTEGER NOT NULL,
        first_at INTEGER NOT NULL,
        last_at INTEGER NOT NULL,
        last_build INTEGER,
        resolved_at INTEGER
      ) WITHOUT ROWID`,
      `CREATE TABLE perf_days (
        day TEXT NOT NULL,
        metric TEXT NOT NULL,
        p50 REAL, p75 REAL, p95 REAL,
        n INTEGER NOT NULL,
        PRIMARY KEY (day, metric)
      ) WITHOUT ROWID`,
    ],
  },
];
