// The conversation's schema step (DATA.md §4.2) and its tables' retention (§10). The FTS table
// uses external content; the store writes it in the same transaction as the message (no
// triggers, so migrations stay plain SQL).
import type { Migration, TableInfo } from '../../objects/base';

export const CONVERSATION_MIGRATIONS: Migration[] = [
  {
    version: 2,
    name: 'threads, messages, messages_fts',
    kind: 'expand',
    sql: [
      `CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT,
        title_source TEXT,
        summary TEXT,
        status TEXT NOT NULL,
        continues TEXT,
        started_at INTEGER NOT NULL,
        filed_at INTEGER,
        message_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      ) WITHOUT ROWID`,
      `CREATE UNIQUE INDEX threads_daily_day ON threads (day) WHERE kind = 'daily'`,
      `CREATE INDEX threads_status_updated ON threads (status, updated_at)`,
      `CREATE TABLE messages (
        seq INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        thread_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        author TEXT NOT NULL,
        origin TEXT NOT NULL,
        kind TEXT NOT NULL,
        body TEXT NOT NULL,
        reply_to TEXT,
        meta_json TEXT,
        attachments_json TEXT,
        device_id TEXT,
        session_id TEXT,
        delivered_at INTEGER,
        acked_at INTEGER,
        answered_at INTEGER,
        req_sha256 TEXT
      )`,
      `CREATE INDEX messages_thread_seq ON messages (thread_id, seq)`,
      `CREATE INDEX messages_waiting ON messages (seq) WHERE author = 'owner' AND answered_at IS NULL`,
      `CREATE INDEX messages_system ON messages (seq) WHERE author = 'system'`,
      `CREATE INDEX messages_handed ON messages (delivered_at)
        WHERE author = 'owner' AND answered_at IS NULL AND acked_at IS NULL AND delivered_at IS NOT NULL`,
      `CREATE VIRTUAL TABLE messages_fts USING fts5 (body, content = 'messages', content_rowid = 'seq', tokenize = 'unicode61 remove_diacritics 2')`,
    ],
  },
];

export const CONVERSATION_TABLES: Record<string, TableInfo> = {
  threads: { retention: 'forever', backup: true, export: true },
  messages: { retention: 'forever', backup: true, export: true },
  messages_fts: { retention: 'derived (rebuilt)', backup: false, export: false },
};
