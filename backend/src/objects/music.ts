// The Music object (MUSIC.md §1.2, MIGRATION.md I7): the catalog of the owner's library, one row per
// track keeping the old catalog's ids, content keys and records, the catalog's change log, and its
// state. Added alone in its own deploy, because a Durable Object class change cannot be rolled
// back: this first version is the schema and the health report only; the catalog import and the
// routes the ported player calls come with the next deploy (P5).
import { type Migration, OwnerObject } from './base';

export const MUSIC_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'catalog',
    kind: 'expand',
    sql: [
      `CREATE TABLE tracks (
        ord INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        sha256 TEXT NOT NULL,
        size INTEGER NOT NULL,
        audio_key TEXT NOT NULL,
        cover_key TEXT,
        record_json TEXT NOT NULL,
        waveform TEXT,
        updated_at INTEGER NOT NULL
      )`,
      'CREATE INDEX tracks_content ON tracks (sha256, size)',
      `CREATE TABLE catalog_log (
        seq INTEGER PRIMARY KEY,
        at INTEGER NOT NULL,
        op TEXT NOT NULL,
        track_id TEXT,
        before_json TEXT
      )`,
      `CREATE TABLE music_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      ) WITHOUT ROWID`,
    ],
  },
];

export class Music extends OwnerObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, MUSIC_MIGRATIONS);
  }
}
