// The ledger (DATA.md §4.3): every action with its why and its stored inverse, with retention
// (§10). Written only through objects/commit.ts.
import type { Migration, TableInfo } from '../../objects/base';

export const LEDGER_MIGRATIONS: Migration[] = [
  {
    version: 5,
    name: 'ledger',
    kind: 'expand',
    sql: [
      `CREATE TABLE ledger (
        seq INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        at INTEGER NOT NULL,
        actor TEXT NOT NULL,
        session_id TEXT,
        kind TEXT NOT NULL,
        what TEXT NOT NULL,
        why TEXT NOT NULL,
        ref TEXT,
        topic_key TEXT,
        undo_json TEXT,
        undoable INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        tainted INTEGER NOT NULL DEFAULT 0,
        proposal_id TEXT,
        op_json TEXT,
        verb_id TEXT,
        undone_at INTEGER,
        req_sha256 TEXT
      )`,
      `CREATE INDEX ledger_at ON ledger (at)`,
    ],
  },
];

export const LEDGER_TABLES: Record<string, TableInfo> = {
  ledger: { retention: 'forever (forget leaves a tombstone)', backup: true, export: true },
};
