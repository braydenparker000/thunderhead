// Stacks (PHOTOS.md, the shelf): a RAW (RAF or DNG) and a JPEG with the same base name
// (DSCF1234.RAF and DSCF1234.JPG), taken within 2 s of each other, are one stack, whichever came
// first and however it came (this phone, From Drive, the daily pass). Each names the other in
// `pair_id`; the shelf shows the RAW; the stack's stars, heart and flag are on both (the higher
// rating and either's heart when they meet); a delete or a restore takes both. No unpairing.
import { PHOTO_LIMITS as L } from '../../../../shared/contract/photos.ts';
import { ownerDay } from '../../lib/time';
import type { Writer } from '../../objects/commit';
import type { PhotoRow } from './store';

const RAW = new Set(['raf', 'dng']);
const base = (name: string) => name.replace(/\.[^.]*$/, '').toLowerCase();
const mates = (a: string, b: string) => (RAW.has(a) && b === 'jpeg') || (a === 'jpeg' && RAW.has(b));
type Near = Pick<PhotoRow, 'id' | 'name' | 'format' | 'taken_at' | 'rating' | 'favorite' | 'flag'>;

/** A photo just registered, with its stack's other half if one is on the shelf (both rows then
 * name each other). The window is two seeks of photos_shelf: its day, and the next or last. */
export function pairUp(w: Writer, r: PhotoRow, tz: string): PhotoRow {
  if (!RAW.has(r.format) && r.format !== 'jpeg') return r;
  const lo = r.taken_at - L.pair_ms;
  const hi = r.taken_at + L.pair_ms;
  const near = w.db.all<Near>(
    `SELECT id, name, format, taken_at, rating, favorite, flag FROM photos
     WHERE deleted_at IS NULL AND day IN (?, ?) AND taken_at BETWEEN ? AND ? AND pair_id IS NULL AND id <> ?`,
    ownerDay(lo, tz),
    ownerDay(hi, tz),
    lo,
    hi,
    r.id,
  );
  const mate = near
    .filter((o) => mates(r.format, o.format) && base(o.name) === base(r.name))
    .sort((a, b) => Math.abs(a.taken_at - r.taken_at) - Math.abs(b.taken_at - r.taken_at))[0];
  if (!mate) return r;
  const marks = {
    rating: Math.max(r.rating, mate.rating),
    favorite: Math.max(r.favorite, mate.favorite),
    flag: r.flag ?? mate.flag,
  };
  for (const [id, other] of [
    [r.id, mate.id],
    [mate.id, r.id],
  ])
    w.db.run(
      'UPDATE photos SET pair_id = ?, rating = ?, favorite = ?, flag = ?, updated_at = ? WHERE id = ?',
      other,
      marks.rating,
      marks.favorite,
      marks.flag,
      w.at,
      id,
    );
  w.change('photo', `photo:${mate.id}`);
  return { ...r, ...marks, pair_id: mate.id };
}
