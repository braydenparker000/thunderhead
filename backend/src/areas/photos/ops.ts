// The shelf's rules inside Core (PHOTOS.md §3.1): a photo is registered once its original is in
// Drive (the same id again is a retry; a Drive file already on the shelf is that photo), rated and
// flagged, moved to Recently deleted and back, given its preview; the daily Drive pass and an import
// from Drive register files the shelf does not know. Its day is its capture day in the owner's zone.
import {
  type DriveFile,
  PHOTO_LIMITS as L,
  type PatchPhotoRequest,
  type PhotoItem,
  type PutPhotoRequest,
  photoFormat,
} from '../../../../shared/contract/photos.ts';
import { Fail } from '../../lib/result';
import { DAY, ownerDay, zonedMinute } from '../../lib/time';
import type { Writer } from '../../objects/commit';
import * as store from './store';

/** Registers a photo whose original is in Drive. Returns the photo and whether it is new. */
export function put(w: Writer, id: string, r: PutPhotoRequest, tz: string): { photo: PhotoItem; created: boolean } {
  const had = store.byId(w.db, id) ?? store.byDrive(w.db, r.drive_id);
  if (had) {
    if (had.drive_id !== r.drive_id) throw new Fail('conflict');
    return { photo: store.toItem(had), created: false };
  }
  const row: store.PhotoRow = {
    id,
    drive_id: r.drive_id,
    name: r.name,
    format: r.format,
    bytes: r.bytes,
    sha256: r.sha256,
    camera: r.camera ?? null,
    film: r.film ?? null,
    width: r.width ?? null,
    height: r.height ?? null,
    taken_at: r.taken_at,
    day: ownerDay(r.taken_at, tz),
    rating: 0,
    flag: null,
    preview_key: null,
    preview_sha: null,
    recipe_sha: null,
    deleted_at: null,
    created_at: w.at,
    updated_at: w.at,
  };
  store.insert(w.db, row);
  w.change('photo', `photo:${id}`);
  return { photo: store.toItem(row), created: true };
}

const live = (w: Writer, id: string): store.PhotoRow => {
  const r = store.byId(w.db, id);
  if (!r || r.deleted_at !== null) throw new Fail('not_found');
  return r;
};

export function patch(w: Writer, id: string, p: PatchPhotoRequest): PhotoItem {
  const r = live(w, id);
  const rating = p.rating ?? r.rating;
  const flag = p.flag === undefined ? r.flag : p.flag;
  if (rating === r.rating && flag === r.flag) return store.toItem(r);
  store.setRating(w.db, id, rating, flag, w.at);
  w.change('photo', `photo:${id}`);
  return store.toItem({ ...r, rating, flag });
}

/** To Recently deleted: off the shelf now, purged with its preview 30 days on. */
export function remove(w: Writer, id: string): PhotoItem {
  const r = live(w, id);
  store.setDeleted(w.db, id, w.at, w.at);
  w.ledger({
    kind: 'note',
    actor: 'owner',
    what: 'moved a photo to Recently deleted',
    why: `kept ${L.deleted_days} days, then deleted with its preview and its original moved to Drive's trash`,
    ref: `photo:${id}`,
    undoable: false,
  });
  w.change('photo', `photo:${id}`);
  return store.toItem({ ...r, deleted_at: w.at });
}

export function restore(w: Writer, id: string): PhotoItem {
  const r = store.byId(w.db, id);
  if (!r || r.deleted_at === null) throw new Fail('not_found');
  store.setDeleted(w.db, id, null, w.at);
  w.change('photo', `photo:${id}`);
  return store.toItem({ ...r, deleted_at: null });
}

export function preview(w: Writer, id: string, key: string, sha: string): PhotoItem {
  const r = live(w, id);
  store.setPreview(w.db, id, key, sha, w.at);
  w.change('photo', `photo:${id}`);
  return store.toItem({ ...r, preview_key: key, preview_sha: sha });
}

/** A Drive file the shelf does not know, as a photo with no preview (the phone makes one): the one
 * registration the daily pass and an import from Drive share. Dated by its EXIF time on the
 * camera's clock, read in the owner's zone, else by its own time in Drive (never in the future). */
function found(w: Writer, f: DriveFile, tz: string, newId: (at: number) => string): store.PhotoRow {
  const shot = f.shot ? /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(f.shot) : null;
  const exif = shot
    ? zonedMinute(`${shot[1]}-${shot[2]}-${shot[3]}`, Number(shot[4]) * 60 + Number(shot[5]), tz) +
      Number(shot[6]) * 1000
    : Number.NaN;
  const at = Math.max(0, Math.min(Number.isFinite(exif) ? exif : f.modified, w.at));
  const row: store.PhotoRow = {
    id: newId(at),
    drive_id: f.id,
    name: f.name.slice(0, L.name_chars),
    format: photoFormat(f.name, f.mime),
    bytes: f.size,
    sha256: f.sha256 ?? null,
    camera: null,
    film: null,
    width: f.width ?? null,
    height: f.height ?? null,
    taken_at: at,
    day: ownerDay(at, tz),
    rating: 0,
    flag: null,
    preview_key: null,
    preview_sha: null,
    recipe_sha: null,
    deleted_at: null,
    created_at: w.at,
    updated_at: w.at,
  };
  store.insert(w.db, row);
  return row;
}

/** The Drive pass's files (at most 200 a run): each one the shelf does not know, and that was not
 * purged, becomes a photo with no preview. Returns how many. */
export function reconcile(w: Writer, files: DriveFile[], tz: string, newId: (at: number) => string): number {
  let n = 0;
  for (const f of files.slice(0, L.reconcile_files)) {
    if (store.byDrive(w.db, f.id) || store.isGone(w.db, f.id)) continue;
    found(w, f, tz, newId);
    n++;
  }
  if (n) w.change('photo');
  return n;
}

/** Files the owner picked in Drive (at most 20 a request): each one the shelf does not know becomes
 * a photo the same way (no ledger row, as an import from the phone); a known one is `already`. One
 * picked again after its purge is wanted after all: its original no longer goes to Drive's trash. */
export function fromDrive(w: Writer, files: DriveFile[], tz: string, newId: (at: number) => string) {
  const added: PhotoItem[] = [];
  const already: string[] = [];
  for (const f of files.slice(0, L.pick_per_request)) {
    if (store.byDrive(w.db, f.id)) {
      already.push(f.id);
      continue;
    }
    if (store.isGone(w.db, f.id)) store.trashed(w.db, [f.id]);
    const row = found(w, f, tz, newId);
    w.change('photo', `photo:${row.id}`);
    added.push(store.toItem(row));
  }
  return { added, already };
}

/** What the purge takes now: photos deleted more than 30 days ago, a step at a time. */
export const purgeDue = (w: Pick<Writer, 'db'>, now: number) =>
  store.due(w.db, now - L.deleted_days * DAY, L.purge_step);

/** One purge step's rows, after the previews left the bucket; the ledger says how many, nothing more. */
export function purge(w: Writer, rows: ReturnType<typeof purgeDue>): void {
  store.purge(
    w.db,
    rows.map((r) => r.id),
    rows.flatMap((r) => (r.drive_id ? [r.drive_id] : [])),
    w.at,
  );
  w.ledger({
    kind: 'note',
    actor: 'worker',
    what: rows.length === 1 ? 'purged a deleted photo' : `purged ${rows.length} deleted photos`,
    why: `deleted ${L.deleted_days} days ago: Recently deleted keeps one that long`,
    undoable: false,
  });
  w.change('photo');
}
