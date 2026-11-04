// Paste a copied edit onto photos (PHOTOS.md, Copy and paste; API.md §11.26): up to 20 photos in one
// commit. Each photo's recipe keeps its own keys outside the copied panels and takes the copy's inside
// them (photos-paste.ts `pasteOnto`), canonical and hashed as a recipe put is. A photo whose edit is
// replaced gets an automatic version of that edit first (versions.ts, the same caps); a photo that
// already has the look writes nothing. ONE ledger row for the paste, whose undo puts every changed
// photo's recipe back; a photo edited again since keeps that edit. The request's hash (photos, panels,
// copy) rides on the row, so the same paste again answers that row and writes nothing.
import { createHash } from 'node:crypto';
import * as z from 'zod/mini';
import {
  PHOTO_LIMITS as L,
  PASTE_LIMITS,
  PASTE_PANELS,
  type PastePanel,
  type PastePhotosResponse,
  type PhotoRecipe,
  panelOf,
  pasteOnto,
} from '../../../../shared/contract/photos.ts';
import { ApiError } from '../../http/errors';
import { Fail, invalid } from '../../lib/result';
import type { Writer } from '../../objects/commit';
import { liveByHash } from '../ledger/hash';
import { recipeObject } from './recipe';
import { snapshot } from './versions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const pasteBody = z.strictObject({
  ids: z.array(z.string().check(z.regex(UUID))).check(z.minLength(1), z.maxLength(PASTE_LIMITS.photos)),
  panels: z.array(z.enum(PASTE_PANELS)).check(z.minLength(1), z.maxLength(PASTE_PANELS.length)),
  recipe: recipeObject,
});
export type PasteBody = { ids: string[]; panels: PastePanel[]; recipe: PhotoRecipe };
/** How far back the same paste again finds its row (a retry comes within seconds). */
const AGAIN_MS = 3_600_000;

const hex = (s: string) => createHash('sha256').update(s).digest('hex');

/** The body as the route reads it: each photo and panel once, sorted; the copy's keys all in its panels. */
export function normal(b: PasteBody): PasteBody & { hash: string } {
  const ids = [...new Set(b.ids)].sort();
  const panels = [...new Set(b.panels)].sort() as PastePanel[];
  for (const k of Object.keys(b.recipe))
    if (!panels.includes(panelOf(k) as PastePanel))
      throw new ApiError('validation', [{ path: `recipe.${k}`, issue: 'a key of a panel not copied' }]);
  const recipe = pasteOnto({}, panels, b.recipe);
  return { ids, panels, recipe, hash: hex(JSON.stringify({ ids, panels, recipe })) };
}

type Row = { id: string; recipe_json: string | null; recipe_sha: string | null; deleted_at: number | null };
type Step = { id: string; before: string | null; before_sha: string; after_sha: string };

export function paste(w: Writer, b: ReturnType<typeof normal>): PastePhotosResponse {
  const rows = b.ids.map((id) => {
    const r = w.db.one<Row>('SELECT id, recipe_json, recipe_sha, deleted_at FROM photos WHERE id = ?', id);
    if (!r || r.deleted_at !== null) throw new Fail('not_found', { reason: 'a photo is not on the shelf' });
    return r;
  });
  const steps: Step[] = [];
  const items = rows.map((r) => {
    const before: PhotoRecipe = JSON.parse(r.recipe_json ?? '{}');
    const after = pasteOnto(before, b.panels, b.recipe);
    if ((after.CropLeft ?? 0) >= (after.CropRight ?? 1) || (after.CropTop ?? 0) >= (after.CropBottom ?? 1))
      throw invalid('recipe.Crop', 'left before right, top before bottom');
    const json = JSON.stringify(after);
    if (json.length > L.recipe_bytes) throw new Fail('too_large');
    const sha = json === '{}' ? '' : hex(json);
    const had = r.recipe_sha ?? '';
    if (sha === had) return { id: r.id, changed: false, recipe: after, before };
    if (had && r.recipe_json) snapshot(w, r.id, r.recipe_json, had);
    w.db.run(
      'UPDATE photos SET recipe_json = ?, recipe_sha = ?, updated_at = ? WHERE id = ?',
      sha ? json : null,
      sha || null,
      w.at,
      r.id,
    );
    steps.push({ id: r.id, before: r.recipe_json, before_sha: had, after_sha: sha });
    return { id: r.id, changed: true, recipe: after, before };
  });
  if (!steps.length) return { items, ledger_id: liveByHash(w.db, b.hash, w.at - AGAIN_MS) };
  const n = steps.length;
  const ledgerId = w.ledger({
    kind: 'note',
    actor: 'owner',
    what: n === 1 ? 'pasted a look to a photo' : `pasted a look to ${n} photos`,
    why: `copied ${b.panels.join(', ')} from another photo; undo puts each recipe before back`,
    undo: { op: 'photo.paste', args: { steps } },
    req_sha256: b.hash,
  });
  w.change('photo');
  return { items, ledger_id: ledgerId };
}

/** The ledger's undo: each photo the paste changed and nobody edited since, back to its recipe before. */
export function undo(w: Writer, args: Record<string, unknown>): void {
  const steps = Array.isArray(args.steps) ? (args.steps as Step[]) : [];
  let back = 0;
  for (const s of steps) {
    const r = w.db.one<Row>('SELECT id, recipe_json, recipe_sha, deleted_at FROM photos WHERE id = ?', String(s.id));
    if (!r || (r.recipe_sha ?? '') !== String(s.after_sha ?? '')) continue;
    const before = typeof s.before === 'string' ? s.before : null;
    w.db.run(
      'UPDATE photos SET recipe_json = ?, recipe_sha = ?, updated_at = ? WHERE id = ?',
      before,
      before ? String(s.before_sha) : null,
      w.at,
      r.id,
    );
    back++;
  }
  if (!back) throw new Fail('conflict', { reason: 'every photo was edited again since' });
  w.change('photo');
}
