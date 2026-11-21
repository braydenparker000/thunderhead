// Guitar's progress on the Worker (GUITAR.md §1.1): schema step 47. One row per song, its record
// as the phone sent it (`body`: the library entry, the ladder's sections and the practice seconds by
// day, as JSON), with `updated_at`, when the phone saved it (the newer wins), and `synced_at`, when
// the Worker took it, so a phone asks only for what changed since it last asked (the index on
// `synced_at`; in a WITHOUT ROWID table it carries the key too, which is the page cursor).
import type { Migration, TableInfo } from '../../objects/base';
import { pruneProgress } from './store';

export const GUITAR_MIGRATIONS: Migration[] = [
  {
    version: 47,
    name: 'guitar_progress',
    kind: 'expand',
    sql: [
      `CREATE TABLE guitar_progress (
        key TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        synced_at INTEGER NOT NULL
      ) WITHOUT ROWID`,
      'CREATE INDEX guitar_progress_synced ON guitar_progress (synced_at)',
    ],
  },
];

export const GUITAR_TABLES: Record<string, TableInfo> = {
  guitar_progress: {
    retention: 'the newest 1,000 by updated_at, the rest deleted by the daily prune (a record per song)',
    backup: true,
    export: true,
    prune: pruneProgress,
  },
};
