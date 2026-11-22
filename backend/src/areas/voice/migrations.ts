// The voice page (shared/contract/voice.ts): every version of how the mind talks, the newest the
// page. No version is ever deleted. Schema step 52.
import type { Migration, TableInfo } from '../../objects/base';

export const VOICE_MIGRATIONS: Migration[] = [
  {
    version: 52,
    name: 'voice_versions',
    kind: 'expand',
    sql: [
      `CREATE TABLE voice_versions (
        seq INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        at INTEGER NOT NULL,
        by TEXT NOT NULL,
        text TEXT NOT NULL,
        why TEXT,
        session_id TEXT,
        ledger_id TEXT
      )`,
    ],
  },
];

export const VOICE_TABLES: Record<string, TableInfo> = {
  voice_versions: {
    retention: 'forever (every version of the voice page; one page of at most 4,000 characters each)',
    backup: true,
    export: true,
  },
};
