// Verbs queued for a phone (DATA.md §4.3), with retention (§10). `error_json` holds a failed
// result's code (e.g. `unsupported_verb`).
import type { Migration, TableInfo } from '../../objects/base';
import { prune } from './store';

export const VERBS_MIGRATIONS: Migration[] = [
  {
    version: 6,
    name: 'verbs',
    kind: 'expand',
    sql: [
      `CREATE TABLE verbs (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        actor TEXT NOT NULL,
        verb TEXT NOT NULL,
        schema INTEGER NOT NULL,
        ref TEXT,
        args_json TEXT NOT NULL,
        device_id TEXT,
        status TEXT NOT NULL,
        proposal_id TEXT,
        ledger_id TEXT,
        expires_at INTEGER NOT NULL,
        claimed_at INTEGER,
        claimed_by TEXT,
        claims INTEGER NOT NULL DEFAULT 0,
        done_at INTEGER,
        result_json TEXT,
        undo_json TEXT,
        error_json TEXT,
        req_sha256 TEXT
      ) WITHOUT ROWID`,
      `CREATE INDEX verbs_open ON verbs (created_at) WHERE status IN ('pending', 'claimed')`,
    ],
  },
];

export const VERBS_TABLES: Record<string, TableInfo> = {
  verbs: {
    retention: 'done/failed/expired deleted 30 days after done_at or expires_at',
    backup: true,
    export: true,
    prune,
  },
};
