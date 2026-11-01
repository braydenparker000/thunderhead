// The Music object (MUSIC.md §1.2, MIGRATION.md I7): the catalog of the owner's library, one row per
// track keeping the old catalog's ids, content keys and records, the catalog's change log, and its
// state. The class shipped alone in its own deploy (a Durable Object class change cannot be rolled
// back). P5 step 2 fills it from the old export (areas/import, datasets `music` and `music_log`) and
// serves it: the whole catalog without waveforms under one ETag, one track's waveform, and the
// content keys a signed link needs. P5 step 3 makes it the catalog's single writer for the upload
// tools (areas/music/writer.ts), one operation at a time. The listening pass (schema step 3, songs
// analysed in Actions) is its code layer music-listen.ts; what the mind reads and writes here (the
// tags, its notes about each song, songs by feeling) is the layer above it, music-mind.ts.
import type { BackupOf } from '../areas/backups/ops';
import { page, type Row } from '../areas/backups/rows';
import { METER_DAYS_SQL } from '../areas/meter/migrations';
import { LISTEN_SQL, LISTEN_TABLES } from '../areas/music/listen-store';
import * as store from '../areas/music/store';
import { lowerCursor } from '../areas/music/store-notes';
import { type Ctx, MusicError, OPS, type Op } from '../areas/music/writer';
import { EDIT_OPS } from '../areas/music/writer-edit';
import type { Migration } from './base';
import { MusicMind } from './music-mind';

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
  {
    version: 2,
    name: 'meter_days',
    kind: 'expand',
    sql: [METER_DAYS_SQL],
  },
  // The listening pass (JOBS.md §3): Actions specs, one analysis row per audio hash, one per track.
  { version: 3, name: 'listen', kind: 'expand', sql: LISTEN_SQL },
  {
    version: 4,
    name: 'track_notes',
    kind: 'expand',
    // What the mind knows of each song (MUSIC.md §10.5): its note, one row a track (`pack`: the
    // find pack it is in); the owner's newest rating of each song, kept for good; and find's packs
    // (derived: the notes 500 to a row, and the listening pass's measurements).
    sql: [
      `CREATE TABLE track_notes (
        track_id TEXT PRIMARY KEY,
        known INTEGER NOT NULL,
        note_json TEXT NOT NULL,
        by TEXT NOT NULL,
        v INTEGER NOT NULL,
        at INTEGER NOT NULL,
        pack INTEGER NOT NULL
      ) WITHOUT ROWID`,
      `CREATE TABLE track_ratings (
        track_id TEXT PRIMARY KEY,
        rating INTEGER NOT NULL,
        at INTEGER NOT NULL
      ) WITHOUT ROWID`,
      'CREATE INDEX track_ratings_out ON track_ratings (track_id) WHERE rating = 1',
      // Any write to the notes that isn't a batch's own (a table restore, a hand edit) leaves a mark,
      // so find's packs are built again and the night's place starts over (music-packs.ts). A batch
      // clears the mark as it ends; only the first row of a write costs a row written. (Not INSERT OR
      // IGNORE: an upsert's own conflict clause would override it inside the trigger.)
      ...['INSERT', 'UPDATE', 'DELETE'].map(
        (e) =>
          `CREATE TRIGGER track_notes_${e.toLowerCase()} AFTER ${e} ON track_notes BEGIN
            INSERT INTO music_state (key, value_json) SELECT 'notes.stale', '1'
              WHERE NOT EXISTS (SELECT 1 FROM music_state WHERE key = 'notes.stale');
          END`,
      ),
      `CREATE TABLE find_packs (
        kind TEXT NOT NULL,
        pack INTEGER NOT NULL,
        entries_json TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (kind, pack)
      ) WITHOUT ROWID`,
    ],
  },
];

/** Every catalog table, the listening pass's, the mind's notes and the owner's ratings, in the weekly
 * backup and the export (DATA.md §10); the meter's `meter_days` (counts only) and find's derived
 * `find_packs` (built again from the notes) stay out of both. */
export const MUSIC_TABLES = ['tracks', 'catalog_log', 'music_state', ...LISTEN_TABLES, 'track_notes', 'track_ratings'] as const;

/** The one instance: the owner's library. */
export const MUSIC_INSTANCE = 'library';

export function musicObject(env: Env): DurableObjectStub<Music> {
  return env.MUSIC.getByName(MUSIC_INSTANCE);
}

/** The upload tools' operations (POST /v1/music/uploads/:op). */
export const WRITE_OPS: Readonly<Record<string, Op>> = { ...OPS, ...EDIT_OPS };

