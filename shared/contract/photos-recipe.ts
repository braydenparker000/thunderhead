// A photo's recipe (PHOTOS.md, the editor; API.md §11.26): the edit as a small JSON object the phone
// renders on its own GPU and the Worker stores on the photo. Keys are Lightroom's crs field names
// where one maps (so an XMP sidecar can carry them later); a key left out is its default, so the
// "as shot" recipe is `{}`. Ranges as the plan sets them. Plain data with erasable types only.

/** Numeric controls: [min, max, default]. Temperature and Tint are apart (their default is the file's). */
export const RECIPE_NUMBERS = {
  // Light
  Exposure2012: [-5, 5, 0],
  Contrast2012: [-100, 100, 0],
  Highlights2012: [-100, 100, 0],
  Shadows2012: [-100, 100, 0],
  Whites2012: [-100, 100, 0],
  Blacks2012: [-100, 100, 0],
  // Color
  Vibrance: [-100, 100, 0],
  Saturation: [-100, 100, 0],
  HueAdjustmentRed: [-100, 100, 0],
  HueAdjustmentOrange: [-100, 100, 0],
  HueAdjustmentYellow: [-100, 100, 0],
  HueAdjustmentGreen: [-100, 100, 0],
  HueAdjustmentAqua: [-100, 100, 0],
  HueAdjustmentBlue: [-100, 100, 0],
  HueAdjustmentPurple: [-100, 100, 0],
  HueAdjustmentMagenta: [-100, 100, 0],
  SaturationAdjustmentRed: [-100, 100, 0],
  SaturationAdjustmentOrange: [-100, 100, 0],
  SaturationAdjustmentYellow: [-100, 100, 0],
  SaturationAdjustmentGreen: [-100, 100, 0],
  SaturationAdjustmentAqua: [-100, 100, 0],
  SaturationAdjustmentBlue: [-100, 100, 0],
  SaturationAdjustmentPurple: [-100, 100, 0],
  SaturationAdjustmentMagenta: [-100, 100, 0],
  LuminanceAdjustmentRed: [-100, 100, 0],
  LuminanceAdjustmentOrange: [-100, 100, 0],
  LuminanceAdjustmentYellow: [-100, 100, 0],
  LuminanceAdjustmentGreen: [-100, 100, 0],
  LuminanceAdjustmentAqua: [-100, 100, 0],
  LuminanceAdjustmentBlue: [-100, 100, 0],
  LuminanceAdjustmentPurple: [-100, 100, 0],
  LuminanceAdjustmentMagenta: [-100, 100, 0],
  // Grading: three wheels (hue 0–359°, saturation 0–100, luminance ±100), blending and balance
  SplitToningShadowHue: [0, 359, 0],
  SplitToningShadowSaturation: [0, 100, 0],
  ColorGradeShadowLum: [-100, 100, 0],
  ColorGradeMidtoneHue: [0, 359, 0],
  ColorGradeMidtoneSat: [0, 100, 0],
  ColorGradeMidtoneLum: [-100, 100, 0],
  SplitToningHighlightHue: [0, 359, 0],
  SplitToningHighlightSaturation: [0, 100, 0],
  ColorGradeHighlightLum: [-100, 100, 0],
  ColorGradeBlending: [0, 100, 50],
  SplitToningBalance: [-100, 100, 0],
  // Effects
  Texture: [-100, 100, 0],
  Clarity2012: [-100, 100, 0],
  Dehaze: [-100, 100, 0],
  PostCropVignetteAmount: [-100, 100, 0],
  PostCropVignetteMidpoint: [0, 100, 50],
  PostCropVignetteFeather: [0, 100, 50],
  PostCropVignetteRoundness: [-100, 100, 0],
  GrainAmount: [0, 100, 0],
  GrainSize: [0, 100, 25],
  GrainFrequency: [0, 100, 50],
  // Detail
  Sharpness: [0, 150, 40],
  SharpenRadius: [0.5, 3, 1],
  SharpenDetail: [0, 100, 25],
  SharpenEdgeMasking: [0, 100, 0],
  LuminanceSmoothing: [0, 100, 0],
  LuminanceNoiseReductionDetail: [0, 100, 50],
  ColorNoiseReduction: [0, 100, 25],
  ColorNoiseReductionDetail: [0, 100, 50],
  // Optics: manual distortion (+ corrects barrel) and the lens's own vignetting (+ lightens the corners)
  LensManualDistortionAmount: [-100, 100, 0],
  VignetteAmount: [-100, 100, 0],
  // Crop and geometry: the crop's edges as fractions of the straightened frame, its angle in degrees,
  // and the two perspective corrections (applied before the crop, the crop last before output)
  CropTop: [0, 1, 0],
  CropLeft: [0, 1, 0],
  CropBottom: [0, 1, 1],
  CropRight: [0, 1, 1],
  CropAngle: [-45, 45, 0],
  PerspectiveVertical: [-100, 100, 0],
  PerspectiveHorizontal: [-100, 100, 0],
} as const satisfies Record<string, readonly [number, number, number]>;
export type RecipeNumber = keyof typeof RECIPE_NUMBERS;

