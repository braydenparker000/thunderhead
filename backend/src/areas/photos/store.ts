// SQL for the shelf inside Core (DATA.md §4.14): one photo by id or Drive id; pending ones; Recently
// deleted; the purge. The shelf's days and filters are shelf.ts; stacks, pair.ts.
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
  /** 0 or 1 (the item's boolean). */
  favorite: number;
  flag: PhotoFlag | null;
  /** The other photo of its stack. */
  pair_id: string | null;
  /** The bucket key of its preview: the Worker's alone, never sent. */
  preview_key: string | null;
  preview_sha: string | null;
  /** The recipe's hash (its JSON is read apart, recipe.ts); null as shot. */
  recipe_sha: string | null;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
}

export const COLS =
  'id, drive_id, name, format, bytes, sha256, camera, film, width, height, taken_at, day, rating, favorite, flag, pair_id, preview_key, preview_sha, recipe_sha, deleted_at, created_at, updated_at';

export function toItem(r: PhotoRow): PhotoItem {
  const { preview_key, preview_sha: _sha, recipe_sha, updated_at: _u, favorite, ...rest } = r;
  return { ...rest, favorite: favorite === 1, preview: preview_key !== null, edited: recipe_sha !== null };
}

export const byId = (db: Db, id: string): PhotoRow | null =>
  db.one<PhotoRow>(`SELECT ${COLS} FROM photos WHERE id = ?`, id);

export const byDrive = (db: Db, driveId: string): PhotoRow | null =>
  db.one<PhotoRow>(`SELECT ${COLS} FROM photos WHERE drive_id = ?`, driveId);

export function insert(db: Db, r: PhotoRow): void {
  db.run(
    `INSERT INTO photos (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    r.favorite,
    r.flag,
    r.pair_id,
    r.preview_key,
    r.preview_sha,
    r.recipe_sha,
    r.deleted_at,
    r.created_at,
    r.updated_at,
  );
}

/** Photos on the shelf whose background upload has no Drive id yet (the drive_id index finds them), newest first. */
export const pending = (db: Db, limit: number): PhotoRow[] =>
  db.all(
    `SELECT ${COLS} FROM photos WHERE drive_id IS NULL AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`,
    limit,
  );

export function setDrive(db: Db, id: string, driveId: string, at: number): void {
  db.run('UPDATE photos SET drive_id = ?, updated_at = ? WHERE id = ? AND drive_id IS NULL', driveId, at, id);
}

/** Recently deleted, a stack once (as its RAW). */
export const deleted = (db: Db, limit: number): PhotoRow[] =>
  db.all(
    `SELECT ${COLS} FROM photos WHERE deleted_at IS NOT NULL AND (pair_id IS NULL OR format <> 'jpeg')
     ORDER BY deleted_at DESC LIMIT ?`,
    limit,
  );

export function setMarks(db: Db, ids: string[], m: Pick<PhotoRow, 'rating' | 'favorite' | 'flag'>, at: number): void {
  for (const id of ids)
    db.run(
      'UPDATE photos SET rating = ?, favorite = ?, flag = ?, updated_at = ? WHERE id = ?',
      m.rating,
      m.favorite,
      m.flag,
      at,
      id,
    );
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
  for (const id of ids) {
    db.run('DELETE FROM photos WHERE id = ?', id);
    db.run('DELETE FROM photo_versions WHERE photo_id = ?', id);
  }
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