/** An operation's answer: the old writer's own body, or its status and why not. */
export interface WriteResult {
  status: number;
  body: Record<string, unknown>;
}

/** What an import step wrote: rows (index entries included), tracks or log rows changed, and the
 * tracks skipped because another track holds their place. */
export interface PutResult {
  written: number;
  changed: number;
  clashes?: string[];
}

export class Music extends MusicMind {
  /** The catalog as last built, by its ETag: built once per change, not per phone. */
  private built: { etag: string; text: string } | null = null;
  /** The records' total length, read once per start and grown by each new track. */
  private recordBytes: number | null = null;
  /** How many tracks, counted once per start and kept as tracks come and go: a count reads every
   * row, and the free plan meters rows read (2026-10-31: per-song counts read 4.4M in a day). */
  private trackTotal: number | null = null;

  /** What a write or an import may have changed: read again when next needed. */
  private forget(): void {
    this.recordBytes = null;
    this.trackTotal = null;
    this.dropIndex();
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, MUSIC_MIGRATIONS, 'music');
  }

  /** Puts imported tracks in one transaction; the catalog's version moves only if one changed. */
  importTracks(rows: store.TrackRow[], at: number): PutResult {
    return this.ctx.storage.transactionSync(() => {
      let written = 0;
      let changed = 0;
      let low = Number.POSITIVE_INFINITY;
      const clashes: string[] = [];
      for (const r of rows) {
        const n = store.putTrack(this.db, r);
        if (n < 0) clashes.push(r.id);
        else written += n;
        if (n > 0) {
          changed++;
          low = Math.min(low, r.ord);
        }
      }
      if (changed) {
        store.bump(this.db, at);
        // An imported song keeps its old place, maybe below the night's: the night offers it.
        lowerCursor(this.db, low);
        this.forget();
      }
      return { written, changed, clashes };
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

  /** One upload-tool operation. Its R2 checks run first; its writes are one transaction. */
  async write(op: string, body: Record<string, unknown>, now = Date.now()): Promise<WriteResult> {
    const fn = Object.hasOwn(WRITE_OPS, op) ? WRITE_OPS[op] : undefined;
    if (!fn) return { status: 404, body: { error: 'Unknown music operation' } };
    const media = this.env.MEDIA;
    if (!media) return { status: 503, body: { error: 'Music storage is not configured' } };
    const c: Ctx = {
      db: this.db,
      tx: (f) => this.ctx.storage.transactionSync(f),
      media,
      now,
      bytes: () => {
        this.recordBytes ??= store.recordBytes(this.db);
        return this.recordBytes;
      },
      grow: (n) => {
        if (this.recordBytes !== null) this.recordBytes += n;
      },
      tracks: () => {
        this.trackTotal ??= store.trackCount(this.db);
        return this.trackTotal;
      },
      counted: (n) => {
        if (this.trackTotal !== null) this.trackTotal += n;
      },
    };
    try {
      const out = { status: 200, body: await fn(c, body) };
      this.dropIndex();
      return out;
    } catch (e) {
      // A failed operation's transaction rolled back: what was kept in memory may not match.
      this.forget();
      if (e instanceof MusicError) return { status: e.status, body: { error: e.message, ...e.extra } };
      throw e;
    }
  }

  /** What the weekly backup of this object needs when it starts (areas/backups). */
  async backupOf(): Promise<BackupOf> {
    const bookmark = await this.ctx.storage.getCurrentBookmark().catch(() => null);
    return { tables: [...MUSIC_TABLES], schema_version: this.migration, bookmark };
  }

  /** One page of a table in key order, for the backup and the export. */
  page(table: string, after: unknown[] | null, limit: number): { rows: Row[]; last: unknown[] | null } {
    if (!(MUSIC_TABLES as readonly string[]).includes(table)) throw new Error('not a Music table');
    return page(this.db, table, after, limit);
  }

  /** The whole catalog with each waveform inline, for the tools (the old writer's `export`). */
  exportCatalog(): string {
    const v = store.version(this.db);
    const tracks = store.exportRows(this.db).map((r) => {
      if (!r.waveform) return r.record_json;
      const t = JSON.parse(r.record_json) as { metadata: Record<string, unknown> };
      t.metadata.waveform = r.waveform;
      return JSON.stringify(t);
    });
    const head = { version: 1, kind: 'r2-library', complete: true, count: tracks.length };
    const generatedAt = new Date(v.changed_at || Date.now()).toISOString();
    return `${JSON.stringify({ ...head, generatedAt }).slice(0, -1)},"tracks":[${tracks.join(',')}]}`;
  }
}
