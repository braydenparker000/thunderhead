// @ts-check
// The lens's own corrections. A Fujifilm RAF carries, for the lens and focus it was shot with, how far the
// picture is distorted, how far red and blue are spread from green (fringing) and how much darker it is,
// each at nine distances from the centre. The method is darktable's "embedded metadata" lens correction
// (darktable's lens.cc and exif.cc, GPL-3; Simone Gotti and the darktable authors): the same numbers, the same
// straight lines between them, the same enlargement so that no empty border shows.

/** @typedef {{ knots: number[], dist: number[], red: number[], blue: number[], vig: number[] }} Lens distances
 * as a share of the half diagonal; distortion in per cent; red and blue as shares; brightness in per cent */

/** The lens data in a RAF, or null. Its raw part is a TIFF whose directory 0xf000 holds three tables:
 * 0xf00b distortion, 0xf00f fringing, 0xf010 brightness. @param {ArrayBuffer} buf @returns {Lens | null} */
export function lensOf(buf) {
  try {
    const v = new DataView(buf), base = v.getUint32(100), le = v.getUint16(base) === 0x4949, u16 = (/** @type {number} */ o) => v.getUint16(base + o, le), u32 = (/** @type {number} */ o) => v.getUint32(base + o, le);
    const find = (/** @type {number} */ ifd, /** @type {number} */ tag) => { for (let k = 0, n = u16(ifd); k < n; k++) if (u16(ifd + 2 + k * 12) === tag) return ifd + 2 + k * 12; return -1; };
    const fuji = u32(find(u32(4), 0xf000) + 8);
    const list = (/** @type {number} */ tag) => { const e = find(fuji, tag); if (e < 0 || u16(e + 2) !== 10) return []; const at = u32(e + 8); return Array.from({ length: u32(e + 4) }, (_, i) => v.getInt32(base + at + i * 8, le) / (v.getInt32(base + at + i * 8 + 4, le) || 1)); };
    const d = list(0xf00b), c = list(0xf00f), b = list(0xf010);
    // X-Trans IV and V: a leading number, nine distances, nine values (fringing: nine red, nine blue)
    if (d.length === 19 && c.length === 29 && b.length === 19) return { knots: d.slice(1, 10), dist: d.slice(10, 19), red: c.slice(10, 19), blue: c.slice(19, 28), vig: b.slice(10, 19) };
    // X-Trans I to III: eleven distances; the fringing table leaves out the first, which is the centre
    if (d.length === 23 && c.length === 31 && b.length === 23) return { knots: d.slice(1, 12), dist: d.slice(12, 23), red: [0, ...c.slice(11, 21)], blue: [0, ...c.slice(21, 31)], vig: b.slice(12, 23) };
  } catch {}
  return null;
}

/** A value between a table's points (flat beyond its ends). */
const lin = (/** @type {number[]} */ x, /** @type {number[]} */ y, /** @type {number} */ at) => {
  if (at <= x[0]) return y[0];
  for (let i = 1; i < x.length; i++) if (at <= x[i]) return y[i - 1] + ((at - x[i - 1]) * (y[i] - y[i - 1])) / (x[i] - x[i - 1] || 1);
  return y[y.length - 1];
};
export const N = 64, REACH = 1.25;   // the table's entries, and how far past the corner (1) it goes

/** The lens's colour fringing as the demosaic takes it (demosaic.js `lead`): on a sensor `W` × `H`, how much
 * further from the centre red and blue were recorded than green, as a share of the distance, at 16 steps out to
 * `reach` pixels (a little past the corner). The same numbers the table below gives the warp, which then leaves
 * the colours where the demosaic laid them. Null for a lens with none. @param {Lens | null | undefined} lens @param {number} W @param {number} H */
export function fringeOf(lens, W, H) {
  if (!lens || !(lens.red.some(Boolean) || lens.blue.some(Boolean))) return null;
  const kn = lens.knots[0] > 0 ? [0, ...lens.knots] : lens.knots, pad = (/** @type {number[]} */ a) => (lens.knots[0] > 0 ? [0, ...a] : a), red = pad(lens.red), blue = pad(lens.blue);
  const MOST = 1.05, table = new Float32Array(64);
  for (let j = 0; j < 16; j++) table.set([lin(kn, red, (j / 15) * MOST), lin(kn, blue, (j / 15) * MOST), 0, 0], j * 4);
  return { centre: [W / 2, H / 2], reach: (MOST * Math.hypot(W, H)) / 2, table };
}

/** The correction as a table by distance from the centre of the corrected picture (0 to REACH, a share of the
 * half diagonal): by how much to multiply that distance to find where red, green and blue were recorded, and
 * the gain that undoes the darkening there. With no lens data, or one that corrects nothing, null.
 * @param {Lens | null} lens @param {number} w @param {number} h the picture's size
 * @param {number} [more] distortion added by hand, −1..1 @param {number} [light] corner brightness added by hand, −1..1 */
export function lensTable(lens, w, h, more = 0, light = 0) {
  if (!lens && !more && !light) return null;
  const L = lens || { knots: [1], dist: [0], red: [0], blue: [0], vig: [100] };
  const kn = L.knots[0] > 0 ? [0, ...L.knots] : L.knots, pad = (/** @type {number[]} */ a, /** @type {number} */ first) => (L.knots[0] > 0 ? [first, ...a] : a);
  const dist = pad(L.dist.map((d) => d / 100 + 1), 1), red = pad(L.red, 0), blue = pad(L.blue, 0), vig = pad(L.vig.map((x) => x / 100), 1);
  // from "where it was recorded" to "where it belongs": a point recorded at distance s belongs at s / m(s)
  const M = 48, at = /** @type {number[]} */ ([]), cor = /** @type {number[][]} */ ([[], [], []]);
  for (let i = 0; i < M; i++) {
    const s = (i / (M - 1)) * REACH, m = lin(kn, dist, s) * (1 + 0.12 * more * s * s);
    at.push(s / m); cor[0].push(m * (lin(kn, red, s) + 1)); cor[1].push(m); cor[2].push(m * (lin(kn, blue, s) + 1));
  }
  // enlarged just enough that the picture's short side still reaches its edge: no empty border
  const short = Math.min(w, h) / Math.hypot(w, h);
  let scale = 0;
  for (let i = 0; i < 200; i++) for (const c of cor) scale = Math.max(scale, lin(at, c, short + ((1 - short) * i) / 199));
  const out = new Float32Array(N * 4);
  for (let j = 0; j < N; j++) {
    const r = (j / (N - 1)) * REACH, f = cor.map((c) => lin(at, c, r / scale) / scale), s = r * f[1];   // s: where green was recorded
    const dark = lin(kn, vig, s) / (1 + 0.5 * light * s * s);
    out.set([f[0], f[1], f[2], 1 / Math.max(0.05, dark)], j * 4);
  }
  return out;
}
