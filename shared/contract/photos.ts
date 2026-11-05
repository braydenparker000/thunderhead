// Photos (docs/product/apps/PHOTOS.md, API.md §11.26): the shelf's records and the Drive link. The
// originals live in the owner's Google Drive, in the folder the app made; the Worker keeps one row
// per photo (ids, numbers, the camera's words) and a small JPEG preview in the private bucket. No
// pixel and no Drive token ever reaches the mind. Plain data with erasable types only.

import type { PhotoRecipe } from './photos-recipe.ts';

export * from './photos-recipe.ts';
export * from './photos-paste.ts';
export * from './photos-versions.ts';

export const PHOTO_LIMITS = {
  /** A preview the phone sends: a JPEG of at most this many bytes (2048 px at quality ~0.8). */
  preview_bytes: 400 * 1024,
  /** The preview's longest side, the two sizes Settings › Photos offers. */
  preview_sides: [1024, 2048],
  /** Days in one page of the shelf, and the thumbnails a day row carries. */
  page_days: 14,
  day_thumbs: 4,
  /** One day opened: at most this many photos, newest first. */
  day_photos: 200,
  /** Recently deleted keeps a photo this long, then it is purged with its preview. */
  deleted_days: 30,
  /** Photos purged in one tick, and files the daily reconciliation registers in one run. */
  purge_step: 50,
  /** The daily Drive pass's outbound calls: a token, at most 20 trashes and one listing of at most
   * 200 files, so a run stays under 25 subrequests (the free plan allows 50). */
  trash_per_run: 20,
  reconcile_files: 200,
  /** Import from Drive (POST /v1/photos/from-drive): files the picker hands over at once, and the
   * ones one request registers (one Drive call each, so a request stays far under 50 subrequests;
   * the phone sends the rest in further requests). */
  pick_max: 100,
  pick_per_request: 20,
  /** A file name, a camera's name and a film simulation's name, in characters. */
  name_chars: 200,
  camera_chars: 80,
  film_chars: 40,
  /** An original's largest size (Drive takes far more; this only refuses nonsense). */
  bytes_max: 2 * 1024 * 1024 * 1024,
  /** A recipe's canonical JSON, in bytes (all controls and four full curves fit in about 3 KB). */
  recipe_bytes: 8 * 1024,
  /** A photo whose upload the browser runs in the background is pending (no Drive id yet); after
   * this many days the shelf says it did not upload. GET /v1/photos/pending lists at most `pending_max`. */
  pending_days: 7,
  pending_max: 200,
  /** A RAW and a JPEG of the same base name taken within this many ms of each other are one stack. */
  pair_ms: 2000,
} as const;

/** The formats the picker takes. HEIC only where the phone's browser decodes it. */
export const PHOTO_FORMATS = ['raf', 'dng', 'jpeg', 'heic', 'other'] as const;
export type PhotoFormat = (typeof PHOTO_FORMATS)[number];
export const PHOTO_FLAGS = ['pick', 'reject'] as const;
export type PhotoFlag = (typeof PHOTO_FLAGS)[number];
/** The shelf's filter chips (GET /v1/photos?filter=): a stack counts as its RAW; JPEG is the photos
 * that are not RAW (JPEG and HEIC, not in a stack). */
export const PHOTO_FILTERS = ['all', 'favorites', 'stars3', 'stars4', 'stars5', 'raw', 'jpeg', 'edited', 'unedited'] as const;
export type PhotoFilter = (typeof PHOTO_FILTERS)[number];

/** The folder the app makes in the owner's Drive on first connect. */
export const DRIVE_FOLDER = 'Thunderhead Photos';
/** Exports the phone sends back to Drive: a folder beside DRIVE_FOLDER the phone makes on first use. */
export const DRIVE_EXPORTS = 'Thunderhead Exports';
/** The one scope asked for: files this app creates, nothing else in the Drive. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface PhotoItem {
  id: string;
  /** The original's id in Drive; null while its upload runs in the background (a pending photo:
   * on the shelf with its thumbnail, but not exported or pasted to until the id comes). */
  drive_id: string | null;
  name: string;
  format: PhotoFormat;
  bytes: number;
  sha256: string | null;
  camera: string | null;
  /** Fujifilm's film simulation as the file names it (`Classic Chrome`), the camera look. */
  film: string | null;
  width: number | null;
  height: number | null;
  /** Capture time (EXIF), or the file's time when it has none. */
  taken_at: number;
  /** Its day in the owner's zone, `YYYY-MM-DD`. */
  day: string;
  /** 0–5 stars; a stack's two photos share it, and the heart. */
  rating: number;
  favorite: boolean;
  flag: PhotoFlag | null;
  /** The other photo of its stack (a RAW and its JPEG, the same base name, taken within 2 s), or null.
   * The shelf shows a stack once, as its RAW. */
  pair_id: string | null;
  /** Whether the Worker holds a preview (GET /v1/photos/:id/preview). */
  preview: boolean;
  /** Whether it has a recipe other than "as shot" (PUT /v1/photos/:id/recipe). */
  edited: boolean;
  deleted_at: number | null;
  created_at: number;
}

