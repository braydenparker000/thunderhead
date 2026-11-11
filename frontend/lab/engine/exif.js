// @ts-check
// A photo's Exif, carried from the camera's JPEG into an export. It is read as a tree of directories, changed
// (the export is upright and has its own size; the camera's thumbnail and, unless asked for, the place it was
// taken are left out) and written again. Fujifilm's maker notes keep offsets of their own, so they move whole.

/** @typedef {{ tag: number, type: number, count: number, data: Uint8Array, sub?: Entry[] }} Entry */
const UNIT = [1, 1, 1, 2, 4, 4, 1, 1, 2, 4, 4, 4, 8];   // a value's bytes by Exif type; a rational (5, 10) is two of its fours
const PAIR = (/** @type {number} */ type) => (type === 5 || type === 10 ? 2 : 1);
const POINTERS = [0x8769, 0x8825, 0xa005];   // the Exif, GPS and interoperability directories

/** The Exif block in a JPEG's first bytes (a TIFF), or null. @param {Uint8Array} j */
export function find(j) {
  for (let a = 2; a + 10 < j.length && j[a] === 0xff && j[a + 1] !== 0xda;) {
    const len = (j[a + 2] << 8) | j[a + 3];
    if (j[a + 1] === 0xe1 && j[a + 4] === 0x45 && j[a + 5] === 0x78 && j[a + 6] === 0x69 && j[a + 7] === 0x66) return j.subarray(a + 10, a + 2 + len);
    a += 2 + len;
  }
  return null;
}

/** A directory's entries and the directories it points to, every value little-endian.
 * @param {DataView} v @param {number} at @param {boolean} le @param {number} [depth] @returns {Entry[]} */
function dir(v, at, le, depth = 0) {
  const out = [];
  for (let k = 0, n = v.getUint16(at, le); k < n; k++) {
    const p = at + 2 + k * 12, tag = v.getUint16(p, le), type = v.getUint16(p + 2, le), count = v.getUint32(p + 4, le), unit = UNIT[type] || 1, size = unit * count * PAIR(type);   // (a rational read as one four kept where its value was, not the value: every export carried a wrong shutter time, aperture and focal length)
    if (POINTERS.includes(tag)) { if (depth < 3) out.push({ tag, type: 4, count: 1, data: new Uint8Array(4), sub: dir(v, v.getUint32(p + 8, le), le, depth + 1) }); continue; }
    const data = new Uint8Array(v.buffer, v.byteOffset + (size > 4 ? v.getUint32(p + 8, le) : p + 8), size).slice();
    if (!le && unit > 1) for (let i = 0; i < size; i += unit) data.subarray(i, i + unit).reverse();
    out.push({ tag, type, count, data });
  }
  return out;
}

/** A value of shorts (type 3) or longs (type 4) as an entry. @param {number} tag @param {3 | 4} type @param {number[]} values @returns {Entry} */
export function entry(tag, type, values) {
  const data = new Uint8Array(values.length * UNIT[type]), v = new DataView(data.buffer);
  values.forEach((x, i) => (type === 3 ? v.setUint16(i * 2, x, true) : v.setUint32(i * 4, x, true)));
  return { tag, type, count: values.length, data };
}

/** The camera's Exif directories, or null. @param {Uint8Array} jpeg the camera's JPEG (its first bytes are enough) */
function read(jpeg) {
  try {
    const t = find(jpeg);
    if (!t) return null;
    const v = new DataView(t.buffer, t.byteOffset, t.byteLength), le = v.getUint16(0) === 0x4949;
    return dir(v, v.getUint32(4, le), le);
  } catch { return null; }
}

/** The day the photo was taken, as 2026-11-09, or ''. @param {Uint8Array} jpeg */
export function taken(jpeg) {
  const es = read(jpeg), d = es?.find((e) => e.tag === 0x8769)?.sub?.find((e) => e.tag === 0x9003) || es?.find((e) => e.tag === 0x0132);
  const s = d ? String.fromCharCode(...d.data.subarray(0, 10)).replace(/:/g, '-') : '';
  return /^\d{4}-\d\d-\d\d$/.test(s) ? s : '';
}

/** What the camera wrote of the shot, each only where the Exif says (else 0 or ''): when it was taken (in ms: the
 * camera's clock in the zone it names beside it, or read as this phone's local time when it names none), the camera, the lens, the ISO, the shutter time in seconds, the
 * aperture's f-number and the focal length in mm. @param {Uint8Array} jpeg the camera's JPEG (its first bytes are enough) */
