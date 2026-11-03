// Verbs queued for a phone or run by the Worker (DATA.md §4.3), with retention (§10). `error_json`
// holds a failed result's code (e.g. `unsupported_verb`). Schema step 29: the mixes `music.mix_save`
// keeps (a name and its songs, by the id of the verb that saved it), which `music.play_mix` plays.
import type { Migration, TableInfo } from '../../objects/base';
import { pruneMixes } from './mixes';
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
  {
    version: 29,
    name: 'mixes',
    kind: 'expand',
    sql: [
      `CREATE TABLE mixes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        refs_json TEXT NOT NULL,
        tracks INTEGER NOT NULL,
        recipe TEXT,
        actor TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) WITHOUT ROWID`,
      'CREATE INDEX mixes_created ON mixes (created_at)',
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
  mixes: {
    retention: 'the newest 50; older ones deleted by the daily prune (an undo deletes one at once)',
    backup: true,
    export: true,
    prune: pruneMixes,
  },
};