/** PUT /v1/photos/:id: what the phone read from the file once Drive has it, or, with `drive_id`
 * null, before a background upload starts (the Drive id comes later by PATCH). */
export interface PutPhotoRequest {
  drive_id: string | null;
  name: string;
  format: PhotoFormat;
  bytes: number;
  sha256: string;
  camera?: string | null;
  film?: string | null;
  width?: number | null;
  height?: number | null;
  /** EXIF capture time; else the file's own time. */
  taken_at: number;
}

/** GET /v1/photos/:id: the photo and its recipe (`{}` as shot). */
export interface PhotoResponse {
  photo: PhotoItem;
  recipe: PhotoRecipe;
}

/** A stack's rating, heart and flag go on both its photos. */
export interface PatchPhotoRequest {
  rating?: number;
  favorite?: boolean;
  flag?: PhotoFlag | null;
  /** A pending photo's Drive id once its background upload ended (checked with Drive; the same
   * again writes nothing; another id on a photo that has one is a conflict). */
  drive_id?: string;
}

/** GET /v1/photos/pending: photos whose upload has not finished, newest first. */
export interface PhotoPendingResponse {
  items: PhotoItem[];
}

export interface PhotoDay {
  day: string;
  count: number;
  photos: PhotoItem[];
}

/** GET /v1/photos/:id/around?filter=: the photos either side of this one in the shelf's order
 * under that filter (newest first), for culling in the editor. */
export interface PhotoAroundResponse {
  newer: string | null;
  older: string | null;
}

/** GET /v1/photos: days newest first (`?before=<day>` pages on; `?day=` one whole day; `?filter=`). */
export interface PhotoShelfResponse {
  days: PhotoDay[];
  next: string | null;
}

/** GET /v1/photos/drive: whether Drive is linked, the folder by name, and a revoked grant. */
export interface DriveStatus {
  configured: boolean;
  connected: boolean;
  folder_name: string | null;
  revoked: boolean;
  connected_at: number | null;
  /** The Google account that gave the consent (the owner's phone only, never the mind). */
  account: string | null;
  /** The browser key Google's picker needs (public by design, restricted at Google to the Picker
   * API and the site's origin; SETUP.md §R5); empty until the owner sets GOOGLE_PICKER_KEY. */
  picker_key: string;
  /** The Cloud project's number (the OAuth client id's first part): the picker's app id, so a file
   * picked is granted to this app; empty without a client. */
  picker_app: string;
}

/** POST /v1/photos/upload-token: a short-lived Drive token for the phone's own resumable upload. */
export interface UploadTokenResponse {
  access_token: string;
  expires_at: number;
  folder_id: string;
}

/** A file the daily reconciliation found in the folder, or one the owner picked in Drive (Drive's
 * own words, checked). `modified` is the file's own time: its last change for the listing, its
 * creation for a pick; a pick also carries what Drive read from the image (`shot` is the EXIF time,
 * `YYYY:MM:DD HH:MM:SS` on the camera's clock), its size and its SHA-256 when Drive gives them. */
export interface DriveFile {
  id: string;
  name: string;
  size: number;
  modified: number;
  mime: string;
  shot?: string | null;
  width?: number | null;
  height?: number | null;
  sha256?: string | null;
}

/** POST /v1/photos/from-drive: Drive ids the owner picked (at most 20 a request). */
export interface FromDriveRequest {
  ids: string[];
}

/** The picked files now on the shelf (no preview yet: the phone makes them), the ones it already
 * had, by Drive id, and the ones refused with why (not a photo, a folder, in the trash, not found). */
export interface FromDriveResponse {
  added: PhotoItem[];
  already: string[];
  refused: { id: string; issue: string }[];
}

/** A photo's format from its name and type, as the phone and the reconciliation both read it. */
export function photoFormat(name: string, mime = ''): PhotoFormat {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'raf') return 'raf';
  if (ext === 'dng') return 'dng';
  if (ext === 'jpg' || ext === 'jpeg' || mime === 'image/jpeg') return 'jpeg';
  if (ext === 'heic' || ext === 'heif' || mime === 'image/heic') return 'heic';
  return 'other';
}