export function shot(jpeg) {
  const es = read(jpeg) || [], x = es.find((e) => e.tag === 0x8769)?.sub || [], get = (/** @type {Entry[]} */ l, /** @type {number} */ tag) => l.find((e) => e.tag === tag);
  const text = (/** @type {Entry | undefined} */ e) => (e ? String.fromCharCode(...e.data.subarray(0, 80)).replace(/\0[^]*$/, '').trim() : '');
  const num = (/** @type {Entry | undefined} */ e) => {
    if (!e || e.data.length < UNIT[e.type] * PAIR(e.type)) return 0;
    const v = new DataView(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    return e.type === 3 ? v.getUint16(0, true) : e.type === 4 ? v.getUint32(0, true) : e.type === 5 ? v.getUint32(0, true) / (v.getUint32(4, true) || 1) : e.type === 10 ? v.getInt32(0, true) / (v.getInt32(4, true) || 1) : 0;
  };
  const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(text(get(x, 0x9003) || get(es, 0x0132)));
  const z = /^([+-])(\d\d):(\d\d)/.exec(text(get(x, 0x9011))), t = m ? [+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]] : null;   // OffsetTimeOriginal
  const at = !t ? 0 : z ? Date.UTC(t[0], t[1], t[2], t[3], t[4], t[5]) - (z[1] === '-' ? -1 : 1) * (+z[2] * 60 + +z[3]) * 60000 : new Date(t[0], t[1], t[2], t[3], t[4], t[5]).getTime();
  return { at: at || 0, camera: [text(get(es, 0x010f)), text(get(es, 0x0110))].filter(Boolean).join(' '), lens: text(get(x, 0xa434)),
    iso: num(get(x, 0x8827)), time: num(get(x, 0x829a)), f: num(get(x, 0x829d)), mm: num(get(x, 0x920a)) };
}

/** What an export carries of the photo's Exif, or null for nothing.
 * @param {Uint8Array} jpeg the camera's JPEG @param {'All' | 'Copyright only' | 'None'} keep
 * @param {boolean} place keep where it was taken @param {number} w @param {number} h the export's size @returns {Entry[] | null} */
export function carry(jpeg, keep, place, w, h) {
  let es = keep === 'None' ? null : read(jpeg);
  if (!es) return null;
  if (keep !== 'All') { es = es.filter((e) => e.tag === 0x013b || e.tag === 0x8298); return es.length ? es : null; }   // artist, copyright
  es = es.filter((e) => e.tag !== 0x0112 && (place || e.tag !== 0x8825)).concat(entry(0x0112, 3, [1]));   // upright now
  const x = es.find((e) => e.tag === 0x8769);
  if (x?.sub) x.sub = x.sub.filter((e) => ![0xa001, 0xa002, 0xa003].includes(e.tag)).concat(entry(0xa001, 3, [1]), entry(0xa002, 4, [w]), entry(0xa003, 4, [h]));   // sRGB, the size
  return es;
}

/** @returns {number} */
const span = (/** @type {Entry[]} */ es) => 6 + es.reduce((s, e) => s + 12 + (e.sub ? span(e.sub) : e.data.length > 4 ? e.data.length + (e.data.length & 1) : 0), 0);
/** Writes a directory at `at`, its long values and the directories it points to after it; returns where they end.
 * No directory follows it: the camera's thumbnail is not carried. @param {DataView} v @param {Uint8Array} b @param {Entry[]} es @param {number} at */
function put(v, b, es, at) {
  es = [...es].sort((x, y) => x.tag - y.tag);
  let free = at + 6 + es.length * 12;
  v.setUint16(at, es.length, true);
  es.forEach((e, i) => {
    const p = at + 2 + i * 12;
    v.setUint16(p, e.tag, true); v.setUint16(p + 2, e.type, true); v.setUint32(p + 4, e.count, true);
    if (e.sub) { v.setUint32(p + 8, free, true); free = put(v, b, e.sub, free); }
    else if (e.data.length > 4) { v.setUint32(p + 8, free, true); b.set(e.data, free); free += e.data.length + (e.data.length & 1); }
    else b.set(e.data, p + 8);
  });
  return free;
}
/** The entries as a little-endian TIFF: an Exif block, or the head of a TIFF file. @param {Entry[]} es */
export function block(es) {
  const b = new Uint8Array(8 + span(es));
  b.set([0x49, 0x49, 42, 0, 8, 0, 0, 0]);
  put(new DataView(b.buffer), b, es, 8);
  return b;
}
