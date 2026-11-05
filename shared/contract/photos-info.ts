// A photo's info (PHOTOS.md § Info, API.md §11.26): what its file says about itself, read on the
// phone from the camera's EXIF and Fujifilm's maker note (frontend/apps/photos/exif.js, fuji.js) and
// kept by the Worker as one small JSON. An allowlist: numbers (the camera's codes as it wrote them,
// put into words on the phone) and two names, the lens and the software. No place: GPS is never read,
// sent or kept (SECURITY.md). The Worker drops a key it does not know. Plain data, erasable types only.

export const INFO_LIMITS = {
  /** The info as sent, in bytes of JSON. */
  json_bytes: 2048,
  /** The lens's and the software's names, in characters. */
  text_chars: 80,
} as const;

/** The two names the info may carry. */
export const INFO_TEXTS = ['lens', 'software'] as const;

const CODE = [0, 65_535] as const;
const SIGNED = [-100_000, 100_000] as const;

/** Every number the info may carry, with its range: EXIF's (units in the comments), then the maker
 * note's (Fujifilm's codes, the tag in the comment). */
export const INFO_NUMBERS = {
  /** mm (0x920A), and its 35 mm equivalent (0xA405). */
  focal: [0, 10_000],
  focal35: [0, 10_000],
  /** Seconds (0x829A), the f-number (0x829D), ISO (0x8827, or 0x8833 above 65,535), EV (0x9204). */
  exposure: [0, 100_000],
  fnumber: [0, 1000],
  iso: [0, 10_000_000],
  bias: [-100, 100],
  /** EXIF's codes: exposure program (0x8822), metering (0x9207), flash (0x9209), white balance mode
   * (0xA403), orientation (0x0112). */
  program: CODE,
  metering: CODE,
  flash: CODE,
  wb_mode: CODE,
  orientation: CODE,
  /** Pixels (0xA002, 0xA003), and the camera's own stars (EXIF Rating, or the maker note's). */
  width: [0, 1_000_000],
  height: [0, 1_000_000],
  rating: [0, 5],
  /** Fujifilm: film simulation (0x1401), colour (0x1003, also its black-and-white modes). */
  film_mode: CODE,
  saturation: CODE,
  /** Dynamic range setting (0x1402) and development dynamic range (0x1403, 100/200/400); DR priority
   * (0x1443) and its strength, auto (0x1444) or fixed (0x1445). */
  dr_setting: CODE,
  dr_dev: CODE,
  dr_priority: CODE,
  dr_priority_auto: CODE,
  dr_priority_fixed: CODE,
  /** Highlight (0x1041) and shadow tone (0x1040): -16 a step harder. */
  highlight: SIGNED,
  shadow: SIGNED,
  /** Sharpness (0x1001), noise reduction (0x100E), clarity (0x100F, 1000 a step). */
  sharpness: CODE,
  nr: CODE,
  clarity: SIGNED,
  /** Grain roughness (0x1047) and size (0x104C); colour chrome (0x1048) and its FX blue (0x104E). */
  grain: SIGNED,
  grain_size: CODE,
  chrome: SIGNED,
  chrome_blue: SIGNED,
  /** White balance (0x1002), its kelvin (0x1005), its fine tune red and blue (0x100A). */
  wb: CODE,
  wb_kelvin: CODE,
  wb_fine_r: SIGNED,
  wb_fine_b: SIGNED,
  /** Monochrome's warm-cool (0x1049) and magenta-green (0x104B). */
  mono_warm: [-128, 127],
  mono_green: [-128, 127],
  /** Image stabilisation (0x1422): its kind and its mode. */
  stab: CODE,
  stab_mode: CODE,
} as const;

export type InfoNumber = keyof typeof INFO_NUMBERS;
export type InfoText = (typeof INFO_TEXTS)[number];
export type PhotoInfo = { [K in InfoNumber]?: number } & { [K in InfoText]?: string };

/** PUT /v1/photos/:id/info: a photo registered before its info was read (the editor reads it the
 * first time the photo is opened), with its camera and film for a photo that has none yet. */
export interface PutPhotoInfoRequest {
  info: PhotoInfo;
  camera?: string | null;
  film?: string | null;
}
