// @ts-check
// Display P3 for exported files: the numbers that take the engine's colours to it, and the colour profile a file
// carries so that whatever opens it knows which colours its numbers mean. Display P3 has DCI-P3's red, green and
// blue (stronger than sRGB's, most of all its reds and greens), sRGB's white (D65) and sRGB's curve; phone screens
// show it. Everything here is worked out from those published points, not copied from a profile file: the matrices
// by the usual way (each colour's own point scaled so the three add up to white), and the profile written field by
// field to the ICC's format (version 4.3: a header, a table of tags, and the tags: description, copyright, white
// point, the three colours as seen under D50 by Bradford's adaptation, one shared curve, and that adaptation).

/** @typedef {number[][]} M3 a 3 x 3 matrix, a row at a time */
/** @param {M3} a @param {M3} b @returns {M3} */
export const mul = (a, b) => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
/** @param {M3} m @returns {M3} */
export function inverse(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
}
const apply = (/** @type {M3} */ m, /** @type {number[]} */ v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const xyz = (/** @type {number[]} */ [x, y]) => [x / y, 1, (1 - x - y) / y];

/** Where a colour space's red, green, blue and white sit (CIE x, y). */
export const SRGB = { r: [0.64, 0.33], g: [0.3, 0.6], b: [0.15, 0.06], w: [0.3127, 0.329] };
export const P3 = { r: [0.68, 0.32], g: [0.265, 0.69], b: [0.15, 0.06], w: [0.3127, 0.329] };
const D50 = [0.9642, 1, 0.8249];   // the profile connection space's white, as the ICC writes it

/** From a space's linear red, green and blue to XYZ (its white at Y = 1). @param {typeof SRGB} s @returns {M3} */
export function toXyz(s) {
  const P = [0, 1, 2].map((row) => [s.r, s.g, s.b].map((c) => xyz(c)[row])), k = apply(inverse(P), xyz(s.w));
  return P.map((r) => r.map((v, j) => v * k[j]));
}
/** Linear sRGB to linear Display P3: the last step of a frame made for a P3 file (wgsl.js). */
export const SRGB_TO_P3 = mul(inverse(toXyz(P3)), toXyz(SRGB));

/** Bradford's adaptation from one white to another (XYZ). @param {number[]} from @param {number[]} to @returns {M3} */
export function bradford(from, to) {
  const B = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]], a = apply(B, from), b = apply(B, to);
  return mul(inverse(B), mul([[b[0] / a[0], 0, 0], [0, b[1] / a[1], 0], [0, 0, b[2] / a[2]]], B));
}

const fixed = (/** @type {number} */ v) => Math.round(v * 65536) | 0;   // s15Fixed16
/** A colour profile for Display P3, as bytes (about half a kilobyte): for a JPEG's APP2, a PNG's iCCP, a TIFF's tag 34675. */
export function p3Profile() {
  const chad = bradford(xyz(P3.w), D50), M = mul(chad, toXyz(P3)), enc = new TextEncoder();
  const mluc = (/** @type {string} */ text) => { const b = new DataView(new ArrayBuffer(28 + text.length * 2)); b.setUint32(0, 0x6d6c7563); b.setUint32(8, 1); b.setUint32(12, 12); b.setUint16(16, 0x656e); b.setUint16(18, 0x5553); b.setUint32(20, text.length * 2); b.setUint32(24, 28); for (let i = 0; i < text.length; i++) b.setUint16(28 + i * 2, text.charCodeAt(i)); return new Uint8Array(b.buffer); };
  const XYZ = (/** @type {number[]} */ v) => { const b = new DataView(new ArrayBuffer(20)); b.setUint32(0, 0x58595a20); v.forEach((x, i) => b.setInt32(8 + i * 4, fixed(x))); return new Uint8Array(b.buffer); };
  // the curve, as sRGB's: y = ((x + 0.055) / 1.055) ^ 2.4 from 0.04045 up, x / 12.92 below (a parametric curve, kind 3)
  const para = (() => { const b = new DataView(new ArrayBuffer(32)); b.setUint32(0, 0x70617261); b.setUint16(8, 3); [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045].forEach((x, i) => b.setInt32(12 + i * 4, fixed(x))); return new Uint8Array(b.buffer); })();
  const sf32 = (() => { const b = new DataView(new ArrayBuffer(44)); b.setUint32(0, 0x73663332); chad.flat().forEach((x, i) => b.setInt32(8 + i * 4, fixed(x))); return new Uint8Array(b.buffer); })();
  const col = (/** @type {number} */ j) => XYZ(M.map((r) => r[j]));
  /** @type {[string, Uint8Array][]} */
  const tags = [['desc', mluc('Display P3')], ['cprt', mluc('No copyright, use freely')], ['wtpt', XYZ(D50)], ['rXYZ', col(0)], ['gXYZ', col(1)], ['bXYZ', col(2)], ['rTRC', para], ['gTRC', para], ['bTRC', para], ['chad', sf32]];
  // one copy of the curve serves the three: each tag's data starts on a multiple of four
  const places = new Map(), blocks = /** @type {Uint8Array[]} */ ([]);
  let at = 128 + 4 + tags.length * 12;
  for (const [, data] of tags) if (!places.has(data)) { places.set(data, at); blocks.push(data); at += Math.ceil(data.length / 4) * 4; }
  const out = new Uint8Array(at), v = new DataView(out.buffer);
  v.setUint32(0, at); v.setUint32(8, 0x04300000); out.set(enc.encode('mntrRGB XYZ '), 12);
  [2026, 1, 1, 0, 0, 0].forEach((x, i) => v.setUint16(24 + i * 2, x));   // a fixed date: the same bytes every time
  out.set(enc.encode('acsp'), 36); D50.forEach((x, i) => v.setInt32(68 + i * 4, fixed(x)));
  v.setUint32(128, tags.length);
  tags.forEach(([name, data], i) => { out.set(enc.encode(name), 132 + i * 12); v.setUint32(136 + i * 12, places.get(data)); v.setUint32(140 + i * 12, data.length); });
  for (const b of blocks) out.set(b, places.get(b));
  return out;
}
