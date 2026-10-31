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

/** New tracks from the upload tools take places from here on, so the old catalog's places (from 1,
 * never reused) stay free for an import run after them. */
export const NEW_ORD_BASE = 1_000_000_000_000;

/** Inserts or updates one imported track by id; the rows it wrote (0 when nothing changed), or -1
 * when another track already holds its place (it is skipped, not moved). */
export function putTrack(db: Db, t: TrackRow): number {
  if (db.one('SELECT 1 AS x FROM tracks WHERE ord = ? AND id <> ?', t.ord, t.id)) return -1;
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

/** One pass over the tracks for both counts; the log's length from its ends (it is kept
 * contiguous, LOG_KEEP), two rows instead of all of them. */
export function counts(db: Db): { tracks: number; waveforms: number; log: number } {
  const t = db.one<{ tracks: number; waveforms: number }>('SELECT count(*) AS tracks, count(waveform) AS waveforms FROM tracks');
  const l = db.one<{ lo: number | null; hi: number | null }>('SELECT min(seq) AS lo, max(seq) AS hi FROM catalog_log');
  return { tracks: t?.tracks ?? 0, waveforms: t?.waveforms ?? 0, log: l?.hi == null || l.lo == null ? 0 : l.hi - l.lo + 1 };
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

// --- the catalog's writer (the upload tools' operations, ./writer.ts) ---------------------------

/** The change log keeps this many rows (the old catalog's own number). */
export const LOG_KEEP = 20_000;

export function trackRow(db: Db, id: string): TrackRow | null {
  return db.one<TrackRow>('SELECT * FROM tracks WHERE id = ?', id);
}

/** The track holding this audio (by hash and size), other than `except`. */
export function byContent(db: Db, sha256: string, size: number, except = ''): string | null {
  return (
    db.one<{ id: string }>('SELECT id FROM tracks WHERE sha256 = ? AND size = ? AND id <> ?', sha256, size, except)
      ?.id ?? null
  );
}

/** Writes a track's record; a new track goes last in the catalog's order, at NEW_ORD_BASE or after. */
export function writeTrack(db: Db, record: Record<string, unknown>, waveform: string | null, at: number): void {
  db.run(
    `INSERT INTO tracks (ord, id, sha256, size, audio_key, cover_key, record_json, waveform, updated_at)
     VALUES ((SELECT max(coalesce(max(ord), 0) + 1, ?) FROM tracks), ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET sha256 = excluded.sha256, size = excluded.size, audio_key = excluded.audio_key,
       cover_key = excluded.cover_key, record_json = excluded.record_json, waveform = excluded.waveform,
       updated_at = excluded.updated_at`,
    NEW_ORD_BASE,
    record.id,
    record.sha256,
    record.size,
    record.audioKey,
    (record.coverKey as string | undefined) ?? null,
    JSON.stringify(record),
    waveform,
    at,
  );
}

export function deleteTrack(db: Db, id: string): void {
  db.run('DELETE FROM tracks WHERE id = ?', id);
}

/** One change, with what it replaced (for undo); the oldest rows past LOG_KEEP go. */
export function logOp(db: Db, at: number, op: string, trackId: string | null, before: unknown): void {
  db.run(
    'INSERT INTO catalog_log (at, op, track_id, before_json) VALUES (?, ?, ?, ?)',
    at,
    op,
    trackId,
    before == null ? null : JSON.stringify(before),
  );
  db.run('DELETE FROM catalog_log WHERE seq <= (SELECT max(seq) FROM catalog_log) - ?', LOG_KEEP);
}

export function trackCount(db: Db): number {
  return db.one<{ n: number }>('SELECT count(*) AS n FROM tracks')?.n ?? 0;
}

/** Every content key the catalog uses, with its track and size (the audit). */
export function referencedKeys(db: Db): { id: string; audio_key: string; cover_key: string | null; size: number; w: number }[] {
  return db.all('SELECT id, audio_key, cover_key, size, waveform IS NOT NULL AS w FROM tracks');
}

/** The catalog's records with their waveforms, in order (the tools' export). */
export function exportRows(db: Db): { record_json: string; waveform: string | null }[] {
  return db.all('SELECT record_json, waveform FROM tracks ORDER BY ord');
}

/** The catalog's records' total length: what the catalog's size limit counts. */
export function recordBytes(db: Db): number {
  return db.one<{ n: number | null }>('SELECT sum(length(record_json)) AS n FROM tracks')?.n ?? 0;
}
