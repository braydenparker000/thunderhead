// The Music object (MUSIC.md §1.2, MIGRATION.md I7): the catalog of the owner's library, one row per
// track keeping the old catalog's ids, content keys and records, the catalog's change log, and its
// state. The class shipped alone in its own deploy (a Durable Object class change cannot be rolled
// back). P5 step 2 fills it from the old export (areas/import, datasets `music` and `music_log`) and
// serves it: the whole catalog without waveforms under one ETag, one track's waveform, and the
// content keys a signed link needs. Catalog writes from the upload tools come later.
import * as store from '../areas/music/store';
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

/** The one instance: the owner's library. */
export const MUSIC_INSTANCE = 'library';

export function musicObject(env: Env): DurableObjectStub<Music> {
  return env.MUSIC.getByName(MUSIC_INSTANCE);
}

/** What an import step wrote: rows (index entries included) and tracks or log rows changed. */
export interface PutResult {
  written: number;
  changed: number;
}

export class Music extends OwnerObject {
  /** The catalog as last built, by its ETag: built once per change, not per phone. */
  private built: { etag: string; text: string } | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, MUSIC_MIGRATIONS);
  }

  /** Puts imported tracks in one transaction; the catalog's version moves only if one changed. */
  importTracks(rows: store.TrackRow[], at: number): PutResult {
    return this.ctx.storage.transactionSync(() => {
      let written = 0;
      let changed = 0;
      for (const r of rows) {
        const n = store.putTrack(this.db, r);
        written += n;
        if (n > 0) changed++;
      }
      if (changed) store.bump(this.db, at);
      return { written, changed };
    });
  }

  importLog(rows: store.LogRow[]): PutResult {
    return this.ctx.storage.transactionSync(() => {
      let written = 0;
      let changed = 0;
      for (const r of rows) {
        const n = store.putLog(this.db, r);
        written += n;
        if (n > 0) changed++;
      }
      return { written, changed };
    });
  }

  /** The import's spot checks read back what was written. */
  tracks(ids: string[]): store.TrackRow[] {
    return store.tracksById(this.db, ids);
  }

  log(seqs: number[]): store.LogRow[] {
    return store.logBySeq(this.db, seqs);
  }

  /** The catalog's ETag (one row read): what a phone's revalidation costs. */
  catalogTag(): string {
    return store.etagOf(store.version(this.db));
  }

  /** The whole catalog without waveforms, in the old published file's shape (`r2-library`, the
   * ported player's format): each track's record as the old catalog kept it, `waveformBars` on
   * the ones with a waveform to fetch. */
  catalog(): { etag: string; text: string } {
    const v = store.version(this.db);
    const etag = store.etagOf(v);
    if (this.built?.etag === etag) return this.built;
    const rows = store.catalogRows(this.db);
    const tracks = rows.map((r) => (r.w ? `${r.record_json.slice(0, -1)},"waveformBars":true}` : r.record_json));
    const head = { version: 1, kind: 'r2-library', complete: true, count: rows.length };
    const generatedAt = new Date(v.changed_at).toISOString();
    const text = `${JSON.stringify({ ...head, generatedAt }).slice(0, -1)},"tracks":[${tracks.join(',')}]}`;
    this.built = { etag, text };
    return this.built;
  }

  waveform(id: string): string | null {
    return store.waveform(this.db, id);
  }

  keys(ids: string[]): { id: string; audio_key: string; cover_key: string | null }[] {
    return store.keys(this.db, ids);
  }

  counts(): { tracks: number; waveforms: number; log: number } {
    return store.counts(this.db);
  }
}
