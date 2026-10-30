// Chat files (HOME.md §4.6, DATA.md): one row per uploaded file; the bytes are in the private
// bucket under chat/files/. Schema step 21.
import type { Migration, TableInfo } from '../../objects/base';

export const FILES_MIGRATIONS: Migration[] = [
  {
    version: 21,
    name: 'files',
    kind: 'expand',
    sql: [
      // `key` is the bucket key, never shown to a client; `message_id` stays NULL until a message
      // takes the file, and then never changes.
      `CREATE TABLE files (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        seconds REAL,
        text TEXT,
        uploaded_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        message_id TEXT
      ) WITHOUT ROWID`,
    ],
  },
];

export const FILES_TABLES: Record<string, TableInfo> = {
  files: {
    retention: 'forever (as long as its bytes in chat/files/: a name, a type, numbers, the words of a memo)',
    backup: true,
    export: true,
  },
};
