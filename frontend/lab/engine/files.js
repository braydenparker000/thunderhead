// @ts-check
// The files an export writes: JPEG, PNG and 16-bit TIFF. Each takes the photo a few rows at a time and grows a
// Blob, which the browser keeps, not the page: a 40 MP export never sits whole in the page's memory.
import { block, entry } from './exif.js';
import { p3Profile } from './icc.js';

/** A file being written: `rows` takes the next n rows (sRGB, 16 bits a colour, three a pixel).
 * @typedef {{ rows: (px: Uint16Array, n: number) => Promise<void>, done: () => Promise<Blob> }} Writer */

/** A JPEG encoder: one band of 8-bit RGB rows to a JPEG of its own (the decoder's, app/decoder.js `jpegBand`).
 * @typedef {(rgb: Uint8Array, w: number, h: number, quality: number, fine: boolean) => Promise<Uint8Array>} Band */
/** What a file is to be, as plain data that can cross to the export's thread: its format (as the Export board
 * names it), its JPEG quality (the board's), the Exif it carries (exif.js `carry`), and a line of text on how it was
 * made (`note`: a JPEG's comment, a PNG's Comment, a TIFF's ImageDescription), or none.
 * `wide`: its colours are Display P3's, and it carries the profile that says so (icc.js); else sRGB's.
 * @typedef {{ fmt: string, q: number, kept: import('./exif.js').Entry[] | null, note?: string, wide?: boolean }} Spec */

/** The writer a Spec asks for, at w × h. @param {Spec} s @param {number} w @param {number} h @param {Band | null} band @returns {Writer} */
export function writer(s, w, h, band) {
  const icc = s.wide ? p3Profile() : null;
  if (s.fmt === 'JPEG') { if (!band) throw new Error('no JPEG encoder'); return jpeg(w, h, s.q, band, s.kept && block(s.kept), s.note, icc); }
  return s.fmt === 'PNG' ? png(w, h, s.kept && block(s.kept), s.note, icc) : tiff(w, h, s.kept, s.note, icc);
}

/** The encoder's quality for the Export board's (2026-11-13). Up to 90 they are the same; from 90 to 100 the board's
 * runs to the encoder's 97, a step at a time. At the encoder's 100 every table is 1, which loses nothing and saves
 * nothing: measured on the owner's 40 MP photo, 100 made 63 MB, 97 37 MB, 95 28 MB (and 95 with half the colour
 * resolution 21 MB), none of them with a difference an eye finds. @param {number} q the board's quality, 1 to 100 */
