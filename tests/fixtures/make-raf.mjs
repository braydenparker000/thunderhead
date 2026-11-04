// A synthetic RAF-like file for Photos' tests (PHOTOS.md §3.1): the RAF header ("FUJIFILMCCD-RAW ",
// the camera's name at 0x1C, the embedded JPEG's offset and length at 0x54, big-endian), then the
// JPEG with an EXIF block (camera, capture time, size, and a Fujifilm MakerNote naming the film
// simulation), then filler where a real file keeps its sensor data. The JPEG itself is an invented
// image the test draws in the browser. Nothing here comes from a camera.

/** A little-endian TIFF of IFD0 (Make, Model, the EXIF IFD) and the EXIF IFD, its values after it. */
function exifTiff({ make, model, taken, zone, width, height, film }) {
  const out = [];
  const u16 = (v) => out.push(v & 255, (v >> 8) & 255);
  const u32 = (v) => out.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
  const text = (s) => [...new TextEncoder().encode(s), 0];
  // The MakerNote: "FUJIFILM", its IFD at 12 from its own start: Saturation 0 (colour), FilmMode.
  const note = [...new TextEncoder().encode('FUJIFILM'), 12, 0, 0, 0, 2, 0, 0x03, 0x10, 3, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0x01, 0x14, 3, 0, 1, 0, 0, 0, film & 255, film >> 8, 0, 0, 0, 0, 0, 0];
  const ifd0 = [[0x010f, 2, text(make)], [0x0110, 2, text(model)], [0x8769, 4, null]];
  const exif = [[0x9003, 2, text(taken)], [0x9011, 2, text(zone)], [0xa002, 4, width], [0xa003, 4, height], [0x927c, 7, note]];
  const size = (list) => 2 + list.length * 12 + 4;
  const ifd0At = 8, exifAt = ifd0At + size(ifd0);
  let data = exifAt + size(exif);
  const blobs = [];
  const entry = (tag, type, v) => {
    u16(tag); u16(type);
    if (Array.isArray(v)) {
      u32(v.length);
      if (v.length <= 4) { out.push(...v, ...Array(4 - v.length).fill(0)); return; }
      u32(data); blobs.push(v); data += v.length + (v.length & 1); if (v.length & 1) v.push(0);
    } else { u32(1); u32(v ?? exifAt); }
  };
  out.push(0x49, 0x49, 42, 0); u32(ifd0At);
  u16(ifd0.length); for (const [t, ty, v] of ifd0) entry(t, ty, v); u32(0);
  u16(exif.length); for (const [t, ty, v] of exif) entry(t, ty, v); u32(0);
  for (const b of blobs) out.push(...b);
  return Uint8Array.from(out);
}

/** The JPEG with an APP1 "Exif" segment right after its SOI. @param {Uint8Array} jpeg */
export function withExif(jpeg, words) {
  const tiff = exifTiff(words);
  const app1 = new Uint8Array(4 + 6 + tiff.length);
  app1.set([0xff, 0xe1, (app1.length - 2) >> 8, (app1.length - 2) & 255]);
  app1.set(new TextEncoder().encode('Exif\0\0'), 4);
  app1.set(tiff, 10);
  const out = new Uint8Array(jpeg.length + app1.length);
  out.set(jpeg.subarray(0, 2));
  out.set(app1, 2);
  out.set(jpeg.subarray(2), 2 + app1.length);
  return out;
}

/** A RAF-like file around an invented JPEG. */
export function makeRaf(jpeg, o = {}) {
  const words = { make: 'FUJIFILM', model: 'X-E5', taken: '2026:10:30 17:00:05', zone: '+00:00', width: 640, height: 427, film: 0x600, ...o };
  const inner = withExif(jpeg, words);
  const offset = 0x100, filler = o.filler ?? 64 * 1024;
  const raf = new Uint8Array(offset + inner.length + filler);
  const view = new DataView(raf.buffer);
  raf.set(new TextEncoder().encode('FUJIFILMCCD-RAW 0201FF383501'));
  raf.set(new TextEncoder().encode(words.model), 0x1c);
  view.setUint32(0x54, offset);
  view.setUint32(0x58, inner.length);
  raf.set(inner, offset);
  for (let i = offset + inner.length; i < raf.length; i++) raf[i] = (i * 31) & 255;
  return raf;
}