/** White balance: the file's own, a grey-world start, or Temperature and Tint set by hand or the picker. */
export const WB_MODES = ['As Shot', 'Auto', 'Custom'] as const;
export const RECIPE_WB = { Temperature: [2000, 50000], Tint: [-150, 150] } as const;
/** Point curves: 2–16 points of [input, output], 0–255, inputs strictly increasing. */
export const RECIPE_CURVES = ['ToneCurvePV2012', 'ToneCurvePV2012Red', 'ToneCurvePV2012Green', 'ToneCurvePV2012Blue'] as const;
export type RecipeCurve = (typeof RECIPE_CURVES)[number];
export const CURVE_POINTS = { min: 2, max: 16 } as const;

/** On or off: black and white, remove chromatic aberration, the lens's own corrections, keep the crop
 * inside the warped photo, and the two flips (ours: Lightroom keeps a flip in the file's orientation). */
export const RECIPE_FLAGS = ['ConvertToGrayscale', 'AutoLateralCA', 'LensProfileEnable', 'CropConstrainToWarp', 'FlipHorizontal', 'FlipVertical'] as const;
export type RecipeFlag = (typeof RECIPE_FLAGS)[number];

export type PhotoRecipe = { [K in RecipeNumber]?: number } & { [K in RecipeCurve]?: [number, number][] } & { [K in RecipeFlag]?: boolean } & {
  WhiteBalance?: (typeof WB_MODES)[number];
  Temperature?: number;
  Tint?: number;
};

/** PUT /v1/photos/:id/recipe. The same recipe again (by its hash) writes nothing. */
export interface PutRecipeRequest {
  recipe: PhotoRecipe;
}

/** The panels a `photo.edit` sense names (no values ever leave the phone in a sense). */
export const EDIT_PANELS = ['light', 'color', 'effects', 'detail', 'optics', 'crop', 'versions', 'looks'] as const;

/** The recipe without its defaults, keys sorted: what is stored and hashed, so equal edits are equal. */
export function canonicalRecipe(r: PhotoRecipe): PhotoRecipe {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(r).sort()) {
    const v = (r as Record<string, unknown>)[k];
    const n = RECIPE_NUMBERS[k as RecipeNumber];
    if (v === undefined || (n && v === n[2])) continue;
    if (k === 'WhiteBalance' && v === 'As Shot') continue;
    if (RECIPE_FLAGS.includes(k as RecipeFlag) && v === false) continue;
    if ((k === 'Temperature' || k === 'Tint') && r.WhiteBalance !== 'Custom') continue;
    if (RECIPE_CURVES.includes(k as RecipeCurve) && isLinear(v as [number, number][])) continue;
    out[k] = v;
  }
  return out as PhotoRecipe;
}

/** A curve that changes nothing: the two corners only. */
const isLinear = (c: [number, number][]) =>
  c.length === 2 && c[0]?.[0] === 0 && c[0]?.[1] === 0 && c[1]?.[0] === 255 && c[1]?.[1] === 255;
