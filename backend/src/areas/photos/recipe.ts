// A photo's recipe in Core (PHOTOS.md, the editor; API.md §11.26): checked against the contract's
// ranges, stored canonical (defaults left out, keys sorted) with its hash, so the phone's save as the
// sliders move is idempotent: the same recipe again writes nothing and leaves no ledger row. Each
// change is a ledger row whose undo is the recipe before, refused once a newer edit came after.
import * as z from 'zod/mini';
import {
  CURVE_POINTS,
  canonicalRecipe,
  PHOTO_LIMITS as L,
  type PhotoItem,
  type PhotoRecipe,
  RECIPE_CURVES,
  RECIPE_NUMBERS,
  RECIPE_WB,
  WB_MODES,
} from '../../../../shared/contract/photos.ts';
import { ApiError } from '../../http/errors';
import { Fail } from '../../lib/result';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import { sha256 } from '../import/vault';
import * as store from './store';

const num = (min: number, max: number) => z.optional(z.number().check(z.gte(min), z.lte(max)));
const level = z.number().check(z.int(), z.gte(0), z.lte(255));
const curve = z.optional(
  z.array(z.tuple([level, level])).check(
    z.minLength(CURVE_POINTS.min),
    z.maxLength(CURVE_POINTS.max),
    z.refine((c) => c.every((p, i) => i === 0 || p[0] > (c[i - 1]?.[0] ?? -1)), 'inputs strictly increasing'),
  ),
);
const shape: Record<string, z.ZodMiniType> = {
  WhiteBalance: z.optional(z.enum(WB_MODES)),
  Temperature: num(...RECIPE_WB.Temperature),
  Tint: num(...RECIPE_WB.Tint),
  ConvertToGrayscale: z.optional(z.boolean()),
};
for (const [k, [min, max]] of Object.entries(RECIPE_NUMBERS)) shape[k] = num(min, max);
for (const k of RECIPE_CURVES) shape[k] = curve;
export const recipeBody = z.strictObject({ recipe: z.strictObject(shape) });

/** The canonical JSON and its hash, refused when it is larger than any real recipe. */
export async function sealRecipe(r: PhotoRecipe): Promise<{ json: string; sha: string }> {
  const json = JSON.stringify(canonicalRecipe(r));
  if (json.length > L.recipe_bytes) throw new ApiError('too_large');
  return { json, sha: json === '{}' ? '' : await sha256(new TextEncoder().encode(json)) };
}

const row = (db: Db, id: string) =>
  db.one<{ recipe_json: string | null; recipe_sha: string | null; deleted_at: number | null }>(
    'SELECT recipe_json, recipe_sha, deleted_at FROM photos WHERE id = ?',
    id,
  );

export const recipeOf = (db: Db, id: string): PhotoRecipe => JSON.parse(row(db, id)?.recipe_json ?? '{}');

function write(db: Db, id: string, json: string | null, sha: string | null, at: number): void {
  db.run('UPDATE photos SET recipe_json = ?, recipe_sha = ?, updated_at = ? WHERE id = ?', json, sha, at, id);
}

/** Stores the recipe (`sha` '' is "as shot"). Returns the photo and whether anything changed. */
export function put(w: Writer, id: string, json: string, sha: string): { photo: PhotoItem; changed: boolean } {
  const r = row(w.db, id);
  if (!r || r.deleted_at !== null) throw new Fail('not_found');
  const had = r.recipe_sha ?? '';
  const photo = () => store.toItem(store.byId(w.db, id) as store.PhotoRow);
  if (had === sha) return { photo: photo(), changed: false };
  write(w.db, id, sha ? json : null, sha || null, w.at);
  w.ledger({
    kind: 'note',
    actor: 'owner',
    what: sha ? 'edited a photo' : 'set a photo back to as shot',
    why: 'the recipe saves as the sliders move; undo puts the one before back',
    ref: `photo:${id}`,
    undo: { op: 'photo.recipe', args: { id, before: r.recipe_json, before_sha: had, after_sha: sha } },
  });
  w.change('photo', `photo:${id}`);
  return { photo: photo(), changed: true };
}

export const PHOTO_UNDO_OPS = ['photo.recipe'];

/** The ledger's undo: the recipe before, unless the photo was edited again since (409) or is gone. */
export function undo(w: Writer, _op: string, args: Record<string, unknown>): void {
  const id = String(args.id ?? '');
  const r = row(w.db, id);
  if (!r) throw new Fail('not_found');
  if ((r.recipe_sha ?? '') !== String(args.after_sha ?? ''))
    throw new Fail('conflict', { reason: 'the photo was edited again since' });
  const before = typeof args.before === 'string' ? args.before : null;
  write(w.db, id, before, before ? String(args.before_sha) : null, w.at);
  w.change('photo', `photo:${id}`);
}
