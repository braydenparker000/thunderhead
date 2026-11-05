// @ts-check
// What a photo file says about itself, read on the phone with no RAW engine (PHOTOS.md §3.1): the
// JPEG the camera embedded (RAF: the header's offset and length; DNG: its largest preview IFD; a
// JPEG or HEIC: the file itself) and, from that JPEG's EXIF or the DNG's own IFDs, the capture time,
// the camera and Fujifilm's film simulation. Only the bytes it needs are read (Blob slices), so an
// 80 MB RAF costs its header and its preview. Pure: no network, no DOM.

/** @typedef {{ format: 'raf'|'dng'|'jpeg'|'heic'|'other', preview: Blob | null, camera: string | null, film: string | null, taken_at: number, width: number | null, height: number | null }} PhotoMeta */
/** @typedef {(offset: number, length: number) => Promise<DataView>} Read */

export const ascii = (/** @type {DataView} */ v, /** @type {number} */ o, /** @type {number} */ n) => {
  let s = '';
  for (let i = 0; i < n && o + i < v.byteLength; i++) {
    const c = v.getUint8(o + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
};
/** @param {Blob} blob @returns {Read} */
export const blobRead = (blob) => async (o, n) => new DataView(await blob.slice(o, o + n).arrayBuffer());
/** @param {Uint8Array} u8 @returns {Read} */
export const bytesRead = (u8) => async (o, n) => new DataView(u8.buffer, u8.byteOffset + o, Math.max(0, Math.min(n, u8.byteLength - o)));

/** Fujifilm's FilmMode (MakerNote 0x1401) and its black-and-white Saturation (0x1003), in its words. */
const FILM = { 0x0: 'Provia', 0x100: 'Studio Portrait', 0x200: 'Velvia', 0x300: 'Studio Portrait Ex', 0x400: 'Velvia', 0x500: 'Pro Neg. Std', 0x501: 'Pro Neg. Hi', 0x600: 'Classic Chrome', 0x700: 'Eterna', 0x800: 'Classic Negative', 0x900: 'Eterna Bleach Bypass', 0xa00: 'Nostalgic Neg.', 0xb00: 'Reala Ace' };
const MONO = { 0x300: 'Monochrome', 0x301: 'Monochrome + R', 0x302: 'Monochrome + Ye', 0x303: 'Monochrome + G', 0x310: 'Sepia', 0x500: 'Acros', 0x501: 'Acros + R', 0x502: 'Acros + Ye', 0x503: 'Acros + G' };
const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8 };

/** One IFD's entries by tag: `{ type, count, at }`, `at` the value's offset from `base`.
 * @param {Read} read @param {number} base @param {number} off @param {boolean} le */
export async function ifd(read, base, off, le) {
  /** @type {Map<number, { type: number, count: number, at: number }>} */
  const tags = new Map();
  const head = await read(base + off, 2);
  if (head.byteLength < 2) return { tags, next: 0 };
  const n = Math.min(head.getUint16(0, le), 512);
  const v = await read(base + off + 2, n * 12 + 4);
  for (let i = 0; i < n && (i + 1) * 12 <= v.byteLength; i++) {
    const tag = v.getUint16(i * 12, le), type = v.getUint16(i * 12 + 2, le), count = v.getUint32(i * 12 + 4, le);
    const size = (SIZES[/** @type {keyof typeof SIZES} */ (type)] ?? 1) * count;
    tags.set(tag, { type, count, at: size <= 4 ? off + 2 + i * 12 + 8 : v.getUint32(i * 12 + 8, le) });
  }
  return { tags, next: v.byteLength >= n * 12 + 4 ? v.getUint32(n * 12, le) : 0 };
}

/** A small reader of one TIFF structure (an EXIF block or a DNG). @param {Read} read @param {number} base */
export async function tiff(read, base) {
  const h = await read(base, 8);
  const le = h.getUint16(0) === 0x4949;
  if (h.getUint16(0) !== (le ? 0x4949 : 0x4d4d) || h.getUint16(2, le) !== 42) return null;
  /** @param {{ type: number, count: number, at: number } | undefined} e */
  const num = async (e, i = 0) => {
    if (!e) return null;
    const v = await read(base + e.at + i * (e.type === 3 ? 2 : 4), 4);
    if (v.byteLength < 2) return null;
    return e.type === 3 ? v.getUint16(0, le) : e.type === 1 || e.type === 7 ? v.getUint8(0) : v.getUint32(0, le);
  };
  /** @param {{ type: number, count: number, at: number } | undefined} e */
  const str = async (e) => (e ? ascii(await read(base + e.at, Math.min(e.count, 200)), 0, e.count) || null : null);
  return { le, root: h.getUint32(4, le), ifd: (/** @type {number} */ off) => ifd(read, base, off, le), num, str };
}

/** "2026:10:30 17:00:05" (+ "+09:00") as a time; without an offset, the phone's own zone. */
function exifTime(/** @type {string | null} */ s, /** @type {string | null} */ zone) {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s ?? '');
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  const z = /^([+-])(\d{2}):(\d{2})$/.exec(zone ?? '');
  if (z) return Date.UTC(y, mo - 1, d, h, mi, se) - (z[1] === '-' ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3])) * 60_000;
  const t = new Date(y, mo - 1, d, h, mi, se).getTime();
  return Number.isFinite(t) && y > 1900 ? t : null;
}

