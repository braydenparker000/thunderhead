// The Senses object (DATA.md §6.1, MEMORY.md L0): what the owner does, as events from the phone's
// sealed batches (`music.skip`, …), each day's rollups, and the record of each day's archive in the
// private bucket. Added alone in its own deploy, because a Durable Object class change cannot be
// rolled back: this first version is the schema and the health report only; the batches, the
// queries, the rollups, the archive and the pruning come with the next deploy (P5).
import { type Migration, OwnerObject } from './base';

export const SENSES_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'senses',
    kind: 'expand',
    sql: [
      `CREATE TABLE batches (
        batch_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        n INTEGER NOT NULL,
        sha256 TEXT NOT NULL
      ) WITHOUT ROWID`,
      `CREATE TABLE events (
        seq INTEGER PRIMARY KEY,
        id TEXT NOT NULL,
        at INTEGER NOT NULL,
        day TEXT NOT NULL,
        app TEXT NOT NULL,
        type TEXT NOT NULL,
        ref TEXT,
        data_json TEXT,
        device_id TEXT NOT NULL,
        origin TEXT NOT NULL,
        sensitivity INTEGER NOT NULL DEFAULT 0
      )`,
      // One index only (DATA.md §6.1): each index entry is a row written per event.
      'CREATE INDEX events_day_type ON events (day, type)',
      `CREATE TABLE rollups (
        day TEXT NOT NULL,
        type TEXT NOT NULL,
        ref TEXT NOT NULL,
        n INTEGER NOT NULL,
        sum_ms INTEGER NOT NULL,
        PRIMARY KEY (day, type, ref)
      ) WITHOUT ROWID`,
      `CREATE TABLE exports (
        day TEXT PRIMARY KEY,
        r2_key TEXT NOT NULL,
        n INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        at INTEGER NOT NULL
      ) WITHOUT ROWID`,
    ],
  },
];

/** The one instance: the owner's. */
export const SENSES_INSTANCE = 'owner';

export function sensesObject(env: Env): DurableObjectStub<Senses> {
  return env.SENSES.getByName(SENSES_INSTANCE);
}

export class Senses extends OwnerObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, SENSES_MIGRATIONS);
  }
}
