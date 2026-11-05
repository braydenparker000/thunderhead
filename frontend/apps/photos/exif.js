// @ts-check
// What the camera's EXIF says (PHOTOS.md § Info), from a TIFF structure: the APP1 of the JPEG the
// camera embedded (a RAF's, or a JPEG itself) or a DNG's own IFDs. The lens, the exposure, program,
// metering, flash, white balance mode, focal lengths, orientation, size and software, and from
// Fujifilm's maker note its settings (fuji.js). Only the tags named here are read: the GPS IFD (its
// pointer 0x8825) is never followed, so no place is read, shown or sent (SECURITY.md). Each value is
// kept only within the contract's ranges (info-limits.js, from the contract), so a strange file never makes
// a registration fail. Pure: no network, no DOM.
import { INFO_LIMITS, INFO_NUMBERS } from './info-limits.js';
import { fujiNote, signed, value } from './fuji.js';
import { bytesRead, tiff } from './read.js';

/** @typedef {import('../../../shared/contract/photos-info.ts').PhotoInfo} PhotoInfo */
/** @typedef {import('./read.js').Read} Read */

/** Only the contract's keys, each in its range; the names printable and at most 80 characters.
 * @param {Record<string, unknown>} raw @returns {PhotoInfo} */
export function allowed(raw) {
  /** @type {Record<string, number | string>} */
  const out = {};
  for (const [k, range] of Object.entries(INFO_NUMBERS)) {
    const v = raw[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= range[0] && v <= range[1]) out[k] = Number(v.toPrecision(6));
  }
  for (const k of ['lens', 'software']) {
    const v = typeof raw[k] === 'string' ? raw[k].replace(/\p{Cc}/gu, '').trim().slice(0, INFO_LIMITS.text_chars).trim() : '';
    if (v) out[k] = v;
  }
  return out;
}

/** The info of the TIFF structure at `base`, or null when it is not one.
 * @param {Read} read @param {number} base @returns {Promise<PhotoInfo | null>} */
export async function tiffInfo(read, base) {
  const t = await tiff(read, base);
  if (!t) return null;
  /** @type {Record<string, unknown>} */
  const raw = {};
  const ifd0 = (await t.ifd(t.root)).tags;
  const at = await t.num(ifd0.get(0x8769));
  const exif = at ? (await t.ifd(at)).tags : new Map();
  const num = (/** @type {Map<number, any>} */ tags, /** @type {number} */ tag) => value(read, base, t.le, tags.get(tag));
  raw.orientation = await num(ifd0, 0x0112);
  raw.software = await t.str(ifd0.get(0x0131));
  for (const [k, tag] of /** @type {const} */ ([['exposure', 0x829a], ['fnumber', 0x829d], ['program', 0x8822], ['bias', 0x9204], ['metering', 0x9207], ['flash', 0x9209], ['focal', 0x920a], ['width', 0xa002], ['height', 0xa003], ['wb_mode', 0xa403], ['focal35', 0xa405]]))
    raw[k] = await num(exif, tag);
  // ISO: PhotographicSensitivity, or ISOSpeed where that one tops out at 65,535.
  const iso = await num(exif, 0x8827);
  raw.iso = iso === 65535 ? ((await num(exif, 0x8833)) ?? iso) : iso;
  raw.lens = await t.str(exif.get(0xa434));
  const note = exif.get(0x927c);
  if (note && note.count > 12) Object.assign(raw, await fujiNote(read, base + note.at));
  return allowed(raw);
}

/** A JPEG's info (its APP1 "Exif"), `{}` for a JPEG without one, null for bytes that are no JPEG.
 * @param {Uint8Array} jpeg the file's start (its first 160 KB hold the APP1) */
export async function jpegInfo(jpeg) {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  for (let o = 2; o + 10 < jpeg.length && jpeg[o] === 0xff && jpeg[o + 1] !== 0xda; o += 2 + ((jpeg[o + 2] << 8) | jpeg[o + 3])) {
    if (jpeg[o + 1] === 0xe1 && String.fromCharCode(...jpeg.subarray(o + 4, o + 10)) === 'Exif\0\0') return (await tiffInfo(bytesRead(jpeg), o + 10)) ?? {};
  }
  return {};
}

// --- in words -----------------------------------------------------------------------------------

