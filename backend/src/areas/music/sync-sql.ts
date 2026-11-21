// Music schema step 6 (music.ts), expand only: the owner's Music data on every phone (MUSIC.md §1.4,
// API.md §11.29). A song's rating stays in step 4's `track_ratings` (one truth, which the `music.rate`
// senses also write): it gains `synced_at`, when the Worker took the row (0 for rows from before, so
// a phone asking from 0 still gets them), and its index, so a phone asks only for what changed since
// it last asked. Play counts get their own table (the larger count and the later time kept), and
// playlists theirs, one row each with its record as JSON (`body`: name, entries, created, path) and
// `deleted` (a deleted one's row is kept 30 days, so a phone that still has it does not bring it
// back; the partial index finds them). In a WITHOUT ROWID table an index carries the key too, which
// is the page cursor. SQL on them is sync-store.ts.

export const SYNC_SQL = [
  'ALTER TABLE track_ratings ADD COLUMN synced_at INTEGER NOT NULL DEFAULT 0',
  'CREATE INDEX track_ratings_synced ON track_ratings (synced_at)',
  `CREATE TABLE track_plays (
    track_id TEXT PRIMARY KEY,
    plays INTEGER NOT NULL,
    last_played INTEGER NOT NULL,
    synced_at INTEGER NOT NULL
  ) WITHOUT ROWID`,
  'CREATE INDEX track_plays_synced ON track_plays (synced_at)',
  `CREATE TABLE music_playlists (
    id TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    deleted INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    synced_at INTEGER NOT NULL
  ) WITHOUT ROWID`,
  'CREATE INDEX music_playlists_synced ON music_playlists (synced_at)',
  'CREATE INDEX music_playlists_gone ON music_playlists (updated_at) WHERE deleted = 1',
];

/** The step's tables in the weekly backup and the export (DATA.md §10): the owner's own data. */
export const SYNC_TABLES = ['track_plays', 'music_playlists'] as const;
