// @ts-check
// Fujifilm's maker note (PHOTOS.md § Info): the camera's settings as it wrote them, read by tag (the
// public ids ExifTool's FujiFilm tag table documents) and put into the camera's own words ("Classic
// Chrome", "DR400", "+1", "Strong"). A value this does not know shows as its number. The note is
// little-endian, its offsets from its own start. Pure: no network, no DOM.
import { ascii, ifd } from './read.js';

/** @typedef {import('../../../shared/contract/photos-info.ts').PhotoInfo} PhotoInfo */
/** @typedef {import('./read.js').Read} Read */
/** @typedef {{ type: number, count: number, at: number }} Entry */

const SIZE = { 1: 1, 6: 1, 7: 1, 3: 2, 8: 2, 4: 4, 9: 4, 5: 8, 10: 8 };

/** One value of an IFD entry (the `i`th of its count): a byte, short or long, signed or not, or a
 * rational. Null where the bytes are not there. @param {Read} read @param {number} base @param {boolean} le
 * @param {Entry | undefined} e */
export async function value(read, base, le, e, i = 0) {
  const size = e ? SIZE[/** @type {keyof typeof SIZE} */ (e.type)] : 0;
  if (!e || !size || i >= e.count) return null;
  const v = await read(base + e.at + i * size, size);
  if (v.byteLength < size) return null;
  if (e.type === 5 || e.type === 10) {
    const d = e.type === 5 ? v.getUint32(4, le) : v.getInt32(4, le);
    return d ? (e.type === 5 ? v.getUint32(0, le) : v.getInt32(0, le)) / d : null;
  }
  if (size === 1) return e.type === 6 ? v.getInt8(0) : v.getUint8(0);
  if (size === 2) return e.type === 8 ? v.getInt16(0, le) : v.getUint16(0, le);
  return e.type === 9 ? v.getInt32(0, le) : v.getUint32(0, le);
}

/** The maker note's tags this reads, by the info's key. Smooth skin has no public id: not read. */
const TAGS = /** @type {const} */ ({
  sharpness: 0x1001, wb: 0x1002, saturation: 0x1003, wb_kelvin: 0x1005, nr: 0x100e, clarity: 0x100f,
  shadow: 0x1040, highlight: 0x1041, grain: 0x1047, chrome: 0x1048, mono_warm: 0x1049, mono_green: 0x104b,
  grain_size: 0x104c, chrome_blue: 0x104e, film_mode: 0x1401, dr_setting: 0x1402, dr_dev: 0x1403,
  dr_priority: 0x1443, dr_priority_auto: 0x1444, dr_priority_fixed: 0x1445,
});

/** The note at `at` (the EXIF MakerNote's value), as codes; `{}` for a note that is not Fujifilm's.
 * @param {Read} read @param {number} at @returns {Promise<PhotoInfo>} */
export async function fujiNote(read, at) {
  const head = await read(at, 12);
  if (head.byteLength < 12 || ascii(head, 0, 8) !== 'FUJIFILM') return {};
  const { tags } = await ifd(read, at, head.getUint32(8, true), true);
  /** @type {Record<string, number>} */
  const out = {};
  const get = (/** @type {number} */ tag, i = 0) => value(read, at, true, tags.get(tag), i);
  for (const [k, tag] of Object.entries(TAGS)) {
    const v = await get(tag);
    if (v !== null) out[k] = v;
  }
  // Two of a tag's values: the white balance's fine tune (red, blue), stabilisation (kind, mode).
  for (const [k, tag, i] of /** @type {const} */ ([['wb_fine_r', 0x100a, 0], ['wb_fine_b', 0x100a, 1], ['stab', 0x1422, 0], ['stab_mode', 0x1422, 1]])) {
    const v = await get(tag, i);
    if (v !== null) out[k] = v;
  }
  return out;
}

// --- the camera's words ----------------------------------------------------------------------------

const MINUS = '−';
/** "+1", "0", "−1.5". @param {number} n */
export const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `${MINUS}${-n}` : '0');
/** @param {Record<number, string>} t @param {number | undefined} v */
const word = (t, v) => (v === undefined ? null : (t[v] ?? String(v)));

