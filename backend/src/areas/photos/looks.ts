// Looks in Core (PHOTOS.md, Looks; API.md §11.26): the owner's pre-made edits, each a canonical
// recipe over chosen panels. A PUT adds or replaces up to 50 by id in one commit (an import of many
// presets, or a look saved from the editor); the 501st is refused. Applying one is the phone's
// recipe put (recipe.ts), so it carries that undo; looks themselves leave no ledger row.
import * as z from 'zod/mini';
import {
  LOOK_LIMITS as K,
  LOOK_SOURCES,
  type LookSource,
  PASTE_PANELS,
  type PastePanel,
  type PhotoLook,
  type PhotoRecipe,
  type PutLook,
  panelOf,
  pasteOnto,
} from '../../../../shared/contract/photos.ts';
import { Fail, invalid } from '../../lib/result';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import { recipeObject } from './recipe';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const text = (max: number) => z.string().check(z.minLength(1), z.maxLength(max));
const maybe = (max: number) => z.optional(z.nullable(text(max)));
const panels = z.array(z.enum(PASTE_PANELS)).check(z.minLength(1), z.maxLength(PASTE_PANELS.length));
const look = z.strictObject({
  id: z.string().check(z.regex(UUID)),
  name: text(K.name_chars),
  source: z.enum(LOOK_SOURCES),
  recipe: recipeObject,
  panels,
  tag: maybe(K.tag_chars),
  film: maybe(K.film_chars),
  credit: maybe(K.credit_chars),
});
export const putBody = z.strictObject({ items: z.array(look).check(z.minLength(1), z.maxLength(K.per_request)) });
export const patchBody = z.strictObject({
  name: z.optional(text(K.name_chars)),
  recipe: z.optional(recipeObject),
  panels: z.optional(panels),
});

type Row = {
  id: string;
  name: string;
  source: LookSource;
  recipe_json: string;
  panels: string;
  tag: string | null;
  film: string | null;
  credit: string | null;
  created_at: number;
  updated_at: number;
};
const COLS = 'id, name, source, recipe_json, panels, tag, film, credit, created_at, updated_at';
const toItem = (r: Row): PhotoLook => ({
  id: r.id,
  name: r.name,
  source: r.source,
  recipe: JSON.parse(r.recipe_json),
  panels: JSON.parse(r.panels),
  tag: r.tag,
  film: r.film,
  credit: r.credit,
  created_at: r.created_at,
  updated_at: r.updated_at,
});
const one = (db: Db, id: string) => db.one<Row>(`SELECT ${COLS} FROM photo_looks WHERE id = ?`, id);

/** The recipe as stored: only its panels' keys, canonical, crop-shaped, at most 4 KB. */
export function sealed(recipe: PhotoRecipe, chosen: readonly PastePanel[], at = 'recipe') {
  const ps = [...new Set(chosen)].sort() as PastePanel[];
  for (const k of Object.keys(recipe))
    if (!ps.includes(panelOf(k) as PastePanel)) throw invalid(`${at}.${k}`, 'a key of a panel the look does not set');
  const r = pasteOnto({}, ps, recipe);
  if ((r.CropLeft ?? 0) >= (r.CropRight ?? 1) || (r.CropTop ?? 0) >= (r.CropBottom ?? 1))
    throw invalid(`${at}.Crop`, 'left before right, top before bottom');
  const json = JSON.stringify(r);
  if (new TextEncoder().encode(json).length > K.recipe_bytes) throw new Fail('too_large');
  return { json, panels: JSON.stringify(ps) };
}

/** Newest first, every look (at most 500 rows). */
export const list = (db: Db): PhotoLook[] =>
  db.all<Row>(`SELECT ${COLS} FROM photo_looks ORDER BY created_at DESC, id DESC LIMIT ?`, K.max).map(toItem);

/** Adds or replaces each look by id; refused whole when the new ones would pass the cap. */
export function put(w: Writer, items: PutLook[]): { items: PhotoLook[]; created: number } {
  const ready = items.map((l, i) => ({ l, ...sealed(l.recipe, l.panels, `items.${i}.recipe`), had: one(w.db, l.id) }));
  const fresh = new Set(ready.filter((x) => !x.had).map((x) => x.l.id)).size;
  if (fresh) {
    const n = w.db.one<{ n: number }>('SELECT COUNT(*) AS n FROM photo_looks')?.n ?? 0;
    if (n + fresh > K.max) throw new Fail('conflict', { reason: `${K.max} looks at most: delete some first` });
  }
  for (const { l, json, panels: ps, had } of ready)
    w.db.run(
      `INSERT INTO photo_looks (id, name, source, recipe_json, panels, tag, film, credit, thumb_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, source = excluded.source, recipe_json = excluded.recipe_json,
         panels = excluded.panels, tag = excluded.tag, film = excluded.film, credit = excluded.credit, updated_at = excluded.updated_at`,
      l.id,
      l.name,
      l.source,
      json,
      ps,
      l.tag ?? null,
      l.film ?? null,
      l.credit ?? null,
      had?.created_at ?? w.at,
      w.at,
    );
  return { items: ready.map((x) => toItem(one(w.db, x.l.id) as Row)), created: fresh };
}

/** A new name, or the recipe and panels from the current edit (both, or the recipe within its panels). */
export function patch(w: Writer, id: string, p: { name?: string; recipe?: PhotoRecipe; panels?: PastePanel[] }) {
  const r = one(w.db, id);
  if (!r) throw new Fail('not_found');
  const s = p.recipe || p.panels ? sealed(p.recipe ?? JSON.parse(r.recipe_json), p.panels ?? JSON.parse(r.panels)) : null;
  w.db.run(
    'UPDATE photo_looks SET name = ?, recipe_json = ?, panels = ?, updated_at = ? WHERE id = ?',
    p.name ?? r.name,
    s?.json ?? r.recipe_json,
    s?.panels ?? r.panels,
    w.at,
    id,
  );
  return toItem(one(w.db, id) as Row);
}

export function remove(w: Writer, id: string): void {
  if (!one(w.db, id)) throw new Fail('not_found');
  w.db.run('DELETE FROM photo_looks WHERE id = ?', id);
}
