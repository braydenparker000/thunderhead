// The watchdogs' state (OPERATIONS.md §8.2): one row per watchdog that has run, so a trip writes
// one ledger note and the next one only after it has cleared. `snapshot_json` is what a check
// compares with on its next run (the error counts of the last hour, counts only). The reflex's
// report on a trip is kept with it.
import type { Migration, TableInfo } from '../../objects/base';

export const WATCHDOGS_MIGRATIONS: Migration[] = [
  {
    version: 17,
    name: 'watchdogs',
    kind: 'expand',
    sql: [
      `CREATE TABLE watchdogs (
        name TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        since INTEGER,
        detail TEXT,
        trips INTEGER NOT NULL DEFAULT 0,
        checked_at INTEGER NOT NULL,
        snapshot_json TEXT,
        handled_at INTEGER,
        handled_outcome TEXT,
        handled_note TEXT
      ) WITHOUT ROWID`,
    ],
  },
];

export const WATCHDOGS_TABLES: Record<string, TableInfo> = {
  watchdogs: { retention: 'forever (one row per watchdog)', backup: true, export: true },
};
