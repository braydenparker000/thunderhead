// The list for the builder (shared/contract/issues.ts): one row an item, its notes beside it. Schema
// step 55. Nothing is ever deleted: an item is marked done and may be reopened; notes are only added.
import type { Migration, TableInfo } from '../../objects/base';

export const ISSUES_MIGRATIONS: Migration[] = [
  {
    version: 55,
    name: 'issues, issue_notes',
    kind: 'expand',
    sql: [
      `CREATE TABLE issues (
        id TEXT PRIMARY KEY,
        at INTEGER NOT NULL,
        title TEXT NOT NULL,
        what TEXT NOT NULL,
        place TEXT,
        kind TEXT NOT NULL,
        origin TEXT NOT NULL,
        from_message_id TEXT,
        release TEXT,
        seen TEXT,
        state TEXT NOT NULL,
        done_at INTEGER,
        updated_at INTEGER NOT NULL,
        req_sha256 TEXT NOT NULL
      ) WITHOUT ROWID`,
      // A list of one state, newest first, reads its own rows.
      'CREATE INDEX issues_state ON issues (state, at)',
      `CREATE TABLE issue_notes (
        issue_id TEXT NOT NULL,
        id TEXT NOT NULL,
        at INTEGER NOT NULL,
        by TEXT NOT NULL,
        text TEXT NOT NULL,
        PRIMARY KEY (issue_id, id)
      ) WITHOUT ROWID`,
    ],
  },
];

export const ISSUES_TABLES: Record<string, TableInfo> = {
  issues: {
    retention: 'forever (the owner’s complaints for the next building session; marked done, never deleted)',
    backup: true,
    export: true,
  },
  issue_notes: {
    retention: 'forever (with its item; only ever added)',
    backup: true,
    export: true,
  },
};
