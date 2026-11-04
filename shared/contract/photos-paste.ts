// Copy and paste (PHOTOS.md, Copy and paste; API.md §11.26): the editor copies a photo's recipe, all
// of it or chosen panels, and the shelf pastes it onto up to 20 photos in one call. Each panel owns
// its keys, so a key the copy leaves out is that panel's default on the photo it lands on (pasting
// Light from a photo with no exposure change sets exposure back to as shot). Plain data with erasable
// types only.
import { canonicalRecipe, type PhotoRecipe, RECIPE_CURVES } from './photos-recipe.ts';

export const PASTE_PANELS = ['light', 'color', 'effects', 'detail', 'optics', 'crop'] as const;
export type PastePanel = (typeof PASTE_PANELS)[number];

export const PASTE_LIMITS = {
  /** Photos one paste (and one export from the shelf) takes. */
  photos: 20,
} as const;

const HUES = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'];
/** Every recipe key, under the one panel that shows it. */
export const PANEL_KEYS: Record<PastePanel, readonly string[]> = {
  light: ['Exposure2012', 'Contrast2012', 'Highlights2012', 'Shadows2012', 'Whites2012', 'Blacks2012', ...RECIPE_CURVES],
  color: [
    'WhiteBalance',
    'Temperature',
    'Tint',
    'Vibrance',
    'Saturation',
    ...['Hue', 'Saturation', 'Luminance'].flatMap((p) => HUES.map((h) => `${p}Adjustment${h}`)),
    'SplitToningShadowHue',
    'SplitToningShadowSaturation',
    'ColorGradeShadowLum',
    'ColorGradeMidtoneHue',
    'ColorGradeMidtoneSat',
    'ColorGradeMidtoneLum',
    'SplitToningHighlightHue',
    'SplitToningHighlightSaturation',
    'ColorGradeHighlightLum',
    'ColorGradeBlending',
    'SplitToningBalance',
    'ConvertToGrayscale',
  ],
  effects: [
    'Texture',
    'Clarity2012',
    'Dehaze',
    'PostCropVignetteAmount',
    'PostCropVignetteMidpoint',
    'PostCropVignetteFeather',
    'PostCropVignetteRoundness',
    'GrainAmount',
    'GrainSize',
    'GrainFrequency',
  ],
  detail: [
    'Sharpness',
    'SharpenRadius',
    'SharpenDetail',
    'SharpenEdgeMasking',
    'LuminanceSmoothing',
    'LuminanceNoiseReductionDetail',
    'ColorNoiseReduction',
    'ColorNoiseReductionDetail',
  ],
  optics: ['AutoLateralCA', 'LensProfileEnable', 'LensManualDistortionAmount', 'VignetteAmount'],
  crop: [
    'CropTop',
    'CropLeft',
    'CropBottom',
    'CropRight',
    'CropAngle',
    'PerspectiveVertical',
    'PerspectiveHorizontal',
    'CropConstrainToWarp',
    'FlipHorizontal',
    'FlipVertical',
  ],
};

/** The panel a key belongs to (undefined: not a recipe key). */
export const panelOf = (key: string): PastePanel | undefined => PASTE_PANELS.find((p) => PANEL_KEYS[p].includes(key));

/** `target` with the chosen panels' keys replaced by `copied`'s, canonical. */
export function pasteOnto(target: PhotoRecipe, panels: readonly PastePanel[], copied: PhotoRecipe): PhotoRecipe {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(target)) if (!panels.includes(panelOf(k) as PastePanel)) out[k] = v;
  for (const [k, v] of Object.entries(copied)) if (panels.includes(panelOf(k) as PastePanel)) out[k] = v;
  return canonicalRecipe(out as PhotoRecipe);
}

/** POST /v1/photos/paste: the photos, the panels copied, and the copy's keys in those panels. */
export interface PastePhotosRequest {
  ids: string[];
  panels: PastePanel[];
  recipe: PhotoRecipe;
}

/** Each photo's recipe after and before (equal when it already had the look), and the one ledger row
 * whose undo puts every changed photo back (null when nothing changed and no paste like it is live). */
export interface PastePhotosResponse {
  items: { id: string; changed: boolean; recipe: PhotoRecipe; before: PhotoRecipe }[];
  ledger_id: string | null;
}
