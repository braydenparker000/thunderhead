// Photos' half of the Core object (areas/photos, PHOTOS.md §3.1): the shelf by day in the owner's
// zone, a photo's rating, flag, delete and restore, its preview's key, the purge of Recently
// deleted (with the cron's prune pass, previews out of the bucket first) and the daily Drive pass's
// two ends (what to trash and from where to list; then the files it found). A code layer of the one
// Core class.
import {
  type DriveFile,
  PHOTO_LIMITS as L,
  type PastePhotosResponse,
  type PatchPhotoRequest,
  type PhotoItem,
  type PhotoLook,
  type PhotoResponse,
  type PhotoShelfResponse,
  type PhotoVersion,
  type PutLook,
  type PutPhotoRequest,
  type VersionKind,
} from '../../../shared/contract/photos.ts';
import { logicalDay } from '../areas/conversation/day';
import { quotaHold } from '../areas/meter/quota';
import * as looks from '../areas/photos/looks';
import * as ops from '../areas/photos/ops';
import * as paste from '../areas/photos/paste';
import * as recipe from '../areas/photos/recipe';
import * as store from '../areas/photos/store';
import * as versions from '../areas/photos/versions';
import { getSetting, putSetting } from '../areas/settings/store';
import { uuidv7 } from '../lib/ids';
import type { Out } from '../lib/result';
import { CoreVerbs } from './core-verbs';

export abstract class CorePhotos extends CoreVerbs {
  /** Days before `before` (or the newest), newest first, each with its count and first four. */
  photosShelf(before: string | null): PhotoShelfResponse {
    const days = store.days(this.db, before, L.page_days + 1);
    const page = days.slice(0, L.page_days);
    return {
      days: page.map((d) => ({
        day: d.day,
        count: d.n,
        photos: store.ofDay(this.db, d.day, L.day_thumbs).map(store.toItem),
      })),
      next: days.length > L.page_days ? (page.at(-1)?.day ?? null) : null,
    };
  }

  photosDay(day: string): PhotoShelfResponse {
    const photos = store.ofDay(this.db, day, L.day_photos).map(store.toItem);
    return { days: photos.length ? [{ day, count: photos.length, photos }] : [], next: null };
  }

  photo(id: string): PhotoItem | null {
    const r = store.byId(this.db, id);
    return r ? store.toItem(r) : null;
  }

  /** One photo with its recipe (`{}` as shot). */
  photoWithRecipe(id: string): PhotoResponse | null {
    const r = store.byId(this.db, id);
    return r ? { photo: store.toItem(r), recipe: recipe.recipeOf(this.db, id) } : null;
  }

  /** The recipe in its canonical JSON and hash (routes.ts seals it); the same hash writes nothing. */
  putPhotoRecipe(id: string, json: string, sha: string): Out<{ photo: PhotoItem; changed: boolean }> {
    return this.run((w) => recipe.put(w, id, json, sha));
  }

  /** A copied edit onto up to 20 photos, one ledger row (areas/photos/paste.ts). */
  pastePhotos(b: ReturnType<typeof paste.normal>): Out<PastePhotosResponse> {
    return this.run((w) => paste.paste(w, b));
  }

  // --- versions (areas/photos/versions.ts) -------------------------------------------------------

  photoVersions(id: string): PhotoVersion[] | null {
    return store.byId(this.db, id) ? versions.list(this.db, id) : null;
  }

  addPhotoVersion(id: string, vid: string, kind: VersionKind, name: string | null, json: string, sha: string) {
    return this.run((w) => versions.add(w, id, vid, kind, name, json, sha));
  }

  renamePhotoVersion(id: string, vid: string, name: string): Out<PhotoVersion> {
    return this.run((w) => versions.rename(w, id, vid, name));
  }

  deletePhotoVersion(id: string, vid: string): Out<void> {
    return this.run((w) => versions.remove(w, id, vid));
  }

  // --- looks (areas/photos/looks.ts) -------------------------------------------------------------

  photoLooks(): PhotoLook[] {
    return looks.list(this.db);
  }

  putPhotoLooks(items: PutLook[]): Out<{ items: PhotoLook[]; created: number }> {
    return this.run((w) => looks.put(w, items));
  }

