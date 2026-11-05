// The shelf's days under a filter chip, inside Core (PHOTOS.md, the shelf; DATA.md §4.14): days
// newest first with each one's count and first few, one whole day, and the photos either side of one
// (culling in the editor). A stack shows once, as its RAW. Each filter reads through its own index:
// the stars through photos_rated (an IN list, so each rating is a seek), the heart through
// photos_favorite, the rest through photos_shelf; INDEXED BY keeps the planner to it.
import type { PhotoFilter } from '../../../../shared/contract/photos.ts';
import type { Db } from '../../objects/base';
import { COLS, type PhotoRow } from './store';

const SHOWN = "(pair_id IS NULL OR format <> 'jpeg')";
// `rating > 0` is the partial index's own term, so the planner may use it.
const stars = (n: number) => ({
  index: 'photos_rated',
  sql: `rating > 0 AND rating IN (${[5, 4, 3].filter((k) => k >= n).join(', ')})`,
});
const FILTER: Record<PhotoFilter, { index: string; sql: string }> = {
  all: { index: 'photos_shelf', sql: '1' },
  favorites: { index: 'photos_favorite', sql: 'favorite = 1' },
  stars3: stars(3),
  stars4: stars(4),
  stars5: stars(5),
  raw: { index: 'photos_shelf', sql: "format IN ('raf', 'dng')" },
  jpeg: { index: 'photos_shelf', sql: "format IN ('jpeg', 'heic')" },
  edited: { index: 'photos_shelf', sql: 'recipe_sha IS NOT NULL' },
  unedited: { index: 'photos_shelf', sql: 'recipe_sha IS NULL' },
};
const from = (f: PhotoFilter) =>
  `FROM photos INDEXED BY ${FILTER[f].index} WHERE deleted_at IS NULL AND ${SHOWN} AND ${FILTER[f].sql}`;

/** The days before `before` (or the newest), each with its count of photos under the filter. */
export const days = (db: Db, f: PhotoFilter, before: string | null, limit: number): { day: string; n: number }[] =>
  db.all(
    `SELECT day, COUNT(*) AS n ${from(f)} AND day < ? GROUP BY day ORDER BY day DESC LIMIT ?`,
    before ?? '9999-12-31',
    limit,
  );

/** A day's photos under the filter, newest first. */
export const ofDay = (db: Db, f: PhotoFilter, day: string, limit: number): PhotoRow[] =>
  db.all(`SELECT ${COLS} ${from(f)} AND day = ? ORDER BY taken_at DESC, id DESC LIMIT ?`, day, limit);

/** The photo just newer and just older than `r` in the shelf's order under the filter (`r` itself
 * need not pass it: culling goes on from where it is). */
export function around(db: Db, f: PhotoFilter, r: Pick<PhotoRow, 'id' | 'day' | 'taken_at'>) {
  const one = (op: '<' | '>', dir: 'ASC' | 'DESC') =>
    db.one<{ id: string }>(
      `SELECT id ${from(f)} AND (day, taken_at, id) ${op} (?, ?, ?)
       ORDER BY day ${dir}, taken_at ${dir}, id ${dir} LIMIT 1`,
      r.day,
      r.taken_at,
      r.id,
    )?.id ?? null;
  return { newer: one('>', 'ASC'), older: one('<', 'DESC') };
}
