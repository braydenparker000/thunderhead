// The feed area's schema step (DATA.md §4.1) and its tables' retention (§10). `changes` itself
// is in the P1 base step.
import type { Migration, TableInfo } from '../../objects/base';
import { pruneChanges, pruneTickets } from './store';

/** The feed keeps this many rows; a client further behind resyncs (API.md §12). */
export const KEEP_CHANGES = 10_000;

export const FEED_MIGRATIONS: Migration[] = [
  {
    version: 3,
    name: 'live tickets',
    kind: 'expand',
    sql: [
      `CREATE TABLE live_tickets (
        hash TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      ) WITHOUT ROWID`,
    ],
  },
];

export const FEED_TABLES: Record<string, TableInfo> = {
  changes: {
    retention: 'newest 10,000 rows',
    backup: false,
    export: false,
    prune: (db, _now, max) => pruneChanges(db, KEEP_CHANGES, max),
  },
  live_tickets: { retention: '1 h after expires_at', backup: false, export: false, prune: pruneTickets },
};