  patchPhotoLook(id: string, p: Parameters<typeof looks.patch>[2]): Out<PhotoLook> {
    return this.run((w) => looks.patch(w, id, p));
  }

  deletePhotoLook(id: string): Out<void> {
    return this.run((w) => looks.remove(w, id));
  }

  photoPreviewKey(id: string): { key: string; sha: string } | null {
    const r = store.byId(this.db, id);
    return r?.preview_key && r.preview_sha && r.deleted_at === null ? { key: r.preview_key, sha: r.preview_sha } : null;
  }

  /** Photos whose background upload has no Drive id yet, newest first. */
  photosPending(): PhotoItem[] {
    return store.pending(this.db, L.pending_max).map(store.toItem);
  }

  photosDeleted(): PhotoItem[] {
    return store.deleted(this.db, 200).map(store.toItem);
  }

  putPhoto(id: string, r: PutPhotoRequest): Out<{ photo: PhotoItem; created: boolean }> {
    return this.run((w) => ops.put(w, id, r, this.tz()));
  }

  patchPhoto(id: string, p: PatchPhotoRequest): Out<PhotoItem> {
    return this.run((w) => ops.patch(w, id, p));
  }

  deletePhoto(id: string): Out<PhotoItem> {
    return this.run((w) => ops.remove(w, id));
  }

  restorePhoto(id: string): Out<PhotoItem> {
    return this.run((w) => ops.restore(w, id));
  }

  photoPreview(id: string, key: string, sha: string): Out<PhotoItem> {
    return this.run((w) => ops.preview(w, id, key, sha));
  }

  // --- the daily Drive pass (areas/photos/reconcile.ts runs it from the cron) ----------------------

  /** Whether today's pass is still to run, and if so where the listing goes on from and which
   * purged originals go to Drive's trash. Nothing is due while the rows guard holds heavy work. */
  photosDrive(now = Date.now()): { due: boolean; cursor: string | null; gone: string[] } {
    const today = logicalDay(now, this.tz());
    if (getSetting(this.db, 'photos.drive_day') === today || quotaHold(this.db, now) !== null)
      return { due: false, cursor: null, gone: [] };
    const cursor = getSetting(this.db, 'photos.drive_cursor');
    return {
      due: true,
      cursor: typeof cursor === 'string' ? cursor : null,
      gone: store.gone(this.db, L.trash_per_run),
    };
  }

  /** The pass's result in one commit: the files the shelf does not know registered (at most 200),
   * the trashed originals forgotten, the listing's place kept, the day done. Returns how many new. */
  photosReconciled(files: DriveFile[], cursor: string | null, trashed: string[], now = Date.now()): Out<number> {
    return this.run((w) => {
      const n = ops.reconcile(w, files, this.tz(), uuidv7);
      store.trashed(w.db, trashed);
      if (cursor) putSetting(w.db, 'photos.drive_cursor', cursor, 'worker', w.at);
      putSetting(w.db, 'photos.drive_day', logicalDay(now, this.tz()), 'worker', w.at);
      return n;
    });
  }

  /** Files picked in Drive (areas/photos/pick.ts checked each with Drive), registered in one commit. */
  photosFromDrive(files: DriveFile[]): Out<{ added: PhotoItem[]; already: string[] }> {
    return this.run((w) => ops.fromDrive(w, files, this.tz(), uuidv7));
  }

  // --- the purge, with the cron's prune pass ----------------------------------------------------

  protected override async pruneDaily(now: number, today: string): Promise<number> {
    return (await super.pruneDaily(now, today)) + (await this.purgePhotos(now));
  }

  /** Photos deleted more than 30 days ago, a step a tick: the previews leave the bucket, then one
   * commit takes the rows and keeps their Drive ids for the trash. Waits while the guard holds. */
  protected async purgePhotos(now: number): Promise<number> {
    const rows = ops.purgeDue({ db: this.db }, now);
    if (!rows.length || quotaHold(this.db, now) !== null) return 0;
    const keys = rows.flatMap((r) => (r.preview_key ? [r.preview_key] : []));
    const vault = (this.env as { VAULT?: R2Bucket }).VAULT;
    if (keys.length && !vault) return 0;
    if (keys.length) await vault?.delete(keys);
    this.write((w) => ops.purge(w, rows), now);
    return rows.length;
  }
}
