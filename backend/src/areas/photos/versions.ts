// A photo's versions in Core (PHOTOS.md, Versions; API.md §11.26): canonical recipes kept under the
// photo, automatic (one per editing session) or named. An automatic version equal to the newest
// automatic one writes nothing, and the oldest automatic one goes past 20; a 21st named one is
// refused. Restoring is the phone's recipe put (recipe.ts), so it carries that undo; versions
// themselves leave no ledger row (they are the history, not a change to the photo).
import { type PhotoVersion, VERSION_LIMITS as V, type VersionKind } from '../../../../shared/contract/photos.ts';
import { Fail } from '../../lib/result';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';

type Row = {
  id: string;
  kind: VersionKind;
  name: string | null;
  recipe_json: string;
  recipe_sha: string;
  created_at: number;
};
const toItem = (r: Row): PhotoVersion => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  recipe: JSON.parse(r.recipe_json),
  created_at: r.created_at,
});

const live = (db: Db, photoId: string) => {
  const p = db.one<{ deleted_at: number | null }>('SELECT deleted_at FROM photos WHERE id = ?', photoId);
  if (!p || p.deleted_at !== null) throw new Fail('not_found');
};
const one = (db: Db, photoId: string, id: string) =>
  db.one<Row>(
    'SELECT id, kind, name, recipe_json, recipe_sha, created_at FROM photo_versions WHERE id = ? AND photo_id = ?',
    id,
    photoId,
  );
const count = (db: Db, photoId: string, kind: VersionKind) =>
  db.one<{ n: number }>('SELECT COUNT(*) AS n FROM photo_versions WHERE photo_id = ? AND kind = ?', photoId, kind)?.n ??
  0;

/** Newest first, both kinds (at most 40 rows). */
export const list = (db: Db, photoId: string): PhotoVersion[] =>
  db
    .all<Row>(
      `SELECT id, kind, name, recipe_json, recipe_sha, created_at FROM photo_versions
       WHERE photo_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      photoId,
      V.auto + V.named,
    )
    .map(toItem);

/** Adds a version. An automatic one like the newest automatic one is that one, unchanged. */
export function add(
  w: Writer,
  photoId: string,
  id: string,
  kind: VersionKind,
  name: string | null,
  json: string,
  sha: string,
): { version: PhotoVersion; created: boolean } {
  live(w.db, photoId);
  const again = one(w.db, photoId, id);
  if (again) return { version: toItem(again), created: false };
  if (kind === 'auto') {
    const newest = w.db.one<Row>(
      `SELECT id, kind, name, recipe_json, recipe_sha, created_at FROM photo_versions
       WHERE photo_id = ? AND kind = 'auto' ORDER BY created_at DESC, id DESC LIMIT 1`,
      photoId,
    );
    if (newest && newest.recipe_sha === sha) return { version: toItem(newest), created: false };
  } else if (count(w.db, photoId, 'named') >= V.named)
    throw new Fail('conflict', { reason: `a photo keeps ${V.named} named versions: delete one first` });
  w.db.run(
    'INSERT INTO photo_versions (id, photo_id, kind, name, recipe_json, recipe_sha, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    photoId,
    kind,
    name,
    json,
    sha,
    w.at,
  );
  if (kind === 'auto' && count(w.db, photoId, 'auto') > V.auto)
    w.db.run(
      `DELETE FROM photo_versions WHERE id IN (SELECT id FROM photo_versions WHERE photo_id = ? AND kind = 'auto'
       ORDER BY created_at, id LIMIT 1)`,
      photoId,
    );
  w.change('photo', `photo:${photoId}`);
  return { version: toItem(one(w.db, photoId, id) as Row), created: true };
}

/** A new name; an automatic version named becomes a named one (within the named cap). */
export function rename(w: Writer, photoId: string, id: string, name: string): PhotoVersion {
  live(w.db, photoId);
  const r = one(w.db, photoId, id);
  if (!r) throw new Fail('not_found');
  if (r.kind === 'auto' && count(w.db, photoId, 'named') >= V.named)
    throw new Fail('conflict', { reason: `a photo keeps ${V.named} named versions: delete one first` });
  w.db.run("UPDATE photo_versions SET name = ?, kind = 'named' WHERE id = ?", name, id);
  w.change('photo', `photo:${photoId}`);
  return toItem(one(w.db, photoId, id) as Row);
}

export function remove(w: Writer, photoId: string, id: string): void {
  live(w.db, photoId);
  if (!one(w.db, photoId, id)) throw new Fail('not_found');
  w.db.run('DELETE FROM photo_versions WHERE id = ?', id);
  w.change('photo', `photo:${photoId}`);
}