/** The words of one TIFF's IFD0 and EXIF IFD: camera, capture time, size, film simulation.
 * @param {NonNullable<Awaited<ReturnType<typeof tiff>>>} t @param {Read} read @param {number} base */
async function words(t, read, base) {
  const ifd0 = (await t.ifd(t.root)).tags;
  const make = await t.str(ifd0.get(0x010f));
  const model = (await t.str(ifd0.get(0x0110))) ?? (await t.str(ifd0.get(0xc614)));
  const camera = model ? (make && !model.toUpperCase().startsWith(make.split(' ')[0].toUpperCase()) ? `${make} ${model}` : model) : make;
  const exifAt = await t.num(ifd0.get(0x8769));
  const exif = exifAt ? (await t.ifd(exifAt)).tags : new Map();
  const taken = exifTime(await t.str(exif.get(0x9003)), await t.str(exif.get(0x9011)));
  const width = (await t.num(exif.get(0xa002))) ?? null, height = (await t.num(exif.get(0xa003))) ?? null;
  let film = null;
  const note = exif.get(0x927c);
  if (note && note.count > 12) {
    const at = base + note.at;
    const head = await read(at, 12);
    if (ascii(head, 0, 8) === 'FUJIFILM') {
      // Fujifilm's MakerNote: little-endian, its offsets from the note's own start.
      const fuji = await ifd(read, at, head.getUint32(8, true), true);
      const get = async (/** @type {number} */ tag) => {
        const e = fuji.tags.get(tag);
        return e ? (await read(at + e.at, 2)).getUint16(0, true) : null;
      };
      const sat = await get(0x1003);
      const mode = await get(0x1401);
      film = (sat !== null && MONO[/** @type {keyof typeof MONO} */ (sat)]) || (mode !== null ? (FILM[/** @type {keyof typeof FILM} */ (mode)] ?? null) : null);
    }
  }
  return { camera: camera || null, taken, width, height, film, ifd0 };
}

/** A JPEG's EXIF (APP1 "Exif") words, or nothing. @param {Uint8Array} jpeg */
export async function jpegWords(jpeg) {
  let o = 2;
  while (o + 4 < jpeg.length && jpeg[o] === 0xff) {
    const marker = jpeg[o + 1], len = (jpeg[o + 2] << 8) | jpeg[o + 3];
    if (marker === 0xe1 && jpeg[o + 4] === 0x45 && jpeg[o + 5] === 0x78 && jpeg[o + 6] === 0x69 && jpeg[o + 7] === 0x66) {
      const read = bytesRead(jpeg);
      const t = await tiff(read, o + 10);
      return t ? words(t, read, o + 10) : null;
    }
    if (marker === 0xda) break;
    o += 2 + len;
  }
  return null;
}

/** The format by name and type (shared/contract/photos.ts photoFormat). @param {File} f
 * @returns {PhotoMeta['format']} */
