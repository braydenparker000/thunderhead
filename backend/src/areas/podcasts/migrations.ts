// Podcasts on the Worker (NEXT-BATCH.md part 7, PODCASTS.md §5.4): schema step 25. Where each
// episode was left (one row per episode, the newest 1,000 kept) and the shows followed (one row per
// show; an unfollow kept 30 days so the other phones learn it), each with `synced_at`, when the
// Worker took the row, so a phone asks only for what changed since it last asked (the index on
// `synced_at`; in a WITHOUT ROWID table it carries the key too, which is the page cursor). The
// night's last check of a show (and how many in a row failed) sits on its follow row and never
// moves `synced_at`.
import type { Migration, TableInfo } from '../../objects/base';
import { pruneFollows, pruneProgress } from './store';

export const PODCASTS_MIGRATIONS: Migration[] = [
  {
    version: 25,
    name: 'podcast_progress, podcast_follows',
    kind: 'expand',
    sql: [
      `CREATE TABLE podcast_progress (
        key TEXT PRIMARY KEY,
        position_s REAL NOT NULL,
        duration_s REAL NOT NULL,
        played INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        synced_at INTEGER NOT NULL
      ) WITHOUT ROWID`,
      'CREATE INDEX podcast_progress_synced ON podcast_progress (synced_at)',
      `CREATE TABLE podcast_follows (
        feed_url TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        artwork TEXT NOT NULL,
        followed INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        synced_at INTEGER NOT NULL,
        checked_at INTEGER,
        latest_at INTEGER,
        new_n INTEGER NOT NULL DEFAULT 0,
        fails INTEGER NOT NULL DEFAULT 0
      ) WITHOUT ROWID`,
      'CREATE INDEX podcast_follows_synced ON podcast_follows (synced_at)',
    ],
  },
];

export const PODCASTS_TABLES: Record<string, TableInfo> = {
  podcast_progress: {
    retention: 'the newest 1,000 by updated_at, the rest deleted by the daily prune (a position per episode)',
    backup: true,
    export: true,
    prune: pruneProgress,
  },
  podcast_follows: {
    retention: 'while followed; an unfollow 30 days, so the other phones learn it; at most 300 rows',
    backup: true,
    export: true,
    prune: pruneFollows,
  },
};
