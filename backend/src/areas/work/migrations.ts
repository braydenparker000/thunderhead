// Work orders and Muse's thread (MUSE.md §3.1, §2): one row per order with its spec, state, lease
// and the validated result; Muse's notes (and the mind's or the owner's replies) in their own
// table, never in the owner's conversation. Muse's results are outside text wherever they go.
import type { Migration, TableInfo } from '../../objects/base';
import { pruneNotes, pruneOrders } from './store';

export const WORK_MIGRATIONS: Migration[] = [
  {
    version: 19,
    name: 'work orders',
    kind: 'expand',
    sql: [
      `CREATE TABLE work_orders (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        assignee TEXT NOT NULL,
        title TEXT NOT NULL,
        spec_json TEXT NOT NULL,
        personal INTEGER NOT NULL DEFAULT 0,
        approval_id TEXT,
        recurrence TEXT,
        day TEXT,
        deadline_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        claimed_at INTEGER,
        heartbeat_at INTEGER,
        heartbeat_note TEXT,
        result_json TEXT,
        result_valid INTEGER,
        result_errors_json TEXT,
        finished_at INTEGER
      ) WITHOUT ROWID`,
      'CREATE INDEX work_orders_open ON work_orders (status, created_at)',
      'CREATE INDEX work_orders_kind_day ON work_orders (kind, day)',
      `CREATE TABLE muse_notes (
        seq INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        author TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    ],
  },
];

export const WORK_TABLES: Record<string, TableInfo> = {
  work_orders: {
    retention: '1 year after finished (a Board edition a day, its result with it)',
    backup: true,
    export: true,
    prune: pruneOrders,
  },
  muse_notes: { retention: 'newest 500 notes', backup: true, export: true, prune: pruneNotes },
};
