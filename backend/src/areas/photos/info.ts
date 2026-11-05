// A photo's info inside Core (PHOTOS.md § Info; API.md §11.26): what the file says about itself, read
// on the phone. Checked against the contract's allowlist (a key it does not know is dropped, a known
// key out of its range refused), at most 2 KB as sent, kept canonical (keys sorted) in `photos.info`,
// so the same info again writes nothing. Never a place: the allowlist has no GPS key (SECURITY.md).
import * as z from 'zod/mini';
import {
  INFO_LIMITS,
  INFO_NUMBERS,
  INFO_TEXTS,
  PHOTO_LIMITS as L,
  type PhotoInfo,
  type PhotoItem,
} from '../../../../shared/contract/photos.ts';
import { ApiError } from '../../http/errors';
import { parse } from '../../http/validate';
import { Fail } from '../../lib/result';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import * as store from './store';

const shape: Record<string, z.ZodMiniType> = {};
for (const [k, [min, max]] of Object.entries(INFO_NUMBERS))
  shape[k] = z.optional(z.number().check(z.gte(min), z.lte(max)));
// A name, printable: no control characters, at most 80.
for (const k of INFO_TEXTS)
  shape[k] = z.optional(
    z.string().check(z.minLength(1), z.maxLength(INFO_LIMITS.text_chars), z.regex(/^[^\p{Cc}]+$/u)),
  );
/** Not strict: a key the allowlist does not have is dropped, not refused. */
const infoObject = z.object(shape);
const text = (max: number) => z.string().check(z.minLength(1), z.maxLength(max));

/** The request field as sent (checked by `sealInfo`). */
export const infoField = z.record(z.string(), z.unknown());
export const infoBody = z.strictObject({
  info: infoField,
  camera: z.optional(z.nullable(text(L.camera_chars))),
  film: z.optional(z.nullable(text(L.film_chars))),
});

/** The info's canonical JSON (the allowlist's keys, sorted), refused over 2 KB as sent. */
export function sealInfo(raw: Record<string, unknown>): string {
  if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > INFO_LIMITS.json_bytes)
    throw new ApiError('too_large');
  const kept = parse(infoObject, raw) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(kept).sort()) if (kept[k] !== undefined) out[k] = kept[k];
  return JSON.stringify(out);
}

/** The photo's info, or null before the phone has read its file. */
export function infoOf(db: Db, id: string): PhotoInfo | null {
  const r = db.one<{ info: string | null }>('SELECT info FROM photos WHERE id = ?', id);
  return r?.info ? (JSON.parse(r.info) as PhotoInfo) : null;
}

/** At registration: a new photo's info is written as it is; a retry's only when it differs. */
export function keep(w: Writer, id: string, json: string, created: boolean): void {
  if (!created && w.db.one<{ info: string | null }>('SELECT info FROM photos WHERE id = ?', id)?.info === json) return;
  w.db.run('UPDATE photos SET info = ? WHERE id = ?', json, id);
}

/** A photo registered without its info: the info, and its camera and film where it has none. The
 * same again writes nothing. */
export function put(
  w: Writer,
  id: string,
  json: string,
  words: { camera?: string | null; film?: string | null },
): { photo: PhotoItem; changed: boolean } {
  const r = store.byId(w.db, id);
  if (!r || r.deleted_at !== null) throw new Fail('not_found');
  const camera = r.camera ?? words.camera ?? null;
  const film = r.film ?? words.film ?? null;
  const had = w.db.one<{ info: string | null }>('SELECT info FROM photos WHERE id = ?', id)?.info ?? null;
  if (had === json && camera === r.camera && film === r.film) return { photo: store.toItem(r), changed: false };
  w.db.run(
    'UPDATE photos SET info = ?, camera = ?, film = ?, updated_at = ? WHERE id = ?',
    json,
    camera,
    film,
    w.at,
    id,
  );
  w.change('photo', `photo:${id}`);
  return { photo: store.toItem({ ...r, camera, film }), changed: true };
}