const PROGRAM = { 0: 'Not set', 1: 'Manual', 2: 'Program', 3: 'Aperture priority', 4: 'Shutter priority', 5: 'Creative', 6: 'Action', 7: 'Portrait', 8: 'Landscape' };
const METERING = { 0: 'Unknown', 1: 'Average', 2: 'Centre-weighted', 3: 'Spot', 4: 'Multi-spot', 5: 'Multi', 6: 'Partial', 255: 'Other' };
const ORIENTATION = { 1: 'As shot', 2: 'Mirrored', 3: 'Turned 180°', 4: 'Mirrored, turned 180°', 5: 'Mirrored, turned 90° left', 6: 'Turned 90° right', 7: 'Mirrored, turned 90° right', 8: 'Turned 90° left' };
const FLASH_MODE = { 1: 'On', 2: 'Off', 3: 'Auto' };
/** @param {Record<number, string>} t @param {number | undefined} v */
const word = (t, v) => (v === undefined ? null : (t[v] ?? String(v)));
const trim = (/** @type {number} */ n, d = 1) => String(Number(n.toFixed(d)));

/** "1/250 s", "2 s". @param {number} t */
export const shutter = (t) => (t >= 0.3 || t <= 0 ? `${trim(t)} s` : `1/${Math.round(1 / t)} s`);
/** EV in thirds where it is one ("−2/3 EV", "+1 1/3 EV"), else to a tenth. @param {number} ev */
export function bias(ev) {
  const thirds = Math.round(ev * 3);
  if (Math.abs(ev * 3 - thirds) > 0.1) return `${signed(Number(ev.toFixed(1)))} EV`;
  const whole = Math.trunc(Math.abs(thirds) / 3), part = Math.abs(thirds) % 3;
  const n = `${whole || !part ? whole : ''}${whole && part ? ' ' : ''}${part ? `${part}/3` : ''}`;
  return `${thirds > 0 ? '+' : thirds < 0 ? '−' : ''}${n} EV`;
}
/** Fired or not, and the mode ("Off, did not fire"). @param {number} f */
export function flash(f) {
  if (f & 0x20) return 'No flash';
  const mode = FLASH_MODE[/** @type {keyof typeof FLASH_MODE} */ ((f >> 3) & 3)];
  return `${mode ? `${mode}, ` : ''}${f & 1 ? 'fired' : 'did not fire'}`.replace(/^./, (c) => c.toUpperCase());
}

/** The Camera section's rows. @param {PhotoInfo} i @param {{ camera: string | null }} p @returns {[string, string][]} */
export function cameraRows(i, p) {
  const triangle = [i.exposure !== undefined ? shutter(i.exposure) : null, i.fnumber ? `f/${trim(i.fnumber)}` : null, i.iso ? `ISO ${i.iso}` : null].filter(Boolean).join(' · ');
  const focal = i.focal ? `${trim(i.focal)} mm${i.focal35 && Math.round(i.focal35) !== Math.round(i.focal) ? ` (${Math.round(i.focal35)} mm full frame)` : ''}` : i.focal35 ? `${Math.round(i.focal35)} mm full frame` : null;
  /** @type {[string, string | null][]} */
  const rows = [
    ['Body', p.camera],
    ['Lens', i.lens ?? null],
    ['Focal length', focal],
    ['Exposure', triangle || null],
    ['Bias', i.bias !== undefined ? bias(i.bias) : null],
    ['Program', word(PROGRAM, i.program)],
    ['Metering', word(METERING, i.metering)],
    ['Flash', i.flash !== undefined ? flash(i.flash) : null],
    // Fujifilm's own white balance is in Film; another camera's says Auto or Manual here.
    ['White balance', i.wb === undefined ? word({ 0: 'Auto', 1: 'Manual' }, i.wb_mode) : null],
    ['Camera’s stars', i.rating ? '★'.repeat(i.rating) : null],
  ];
  return /** @type {[string, string][]} */ (rows.filter((r) => r[1]));
}

const FORMAT = { raf: 'RAF (RAW)', dng: 'DNG (RAW)', jpeg: 'JPEG', heic: 'HEIC', other: 'Other' };
/** "31.5 MB". @param {number} b */
export const fileSize = (b) => (b >= 1e9 ? `${trim(b / 1e9, 2)} GB` : b >= 1e6 ? `${trim(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

/** The Image section's rows: the time in this phone's zone, the owner's (zone.js keeps them one).
 * @param {PhotoInfo} i @param {{ width: number | null, height: number | null, format: string, bytes: number, taken_at: number }} p
 * @returns {[string, string][]} */
export function imageRows(i, p) {
  const w = i.width || p.width, h = i.height || p.height;
  const taken = new Date(p.taken_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
  /** @type {[string, string | null][]} */
  const rows = [
    ['Size', w && h ? `${w} × ${h} · ${trim((w * h) / 1e6)} MP` : null],
    ['Orientation', word(ORIENTATION, i.orientation)],
    ['Format', FORMAT[/** @type {keyof typeof FORMAT} */ (p.format)] ?? p.format],
    ['File size', p.bytes ? fileSize(p.bytes) : null],
    ['Taken', taken],
    ['Software', i.software ?? null],
  ];
  return /** @type {[string, string][]} */ (rows.filter((r) => r[1]));
}
