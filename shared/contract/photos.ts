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
  /** A file name, a camera's name and a film simulation's name, in characters. */
  name_chars: 200,
  camera_chars: 80,
  film_chars: 40,
  /** An original's largest size (Drive takes far more; this only refuses nonsense). */
  bytes_max: 2 * 1024 * 1024 * 1024,
  /** A recipe's canonical JSON, in bytes (all controls and four full curves fit in about 3 KB). */
  recipe_bytes: 8 * 1024,
} as const;

/** The formats the picker takes. HEIC only where the phone's browser decodes it. */
export const PHOTO_FORMATS = ['raf', 'dng', 'jpeg', 'heic', 'other'] as const;
export type PhotoFormat = (typeof PHOTO_FORMATS)[number];
export const PHOTO_FLAGS = ['pick', 'reject'] as const;
export type PhotoFlag = (typeof PHOTO_FLAGS)[number];

/** The folder the app makes in the owner's Drive on first connect. */
export const DRIVE_FOLDER = 'Thunderhead Photos';
/** Exports the phone sends back to Drive: a folder beside DRIVE_FOLDER the phone makes on first use. */
export const DRIVE_EXPORTS = 'Thunderhead Exports';
/** The one scope asked for: files this app creates, nothing else in the Drive. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface PhotoItem {
  id: string;
  /** The original's id in Drive; null until its upload finished. */
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
  rating: number;
  flag: PhotoFlag | null;
  /** Whether the Worker holds a preview (GET /v1/photos/:id/preview). */
  preview: boolean;
  /** Whether it has a recipe other than "as shot" (PUT /v1/photos/:id/recipe). */
  edited: boolean;
  deleted_at: number | null;
  created_at: number;
}

/** PUT /v1/photos/:id: what the phone read from the file once Drive has it. */
export interface PutPhotoRequest {
  drive_id: string;
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

export interface PatchPhotoRequest {
  rating?: number;
  flag?: PhotoFlag | null;
}

export interface PhotoDay {
  day: string;
  count: number;
  photos: PhotoItem[];
}

/** GET /v1/photos: days newest first (`?before=<day>` pages on; `?day=` one whole day). */
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
}

/** POST /v1/photos/upload-token: a short-lived Drive token for the phone's own resumable upload. */
export interface UploadTokenResponse {
  access_token: string;
  expires_at: number;
  folder_id: string;
}

/** A file the daily reconciliation found in the folder (Drive's own words, checked). */
export interface DriveFile {
  id: string;
  name: string;
  size: number;
  modified: number;
  mime: string;
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