export const encoderQuality = (q) => (q <= 90 ? q : Math.round(90 + (Math.min(100, q) - 90) * 0.7));
/** A line of text as bytes, anything past ASCII written as JSON's \u escapes (a PNG's text is Latin-1). @param {string} t */
const ascii = (t) => Uint8Array.from(t.replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`), (c) => c.charCodeAt(0));

const SEED = 0x9e3779b9;
let seed = SEED;
/** The dither starts again from the same place: an export calls it first, so its files hang only on the photo. */
export function reseed() { seed = SEED; }
/** 16 bits to 8, rounded up or down by chance in proportion, so a smooth sky doesn't band.
 * @param {Uint16Array} px @param {Uint8Array} out */
function eight(px, out) {
  let s = seed;
  for (let i = 0; i < px.length; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    out[i] = (px[i] + ((s >>> 8) & 255)) / 257;
  }
  seed = s;
}
const bytes = (/** @type {number[]} */ ...b) => new Uint8Array(b);

/** A JPEG. The decoder's encoder makes it a band at a time; every band shares its tables, so their scans join
 * into one file with a restart marker between them. Colour is kept at full resolution from the board's quality 90
 * up; the encoder is given `encoderQuality` of it (97 at most).
 * @param {number} w @param {number} h @param {number} quality 1 to 100, as the Export board says it
 * @param {Band} band
 * @param {Uint8Array | null} exif an Exif block @param {string} [note] a comment (COM) after the Exif
 * @param {Uint8Array | null} [icc] a colour profile (APP2, after the Exif: a profile this small is one segment) @returns {Writer} */
export function jpeg(w, h, quality, band, exif, note, icc = null) {
  const fine = quality >= 90, cell = fine ? 8 : 16, across = Math.ceil(w / cell), q = encoderQuality(quality);   // a block of the JPEG, and how many a row
  const deep = Math.max(1, Math.min(256 / cell, Math.floor(65535 / across))) * cell, line = w * 3;   // rows a band
  let blob = new Blob([]), k = 0, hold = new Uint8Array(line * deep), have = 0, y = 0, chain = Promise.resolve();
  const part = async (/** @type {Uint8Array} */ rgb, /** @type {number} */ n) => {
    const j = await band(rgb, w, n, q, fine), head = [];
    let p = 2;
    const len = () => { if (j[p] !== 0xff || p + 4 > j.length) throw new Error('the JPEG band is not as expected'); return 2 + ((j[p + 2] << 8) | j[p + 3]); };
    for (; j[p + 1] !== 0xda; p += len()) {
      const seg = j.slice(p, p + len());
      if (seg[1] === 0xc0) { seg[5] = h >> 8; seg[6] = h & 255; }   // the whole photo's height, not the band's
      head.push(seg);
    }
    const scan = j.subarray(p + len(), j.length - 2);
    if (k === 0) {
      const app = exif && exif.length < 65500 ? [bytes(0xff, 0xe1, (exif.length + 8) >> 8, (exif.length + 8) & 255, 0x45, 0x78, 0x69, 0x66, 0, 0), exif] : [];
      if (icc && icc.length < 65000) app.push(bytes(0xff, 0xe2, (icc.length + 16) >> 8, (icc.length + 16) & 255), ascii('ICC_PROFILE'), bytes(0, 1, 1), icc);
      const said = note ? ascii(note).subarray(0, 65000) : null;
      if (said) app.push(bytes(0xff, 0xfe, (said.length + 2) >> 8, (said.length + 2) & 255), said);   // the comment, near the start: a cut-off file still has it
      const first = head[0]?.[1] === 0xe0 ? 1 : 0, every = across * (deep / cell);   // the JFIF segment leads; blocks between restarts
      blob = new Blob([bytes(0xff, 0xd8), ...head.slice(0, first), ...app, ...head.slice(first), bytes(0xff, 0xdd, 0, 4, every >> 8, every & 255), j.subarray(p, p + len()), scan]);
    } else blob = new Blob([blob, bytes(0xff, 0xd0 + ((k - 1) & 7)), scan]);
    k++;
  };
  return {
    async rows(px, n) {
      for (let at = 0; at < n;) {
        const take = Math.min(n - at, deep - have);
        eight(px.subarray(at * line, (at + take) * line), hold.subarray(have * line));
        have += take; at += take; y += take;
        if (have < deep && y < h) continue;
        const rgb = hold.subarray(0, have * line), rows = have, before = chain;
        chain = chain.then(() => part(rgb, rows));   // encoded while the next band is developed
        hold = new Uint8Array(line * deep); have = 0;
        await before;
      }
    },
    async done() { await chain; return new Blob([blob, bytes(0xff, 0xd9)], { type: 'image/jpeg' }); },
  };
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
/** A PNG chunk. @param {string} type @param {Uint8Array[]} data */
function chunk(type, ...data) {
  const size = data.reduce((s, d) => s + d.length, 0), b = new Uint8Array(12 + size), v = new DataView(b.buffer);
  v.setUint32(0, size);
  for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
  let at = 8, c = 0xffffffff;
  for (const d of data) { b.set(d, at); at += d.length; }
  for (let i = 4; i < at; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  v.setUint32(at, ~c >>> 0);
  return b;
}
/** Bytes as a zlib stream that packs nothing (one stored block and its checksum): a PNG's profile must be a zlib
 * stream, and one of half a kilobyte is not worth waiting on a packer for. @param {Uint8Array} d */
function stored(d) {
  let a = 1, b = 0; for (const v of d) { a = (a + v) % 65521; b = (b + a) % 65521; }
  return Uint8Array.from([0x78, 0x01, 1, d.length & 255, d.length >> 8, ~d.length & 255, (~d.length >> 8) & 255, ...d, b >> 8, b & 255, a >> 8, a & 255]);
}
/** A PNG, 8 bits a colour, packed by the browser's own deflate as the rows arrive.
 * @param {number} w @param {number} h @param {Uint8Array | null} exif an Exif block @param {string} [note] a tEXt Comment
 * @param {Uint8Array | null} [icc] a colour profile (iCCP, in place of the sRGB chunk) @returns {Writer} */
export function png(w, h, exif, note, icc = null) {
  const pack = new CompressionStream('deflate'), wr = pack.writable.getWriter(), line = w * 3, head = new Uint8Array(13);
  new DataView(head.buffer).setUint32(0, w); new DataView(head.buffer).setUint32(4, h); head.set([8, 2, 0, 0, 0], 8);   // 8 bits, RGB
  let blob = new Blob([bytes(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', head), icc ? chunk('iCCP', ascii('Display P3'), bytes(0, 0), stored(icc)) : chunk('sRGB', bytes(0)), ...(exif ? [chunk('eXIf', exif)] : []),
    ...(note ? [chunk('tEXt', ascii('Comment'), bytes(0), ascii(note))] : [])]);
  const packed = (async () => {
    let some = /** @type {Uint8Array[]} */ ([]), size = 0;
    const flush = () => { if (size) blob = new Blob([blob, chunk('IDAT', ...some)]); some = []; size = 0; };
    for (const rd = pack.readable.getReader(); ;) {
      const { value, done } = await rd.read();
      if (done) break;
      some.push(value); size += value.length;
      if (size > 1 << 20) flush();
    }
    flush();
  })();
  let up = new Uint8Array(line), cur = new Uint8Array(line);
  return {
    async rows(px, n) {
      const out = new Uint8Array(n * (line + 1));
      for (let r = 0, o = 0; r < n; r++, o += line + 1) {
        eight(px.subarray(r * line, (r + 1) * line), cur);
        out[o] = 3;   // each byte less the mean of the one to its left and the one above (PNG's "average" filter)
        for (let i = 0; i < line; i++) out[o + 1 + i] = cur[i] - (((i > 2 ? cur[i - 3] : 0) + up[i]) >> 1);
        [up, cur] = [cur, up];
      }
      await wr.write(out);
    },
    async done() { await wr.close(); await packed; return new Blob([blob, chunk('IEND')], { type: 'image/png' }); },
  };
}

/** A TIFF, 16 bits a colour, not compressed, with the photo's Exif directories in its own, and the note as its
 * ImageDescription. @param {number} w @param {number} h @param {import('./exif.js').Entry[] | null} carried @param {string} [note]
 * @param {Uint8Array | null} [icc] a colour profile (tag 34675) @returns {Writer} */
export function tiff(w, h, carried, note, icc = null) {
  const per = 64, strips = Math.ceil(h / per), ours = [256, 257, 258, 259, 262, 273, 274, 277, 278, 279, 284, 34675, ...(note ? [270] : [])];
  const said = note ? Uint8Array.from([...ascii(note), 0]) : null, desc = [...(said ? [{ tag: 270, type: 2, count: said.length, data: said }] : []), ...(icc ? [{ tag: 34675, type: 7, count: icc.length, data: icc }] : [])];   // ASCII, ending in a zero; the profile as plain bytes
  const head = (/** @type {number} */ at) => block((carried || []).filter((e) => !ours.includes(e.tag)).concat(desc,
    entry(256, 4, [w]), entry(257, 4, [h]), entry(258, 3, [16, 16, 16]), entry(259, 3, [1]), entry(262, 3, [2]),   // size, bits, no compression, RGB
    entry(273, 4, Array.from({ length: strips }, (_, i) => at + i * per * w * 6)), entry(274, 3, [1]), entry(277, 3, [3]), entry(278, 4, [per]),
    entry(279, 4, Array.from({ length: strips }, (_, i) => Math.min(per, h - i * per) * w * 6)), entry(284, 3, [1])));
  let blob = new Blob([head(head(0).length)]);
  return {
    async rows(px, n) { blob = new Blob([blob, px.subarray(0, n * w * 3)]); },
    async done() { return new Blob([blob], { type: 'image/tiff' }); },
  };
}
