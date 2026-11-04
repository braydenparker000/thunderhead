// A photo's versions (PHOTOS.md, Versions; API.md §11.26): a recipe kept under the photo, either
// automatic (one when an editing session ends: leaving the editor or ten minutes idle) or named by
// the owner. Restoring one is an ordinary recipe put, so it has the recipe's undo. Plain data with
// erasable types only.
import type { PhotoRecipe } from './photos-recipe.ts';

export const VERSION_KINDS = ['auto', 'named'] as const;
export type VersionKind = (typeof VERSION_KINDS)[number];

export const VERSION_LIMITS = {
  /** Automatic versions a photo keeps: the oldest goes when a new one comes. */
  auto: 20,
  /** Named versions a photo keeps: one more is refused until one is deleted. */
  named: 20,
  /** A version's name, in characters. */
  name_chars: 60,
} as const;

export interface PhotoVersion {
  id: string;
  kind: VersionKind;
  name: string | null;
  recipe: PhotoRecipe;
  created_at: number;
}

/** GET /v1/photos/:id/versions: newest first, automatic and named together. */
export interface PhotoVersionsResponse {
  items: PhotoVersion[];
}

/** POST /v1/photos/:id/versions. An automatic version equal to the newest automatic one writes nothing. */
export interface PostVersionRequest {
  id: string;
  kind: VersionKind;
  name?: string;
  recipe: PhotoRecipe;
}

/** PATCH /v1/photos/:id/versions/:vid: a new name (an automatic version named becomes a named one). */
export interface PatchVersionRequest {
  name: string;
}
