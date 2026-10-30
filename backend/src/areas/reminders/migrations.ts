// Reminders the owner sets (HOME.md §6.2, BEHAVIOR.md §3.4): one row each, delivered once by
// Core's alarm. Schema step 22.
import type { Migration, TableInfo } from '../../objects/base';

export const REMINDERS_MIGRATIONS: Migration[] = [
  {
    version: 22,
    name: 'reminders',
    kind: 'expand',
    sql: [
      `CREATE TABLE reminders (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        at INTEGER NOT NULL,
        fire_at INTEGER NOT NULL,
        state TEXT NOT NULL,
        origin TEXT NOT NULL,
        source_message_id TEXT,
        created_at INTEGER NOT NULL,
        fired_at INTEGER,
        cancelled_at INTEGER,
        message_id TEXT,
        push_until INTEGER,
        req_sha256 TEXT NOT NULL
      ) WITHOUT ROWID`,
      // The next one due (the alarm), the open count and the list's first part.
      "CREATE INDEX reminders_due ON reminders (fire_at) WHERE state = 'set'",
      // Delivered or taken back: the list's last 24 hours and the pushes still owed.
      "CREATE INDEX reminders_closed ON reminders (coalesce(fired_at, cancelled_at)) WHERE state != 'set'",
      // At most 3 from one owner message (the mind's).
      'CREATE INDEX reminders_source ON reminders (source_message_id) WHERE source_message_id IS NOT NULL',
    ],
  },
];

export const REMINDERS_TABLES: Record<string, TableInfo> = {
  reminders: {
    retention: 'forever (the owner’s own words, as the conversation line each becomes; at most 50 set at once)',
    backup: true,
    export: true,
  },
};
