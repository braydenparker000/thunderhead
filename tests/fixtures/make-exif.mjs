// Synthetic EXIF for Photos' info tests (PHOTOS.md § Info): a TIFF in either byte order with IFD0, the
// EXIF IFD and a GPS IFD holding an invented place (which the readers must never follow), a Fujifilm
// maker note of the tags asked for, and a JPEG that carries it all in its APP1. Every value is
// invented; nothing here comes from a camera.

const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8 };

/** A value's bytes. @param {number} type @param {any} v @param {boolean} le */
function encode(type, v, le) {
  if (type === 2) return [...new TextEncoder().encode(v), 0];
  if (type === 1 || type === 6 || type === 7) return [...v].map((b) => b & 255);
  const list = type === 5 || type === 10 ? v.flat() : [].concat(v);
  const n = type === 3 || type === 8 ? 2 : 4;
  const out = new Uint8Array(list.length * n);
  const view = new DataView(out.buffer);
  list.forEach((x, i) => (n === 2 ? view.setUint16(i * n, x & 0xffff, le) : view.setUint32(i * n, x >>> 0, le)));
  return [...out];
}

/** IFDs one after another from `at` (offsets from the block's origin), then their values.
 * An entry is [tag, type, value]; a value { ifd: k } is the offset of the k-th IFD.
 * @returns {{ bytes: number[], starts: number[], end: number }} */
function ifds(lists, le, at) {
  const starts = [];
  let p = at;
  for (const l of lists) { starts.push(p); p += 2 + l.length * 12 + 4; }
  const out = [], blobs = [];
  let data = p;
  const u16 = (v) => out.push(...encode(3, v, le));
  const u32 = (v) => out.push(...encode(4, v, le));
  for (const l of lists) {
    u16(l.length);
    for (const [tag, type, v] of l) {
      const bytes = v && typeof v === 'object' && 'ifd' in v ? encode(4, starts[v.ifd], le) : encode(type, v, le);
      u16(tag); u16(type); u32(bytes.length / SIZE[type]);
      if (bytes.length <= 4) out.push(...bytes, ...Array(4 - bytes.length).fill(0));
      else { u32(data); blobs.push(...bytes); if (bytes.length & 1) blobs.push(0); data += bytes.length + (bytes.length & 1); }
    }
    u32(0);
  }
  return { bytes: [...out, ...blobs], starts, end: data };
}

/** Fujifilm's maker note: "FUJIFILM", its IFD's offset (12), the IFD; little-endian, its offsets
 * from its own start. @param {[number, number, any][]} entries */
export function fujiNote(entries) {
  const { bytes } = ifds([entries], true, 12);
  return [...new TextEncoder().encode('FUJIFILM'), 12, 0, 0, 0, ...bytes];
}

/** A TIFF: IFD0 (with the EXIF and GPS pointers), the EXIF IFD, the GPS IFD. Returns its bytes and
 * where the GPS IFD and its values lie, so a test can see they were never read. */
export function makeTiff({ le = true, ifd0 = [], exif = [], gps = [] } = {}) {
  const root = [...ifd0, [0x8769, 4, { ifd: 1 }], [0x8825, 4, { ifd: 2 }]];
  const { bytes, starts, end } = ifds([root, exif, gps], le, 8);
  const head = le ? [0x49, 0x49, 42, 0, 8, 0, 0, 0] : [0x4d, 0x4d, 0, 42, 0, 0, 0, 8];
  return { tiff: Uint8Array.from([...head, ...bytes]), gpsAt: starts[2], end };
}

/** A tiny JPEG-shaped file (SOI, APP1 "Exif", EOI) around a TIFF. @param {Uint8Array} tiff */
export function jpegWith(tiff) {
  const len = 2 + 6 + tiff.length;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...new TextEncoder().encode('Exif\0\0'), ...tiff, 0xff, 0xd9]);
}

/** An invented place, as a GPS IFD would hold it (degrees, minutes, seconds). */
export const PLACE = [[0x0001, 2, 'N'], [0x0002, 5, [[35, 1], [39, 1], [3105, 100]]], [0x0003, 2, 'E'], [0x0004, 5, [[139, 1], [44, 1], [4344, 100]]]];

/** A full set: the EXIF a camera writes, and a maker note of every setting the info shows. */
export function fullSet(le = true) {
  const note = fujiNote([
    [0x1001, 3, 0x84], [0x1002, 3, 0xff0], [0x1003, 3, 0x80], [0x1005, 3, 5600], [0x100a, 9, [40, -20]],
    [0x100e, 3, 0x280], [0x100f, 9, 2000], [0x1040, 9, 16], [0x1041, 9, -16], [0x1047, 9, 64],
    [0x1048, 9, 64], [0x104c, 3, 32], [0x104e, 9, 32], [0x1401, 3, 0x600], [0x1402, 3, 1], [0x1403, 3, 400],
    [0x1422, 3, [2, 1, 0]], [0x1443, 3, 0], [0x1444, 3, 2],
  ]);
  return makeTiff({
    le,
    ifd0: [[0x010f, 2, 'FUJIFILM'], [0x0110, 2, 'X-E5'], [0x0112, 3, 6], [0x0131, 2, 'Digital Camera X-E5 Ver1.00']],
    exif: [
      [0x829a, 5, [[1, 250]]], [0x829d, 5, [[28, 10]]], [0x8822, 3, 3], [0x8827, 3, 400], [0x9204, 10, [[-2, 3]]],
      [0x9207, 3, 5], [0x9209, 3, 16], [0x920a, 5, [[230, 10]]], [0xa002, 4, 7728], [0xa003, 4, 5152],
      [0xa403, 3, 0], [0xa405, 3, 35], [0xa434, 2, 'XF23mmF2 R WR'], [0x927c, 7, note],
    ],
    gps: PLACE,
  });
}
