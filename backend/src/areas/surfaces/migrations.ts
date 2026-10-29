// Surfaces and the topics behind the voice-ladder repeat rule (DATA.md §4.1, §4.3), with
// retention (§10). `surfaces.seq` is the feed seq of the last write, so GET /v1/surfaces can
// answer "changed after since_seq" without a scan; `facts_json` (P3) lists the facts it cites.
import type { Migration, TableInfo } from '../../objects/base';
import { prune } from './store';

export const SURFACES_MIGRATIONS: Migration[] = [
  {
    version: 7,
    name: 'surfaces, topics',
    kind: 'expand',
    sql: [
      `CREATE TABLE surfaces (
        app TEXT NOT NULL,
        slot TEXT NOT NULL,
        kind TEXT NOT NULL,
        schema INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        why TEXT NOT NULL,
        topic_key TEXT NOT NULL,
        ref TEXT,
        expires_at INTEGER,
        written_at INTEGER NOT NULL,
        actor TEXT NOT NULL,
        ledger_id TEXT,
        seq INTEGER NOT NULL,
        PRIMARY KEY (app, slot)
      ) WITHOUT ROWID`,
      `CREATE TABLE topics (
        topic_key TEXT PRIMARY KEY,
        last_shown_at INTEGER,
        ignored_at INTEGER,
        shown_count INTEGER NOT NULL DEFAULT 0
      ) WITHOUT ROWID`,
    ],
  },
  {
    // P3: the facts a surface draws on, so muting or forgetting one clears it (MEMORY.md §12).
    version: 9,
    name: 'surfaces.facts_json',
    kind: 'expand',
    sql: ['ALTER TABLE surfaces ADD COLUMN facts_json TEXT'],
  },
];

export const SURFACES_TABLES: Record<string, TableInfo> = {
  surfaces: { retention: 'expired rows deleted within 24 h of expires_at', backup: true, export: false, prune },
  topics: { retention: 'forever (one row per topic key)', backup: true, export: false },
};