const FILM = { 0x0: 'Provia/Standard', 0x100: 'Studio Portrait', 0x110: 'Studio Portrait Enhanced Saturation', 0x120: 'Astia/Soft', 0x130: 'Studio Portrait Increased Sharpness', 0x200: 'Velvia/Vivid', 0x300: 'Studio Portrait Ex', 0x400: 'Velvia/Vivid', 0x500: 'Pro Neg. Std', 0x501: 'Pro Neg. Hi', 0x600: 'Classic Chrome', 0x700: 'Eterna/Cinema', 0x800: 'Classic Neg.', 0x900: 'Eterna Bleach Bypass', 0xa00: 'Nostalgic Neg.', 0xb00: 'Reala Ace' };
const MONO = { 0x300: 'Monochrome', 0x301: 'Monochrome + R Filter', 0x302: 'Monochrome + Ye Filter', 0x303: 'Monochrome + G Filter', 0x310: 'Sepia', 0x500: 'Acros', 0x501: 'Acros + R Filter', 0x502: 'Acros + Ye Filter', 0x503: 'Acros + G Filter' };
const COLOUR = { 0x0: '0', 0x80: '+1', 0x100: '+2', 0xc0: '+3', 0xe0: '+4', 0x180: `${MINUS}1`, 0x400: `${MINUS}2`, 0x4c0: `${MINUS}3`, 0x4e0: `${MINUS}4`, 0x200: 'Low', 0x8000: 'Film simulation' };
const SHARP = { 0x0: `${MINUS}4`, 0x1: `${MINUS}3`, 0x2: `${MINUS}2`, 0x82: `${MINUS}1`, 0x3: '0', 0x84: '+1', 0x4: '+2', 0x5: '+3', 0x6: '+4', 0x8000: 'Film simulation' };
const NR = { 0x0: '0', 0x180: '+1', 0x100: '+2', 0x1c0: '+3', 0x1e0: '+4', 0x280: `${MINUS}1`, 0x200: `${MINUS}2`, 0x2c0: `${MINUS}3`, 0x2e0: `${MINUS}4` };
const DR = { 0x0: 'Auto', 0x1: 'Manual', 0x100: 'DR100', 0x200: 'Wide 1', 0x201: 'Wide 2', 0x8000: 'Film simulation' };
const STRENGTH = { 0: 'Off', 32: 'Weak', 64: 'Strong' };
const ROUGH = { 0: 'Off', 16: 'Weak', 32: 'Weak', 48: 'Strong', 64: 'Strong' };
const GRAIN_SIZE = { 16: 'small', 32: 'large' };
const WB = { 0x0: 'Auto', 0x1: 'Auto, white priority', 0x2: 'Auto, ambience priority', 0x100: 'Daylight', 0x200: 'Shade', 0x300: 'Fluorescent 1', 0x301: 'Fluorescent 2', 0x302: 'Fluorescent 3', 0x303: 'Fluorescent 4', 0x304: 'Fluorescent 5', 0x400: 'Incandescent', 0x500: 'Flash', 0x600: 'Underwater', 0xf00: 'Custom 1', 0xf01: 'Custom 2', 0xf02: 'Custom 3', 0xf03: 'Custom 4', 0xf04: 'Custom 5', 0xff0: 'Colour temperature' };
const STAB = { 0: 'None', 1: 'Optical', 2: 'Sensor-shift', 3: 'Lens', 258: 'Sensor and lens, digital', 512: 'Digital' };
const STAB_MODE = { 0: 'Off', 1: 'continuous', 2: 'shooting only' };
const PRIORITY = { 1: 'Weak', 2: 'Strong', 3: 'Plus' };

/** The film simulation: a black-and-white one is named by its colour setting. @param {PhotoInfo} i */
export function filmOf(i) {
  if (i.saturation !== undefined && i.saturation in MONO) return MONO[/** @type {keyof typeof MONO} */ (i.saturation)];
  return word(FILM, i.film_mode);
}

/** A tone (highlights, shadows): -16 a step harder, half steps too. @param {number | undefined} v */
const tone = (v) => (v === undefined ? null : v % 8 === 0 ? signed(-v / 16) : String(v));

/** The Film section's rows, label and value, only those the note has. @param {PhotoInfo} i
 * @returns {[string, string][]} */
export function filmRows(i) {
  const mono = i.saturation !== undefined && i.saturation in MONO;
  const dr = i.dr_dev ? `DR${i.dr_dev}${i.dr_setting === 0 ? ' (Auto)' : ''}` : word(DR, i.dr_setting);
  const priority = i.dr_priority === undefined ? null
    : i.dr_priority === 0 ? `Auto${i.dr_priority_auto ? `, ${word(PRIORITY, i.dr_priority_auto)}` : ''}`
      : i.dr_priority === 1 ? (word(PRIORITY, i.dr_priority_fixed) ?? 'Fixed') : String(i.dr_priority);
  const grain = i.grain === undefined ? null : i.grain === 0 ? 'Off'
    : `${word(ROUGH, i.grain)}${i.grain_size && i.grain_size in GRAIN_SIZE ? `, ${GRAIN_SIZE[/** @type {keyof typeof GRAIN_SIZE} */ (i.grain_size)]}` : ''}`;
  const wb = i.wb === undefined ? null : `${word(WB, i.wb)}${i.wb === 0xff0 && i.wb_kelvin ? ` ${i.wb_kelvin} K` : ''}`;
  // Newer cameras write the fine tune 20 a step.
  const step = (/** @type {number} */ n) => (i.wb_fine_r !== undefined && i.wb_fine_r % 20 === 0 && (i.wb_fine_b ?? 0) % 20 === 0 ? n / 20 : n);
  const shift = i.wb_fine_r === undefined ? null : `R ${signed(step(i.wb_fine_r))}, B ${signed(step(i.wb_fine_b ?? 0))}`;
  const stab = i.stab === undefined ? null : i.stab_mode === 0 ? 'Off' : `${word(STAB, i.stab)}${i.stab_mode !== undefined ? `, ${word(STAB_MODE, i.stab_mode)}` : ''}`;
  /** @type {[string, string | null][]} */
  const rows = [
    ['Film simulation', filmOf(i)],
    ['Dynamic range', dr],
    ['DR priority', priority],
    ['Highlights', tone(i.highlight)],
    ['Shadows', tone(i.shadow)],
    ['Colour', mono ? null : word(COLOUR, i.saturation)],
    ['Warm–cool', mono && i.mono_warm !== undefined ? signed(i.mono_warm) : null],
    ['Magenta–green', mono && i.mono_green !== undefined ? signed(i.mono_green) : null],
    ['Sharpness', i.sharpness === 0xffff ? null : word(SHARP, i.sharpness)],
    ['Noise reduction', word(NR, i.nr)],
    ['Clarity', i.clarity === undefined ? null : i.clarity % 1000 === 0 ? signed(i.clarity / 1000) : String(i.clarity)],
    ['Grain', grain],
    ['Colour chrome', word(STRENGTH, i.chrome)],
    ['Colour chrome blue', word(STRENGTH, i.chrome_blue)],
    ['White balance', wb],
    ['WB shift', shift],
    ['Stabilisation', stab],
  ];
  return /** @type {[string, string][]} */ (rows.filter((r) => r[1] !== null));
}
