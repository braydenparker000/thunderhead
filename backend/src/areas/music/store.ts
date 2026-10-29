// SQL for the Music object (MUSIC.md §1.2, DATA.md §6.2): the catalog's tracks in the old
// catalog's order (`ord`, kept from the old table, which never reused one), each with its record
// exactly as the old catalog stored it and its waveform; the catalog's change log; and its state
// (the catalog's version, which is its ETag). A put that changes nothing writes nothing, so an
// import run again costs 0 rows.
import type { Db } from '../../objects/base';

export interface TrackRow {
  ord: number;
  id: string;
  sha256: string;
  size: number;
  audio_key: string;
  cover_key: string | null;
  record_json: string;
  waveform: string | null;
  updated_at: number;
}
export interface LogRow {
  seq: number;
  at: number;
  op: string;
  track_id: string | null;
  before_json: string | null;
}
export interface CatalogVersion {
  version: number;
  changed_at: number;
}

/** Inserts or updates one track by id; the rows it wrote (0 when nothing changed). */
export function putTrack(db: Db, t: TrackRow): number {
  return db.run(
    `INSERT INTO tracks (ord, id, sha256, size, audio_key, cover_key, record_json, waveform, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET ord = excluded.ord, sha256 = excluded.sha256, size = excluded.size,
       audio_key = excluded.audio_key, cover_key = excluded.cover_key, record_json = excluded.record_json,
       waveform = excluded.waveform, updated_at = excluded.updated_at
     WHERE tracks.ord IS NOT excluded.ord OR tracks.sha256 IS NOT excluded.sha256 OR tracks.size IS NOT excluded.size
       OR tracks.audio_key IS NOT excluded.audio_key OR tracks.cover_key IS NOT excluded.cover_key
       OR tracks.record_json IS NOT excluded.record_json OR tracks.waveform IS NOT excluded.waveform
       OR tracks.updated_at IS NOT excluded.updated_at`,
    t.ord,
    t.id,
    t.sha256,
    t.size,
    t.audio_key,
    t.cover_key,
    t.record_json,
    t.waveform,
    t.updated_at,
  );
}

/** One change-log row by its old sequence number; one already there is left as it is. */
export function putLog(db: Db, l: LogRow): number {
  return db.run(
    'INSERT INTO catalog_log (seq, at, op, track_id, before_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT (seq) DO NOTHING',
    l.seq,
    l.at,
    l.op,
    l.track_id,
    l.before_json,
  );
}

const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');

export function tracksById(db: Db, ids: string[]): TrackRow[] {
  return ids.length ? db.all<TrackRow>(`SELECT * FROM tracks WHERE id IN (${marks(ids.length)})`, ...ids) : [];
}

export function logBySeq(db: Db, seqs: number[]): LogRow[] {
  return seqs.length ? db.all<LogRow>(`SELECT * FROM catalog_log WHERE seq IN (${marks(seqs.length)})`, ...seqs) : [];
}

/** Every track's record in catalog order, and whether it has a waveform. */
export function catalogRows(db: Db): { record_json: string; w: number }[] {
  return db.all('SELECT record_json, waveform IS NOT NULL AS w FROM tracks ORDER BY ord');
}

export function waveform(db: Db, id: string): string | null {
  return db.one<{ waveform: string | null }>('SELECT waveform FROM tracks WHERE id = ?', id)?.waveform ?? null;
}

/** The content keys a signed link needs, for the ids that exist. */
export function keys(db: Db, ids: string[]): { id: string; audio_key: string; cover_key: string | null }[] {
  return ids.length
    ? db.all(`SELECT id, audio_key, cover_key FROM tracks WHERE id IN (${marks(ids.length)})`, ...ids)
    : [];
}

export function counts(db: Db): { tracks: number; waveforms: number; log: number } {
  return db.one<{ tracks: number; waveforms: number; log: number }>(
    `SELECT (SELECT count(*) FROM tracks) AS tracks, (SELECT count(waveform) FROM tracks) AS waveforms,
       (SELECT count(*) FROM catalog_log) AS log`,
  ) as { tracks: number; waveforms: number; log: number };
}

export function version(db: Db): CatalogVersion {
  const r = db.one<{ value_json: string }>("SELECT value_json FROM music_state WHERE key = 'catalog'");
  return r ? (JSON.parse(r.value_json) as CatalogVersion) : { version: 0, changed_at: 0 };
}

/** The catalog changed: its version moves on, so every phone's copy is out of date. */
export function bump(db: Db, at: number): CatalogVersion {
  const v = { version: version(db).version + 1, changed_at: at };
  db.run(
    "INSERT INTO music_state (key, value_json) VALUES ('catalog', ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json",
    JSON.stringify(v),
  );
  return v;
}

/** The catalog's ETag: its version and when it last changed. */
export const etagOf = (v: CatalogVersion) => `"m${v.version}-${v.changed_at.toString(36)}"`;
