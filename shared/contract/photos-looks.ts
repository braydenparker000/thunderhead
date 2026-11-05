// Looks (PHOTOS.md, Looks; API.md §11.26): pre-made edits the owner applies from the editor's Looks
// panel. Each is a recipe over chosen panels (the Copy sheet's), applied as a paste is: the photo keeps
// its keys outside those panels and takes the look's inside them. A look's white balance is relative:
// its Temperature reads against 5,500 K and its Tint against 0, so applying it shifts the photo's own
// white balance by that much (in mired). Saved from an edit (mine), imported from .xmp presets (xmp),
// pasted from a camera recipe's text (recipe), or later learned from the camera (camera). The Worker
// keeps only the numbers, a name, a tag and a credit line. Plain data with erasable types only.
import type { PastePanel } from './photos-paste.ts';
import type { PhotoRecipe } from './photos-recipe.ts';

export const LOOK_SOURCES = ['mine', 'xmp', 'recipe', 'camera'] as const;
export type LookSource = (typeof LOOK_SOURCES)[number];

export const LOOK_LIMITS = {
  /** Looks kept in all: one more is refused until one is deleted. */
  max: 500,
  /** Looks one PUT takes (an import of many presets goes in several). */
  per_request: 50,
  /** A look's name, its tag (a preset's group), its film simulation and its credit line, in characters. */
  name_chars: 60,
  tag_chars: 40,
  film_chars: 40,
  credit_chars: 120,
  /** A look's canonical recipe, in bytes. */
  recipe_bytes: 4 * 1024,
} as const;

/** The white balance a look's Temperature is read against (its Tint against 0). */
export const LOOK_WB_REFERENCE = 5500;

export interface PhotoLook {
  id: string;
  name: string;
  source: LookSource;
  /** Canonical, only keys of `panels`. */
  recipe: PhotoRecipe;
  panels: PastePanel[];
  /** A preset's group, shown as a chip. */
  tag: string | null;
  /** A recipe's film simulation, kept as a name: not rendered until the camera's looks are learned. */
  film: string | null;
  /** Where it came from, as the owner wrote it ("from a page title"). */
  credit: string | null;
  created_at: number;
  updated_at: number;
}

/** GET /v1/photos/looks: every look, newest first. */
export interface PhotoLooksResponse {
  items: PhotoLook[];
}

export interface PutLook {
  id: string;
  name: string;
  source: LookSource;
  recipe: PhotoRecipe;
  panels: PastePanel[];
  tag?: string | null;
  film?: string | null;
  credit?: string | null;
}

/** PUT /v1/photos/looks: up to 50 looks, each added or replaced by its id, in one commit. */
export interface PutLooksRequest {
  items: PutLook[];
}

/** PATCH /v1/photos/looks/:lid: a new name, or the recipe and panels from the current edit. */
export interface PatchLookRequest {
  name?: string;
  recipe?: PhotoRecipe;
  panels?: PastePanel[];
}