export function formatOf(f) {
  const ext = f.name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'raf') return 'raf';
  if (ext === 'dng') return 'dng';
  if (ext === 'jpg' || ext === 'jpeg' || f.type === 'image/jpeg') return 'jpeg';
  if (ext === 'heic' || ext === 'heif' || /image\/hei[cf]/.test(f.type)) return 'heic';
  return 'other';
}

/** A RAF's embedded JPEG: "FUJIFILMCCD-RAW " then, at 0x54, its offset and length (big-endian);
 * the camera's name at 0x1C. @param {Blob} file */
async function raf(file) {
  const h = await blobRead(file)(0, 92);
  if (h.byteLength < 92 || ascii(h, 0, 16) !== 'FUJIFILMCCD-RAW') return null;
  const off = h.getUint32(84), len = h.getUint32(88);
  if (!len || off + len > file.size) return null;
  const jpeg = new Uint8Array(await file.slice(off, off + len).arrayBuffer());
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  return { jpeg, camera: ascii(h, 28, 32) || null };
}

/** A DNG's largest JPEG preview (a reduced-size IFD, IFD0, its SubIFDs or the chain) and its words. @param {Blob} file */
async function dng(file) {
  const read = blobRead(file);
  const t = await tiff(read, 0);
  if (!t) return null;
  const w = await words(t, read, 0);
  const seen = new Set(), queue = [t.root];
  /** @type {{ at: number, len: number } | null} */
  let best = null;
  for (let i = 0; queue.length && i < 16; i++) {
    const off = /** @type {number} */ (queue.shift());
    if (!off || seen.has(off)) continue;
    seen.add(off);
    const { tags, next } = await t.ifd(off);
    queue.push(next);
    const subs = tags.get(0x014a);
    for (let s = 0; subs && s < Math.min(subs.count, 8); s++) queue.push(/** @type {number} */ (await t.num(subs, s)));
    const kind = await t.num(tags.get(0x00fe)), photometric = await t.num(tags.get(0x0106));
    if (kind !== 1 && off !== t.root) continue;
    if (photometric === 32803 || photometric === 34892) continue;
    const at = (await t.num(tags.get(0x0201))) ?? (await t.num(tags.get(0x0111)));
    const len = (await t.num(tags.get(0x0202))) ?? (await t.num(tags.get(0x0117)));
    if (at && len && (!best || len > best.len)) {
      const sig = await read(at, 2);
      if (sig.byteLength === 2 && sig.getUint16(0) === 0xffd8) best = { at, len };
    }
  }
  return { ...w, jpeg: best ? file.slice(best.at, best.at + best.len, 'image/jpeg') : null };
}

/** Everything the shelf needs from a picked file, at once. @param {File} file @returns {Promise<PhotoMeta>} */
export async function readPhoto(file) {
  const format = formatOf(file);
  /** @type {PhotoMeta} */
  const base = { format, preview: null, camera: null, film: null, taken_at: file.lastModified || Date.now(), width: null, height: null };
  try {
    if (format === 'raf') {
      const r = await raf(file);
      if (!r) return base;
      const w = await jpegWords(r.jpeg);
      return { ...base, preview: new Blob([r.jpeg], { type: 'image/jpeg' }), camera: w?.camera ?? r.camera, film: w?.film ?? null, taken_at: w?.taken ?? base.taken_at, width: w?.width ?? null, height: w?.height ?? null };
    }
    if (format === 'dng') {
      const d = await dng(file);
      return d ? { ...base, preview: d.jpeg, camera: d.camera, film: d.film, taken_at: d.taken ?? base.taken_at, width: d.width, height: d.height } : base;
    }
    if (format === 'jpeg') {
      const w = await jpegWords(new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer()));
      return { ...base, preview: file, camera: w?.camera ?? null, film: w?.film ?? null, taken_at: w?.taken ?? base.taken_at, width: w?.width ?? null, height: w?.height ?? null };
    }
    if (format === 'heic') return { ...base, preview: file };
  } catch {
    // A damaged or unusual file: it still goes to Drive, with its own time.
  }
  return base;
}
