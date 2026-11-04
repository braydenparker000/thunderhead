// SQL for the shelf inside Core (DATA.md §4.14): photos by day in the owner's zone, newest first,
// each day's count and its first few; one photo by id or Drive id; Recently deleted; the purge.
import type { PhotoFlag, PhotoFormat, PhotoItem } from '../../../../shared/contract/photos.ts';
import type { Db } from '../../objects/base';

export interface PhotoRow {
  id: string;
  drive_id: string | null;
  name: string;
  format: PhotoFormat;
  bytes: number;
  sha256: string | null;
  camera: string | null;
  film: string | null;
  width: number | null;
  height: number | null;
  taken_at: number;
  day: string;
  rating: number;
  flag: PhotoFlag | null;
  /** The bucket key of its preview: the Worker's alone, never sent. */
  preview_key: string | null;
  preview_sha: string | null;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
}

const COLS =
  'id, drive_id, name, format, bytes, sha256, camera, film, width, height, taken_at, day, rating, flag, preview_key, preview_sha, deleted_at, created_at, updated_at';

export function toItem(r: PhotoRow): PhotoItem {
  const { preview_key, preview_sha: _sha, updated_at: _u, ...rest } = r;
  return { ...rest, preview: preview_key !== null };
}

export const byId = (db: Db, id: string): PhotoRow | null =>
  db.one<PhotoRow>(`SELECT ${COLS} FROM photos WHERE id = ?`, id);

export const byDrive = (db: Db, driveId: string): PhotoRow | null =>
  db.one<PhotoRow>(`SELECT ${COLS} FROM photos WHERE drive_id = ?`, driveId);

export function insert(db: Db, r: PhotoRow): void {
  db.run(
    `INSERT INTO photos (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.id,
    r.drive_id,
    r.name,
    r.format,
    r.bytes,
    r.sha256,
    r.camera,
    r.film,
    r.width,
    r.height,
    r.taken_at,
    r.day,
    r.rating,
    r.flag,
    r.preview_key,
    r.preview_sha,
    r.deleted_at,
    r.created_at,
    r.updated_at,
  );
}

/** The days before `before` (or the newest), each with its count of photos on the shelf. */
export const days = (db: Db, before: string | null, limit: number): { day: string; n: number }[] =>
  db.all(
    `SELECT day, COUNT(*) AS n FROM photos WHERE deleted_at IS NULL AND day < ?
     GROUP BY day ORDER BY day DESC LIMIT ?`,
    before ?? '9999-12-31',
    limit,
  );

/** A day's photos on the shelf, newest first. */
export const ofDay = (db: Db, day: string, limit: number): PhotoRow[] =>
  db.all(`SELECT ${COLS} FROM photos WHERE deleted_at IS NULL AND day = ? ORDER BY taken_at DESC LIMIT ?`, day, limit);

export const deleted = (db: Db, limit: number): PhotoRow[] =>
  db.all(`SELECT ${COLS} FROM photos WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT ?`, limit);

export function setRating(db: Db, id: string, rating: number, flag: PhotoFlag | null, at: number): void {
  db.run('UPDATE photos SET rating = ?, flag = ?, updated_at = ? WHERE id = ?', rating, flag, at, id);
}

export function setDeleted(db: Db, id: string, at: number | null, now: number): void {
  db.run('UPDATE photos SET deleted_at = ?, updated_at = ? WHERE id = ?', at, now, id);
}

export function setPreview(db: Db, id: string, key: string, sha: string, at: number): void {
  db.run('UPDATE photos SET preview_key = ?, preview_sha = ?, updated_at = ? WHERE id = ?', key, sha, at, id);
}

/** Photos deleted before `cutoff`, oldest first: what the purge takes this tick. */
export const due = (db: Db, cutoff: number, limit: number) =>
  db.all<{ id: string; drive_id: string | null; preview_key: string | null }>(
    `SELECT id, drive_id, preview_key FROM photos WHERE deleted_at IS NOT NULL AND deleted_at < ?
     ORDER BY deleted_at LIMIT ?`,
    cutoff,
    limit,
  );

export function purge(db: Db, ids: string[], driveIds: string[], at: number): void {
  for (const id of ids) db.run('DELETE FROM photos WHERE id = ?', id);
  for (const d of driveIds)
    db.run('INSERT INTO photos_gone (drive_id, purged_at) VALUES (?, ?) ON CONFLICT DO NOTHING', d, at);
}

export const gone = (db: Db, limit: number): string[] =>
  db
    .all<{ drive_id: string }>('SELECT drive_id FROM photos_gone ORDER BY purged_at LIMIT ?', limit)
    .map((r) => r.drive_id);

export const isGone = (db: Db, driveId: string): boolean =>
  db.one('SELECT 1 AS x FROM photos_gone WHERE drive_id = ?', driveId) !== null;

export function trashed(db: Db, driveIds: string[]): void {
  for (const d of driveIds) db.run('DELETE FROM photos_gone WHERE drive_id = ?', d);
}
