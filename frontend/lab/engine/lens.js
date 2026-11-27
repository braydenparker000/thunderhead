// @ts-check
// The lens's own corrections. A Fujifilm RAF carries, for the lens and focus it was shot with, how far the
// picture is distorted, how far red and blue are spread from green (fringing) and how much darker it is,
// each at nine distances from the centre. The method is darktable's "embedded metadata" lens correction
// (darktable's lens.cc and exif.cc, GPL-3; Simone Gotti and the darktable authors): the same numbers, the same
// straight lines between them, the same enlargement so that no empty border shows.

/** @typedef {{ knots: number[], dist: number[], red: number[], blue: number[], vig: number[], cKnots?: number[], bKnots?: number[] }} Lens distances
 * as a share of the half diagonal; distortion in per cent; red and blue as shares; brightness in per cent */

/** The lens data in a RAF, or null. Its raw part is a TIFF whose directory 0xf000 holds three tables:
 * 0xf00b distortion, 0xf00f fringing, 0xf010 brightness. Each table is parsed independently with its own knots.
 * @param {ArrayBuffer} buf @returns {Lens | null} */
export function lensOf(buf) {
  try {
    const v = new DataView(buf), base = v.getUint32(100), le = v.getUint16(base) === 0x4949, u16 = (/** @type {number} */ o) => v.getUint16(base + o, le), u32 = (/** @type {number} */ o) => v.getUint32(base + o, le);
    const find = (/** @type {number} */ ifd, /** @type {number} */ tag) => { for (let k = 0, n = u16(ifd); k < n; k++) if (u16(ifd + 2 + k * 12) === tag) return ifd + 2 + k * 12; return -1; };
    const f0 = find(u32(4), 0xf000);
    if (f0 < 0) return null;
    const fuji = u32(f0 + 8);
    const list = (/** @type {number} */ tag) => { const e = find(fuji, tag); if (e < 0 || u16(e + 2) !== 10) return []; const at = u32(e + 8); return Array.from({ length: u32(e + 4) }, (_, i) => v.getInt32(base + at + i * 8, le) / (v.getInt32(base + at + i * 8 + 4, le) || 1)); };
    const d = list(0xf00b), c = list(0xf00f), b = list(0xf010);
    const dPair = d.length === 19 ? [d.slice(1, 10), d.slice(10, 19)] : d.length === 23 ? [d.slice(1, 12), d.slice(12, 23)] : null;
    const cTrip = c.length === 29 ? [c.slice(1, 10), c.slice(10, 19), c.slice(19, 28)] : c.length === 31 ? [[0, ...c.slice(1, 11)], [0, ...c.slice(11, 21)], [0, ...c.slice(21, 31)]] : null;
    const bPair = b.length === 19 ? [b.slice(1, 10), b.slice(10, 19)] : b.length === 23 ? [b.slice(1, 12), b.slice(12, 23)] : null;
    if (!dPair && !cTrip && !bPair) return null;
    const knots = (dPair?.[0] || bPair?.[0] || cTrip?.[0] || [1]);
    return {
      knots,
      dist: dPair ? dPair[1] : knots.map(() => 0),
      cKnots: cTrip ? cTrip[0] : knots,
      red: cTrip ? cTrip[1] : knots.map(() => 0),
      blue: cTrip ? cTrip[2] : knots.map(() => 0),
      bKnots: bPair ? bPair[0] : knots,
      vig: bPair ? bPair[1] : knots.map(() => 100),
    };
  } catch {}
  return null;
}

/** Fritsch-Carlson monotone cubic spline evaluator (C1 smooth without overshoot, flat beyond endpoints).
 * @param {number[]} x @param {number[]} y */
function makeSpline(x, y) {
  const n = x.length;
  if (n < 2) return () => y[0] ?? 0;
  const h = new Float64Array(n - 1), d = new Float64Array(n - 1), m = new Float64Array(n);
  for (let i = 0; i < n - 1; i++) { h[i] = x[i + 1] - x[i] || 1e-9; d[i] = (y[i + 1] - y[i]) / h[i]; }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) * 0.5;
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(d[i]) < 1e-12) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], r2 = a * a + b * b;
    if (r2 > 9) { const t = 3 / Math.sqrt(r2); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (/** @type {number} */ at) => {
    if (at <= x[0]) return y[0];
    if (at >= x[n - 1]) return y[n - 1];
    let i = 0; while (i < n - 2 && at > x[i + 1]) i++;
    const hi = h[i], t = (at - x[i]) / hi, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * hi * m[i] + (-2 * t3 + 3 * t2) * y[i + 1] + (t3 - t2) * hi * m[i + 1];
  };
}
const pad0 = (/** @type {number[]} */ k, /** @type {number[]} */ v, /** @type {number} */ first) => (k[0] > 0 ? [[0, ...k], [first, ...v]] : [k, v]);
export const N = 64, REACH = 1.25;   // the table's entries, and how far past the corner (1) it goes

/** The lens's colour fringing as the demosaic takes it (demosaic.js `lead`): on a sensor `W` × `H`, how much
 * further from the centre red and blue were recorded than green, as a share of the distance, at 16 steps out to
 * `reach` pixels (a little past the corner). The same numbers the table below gives the warp, which then leaves
 * the colours where the demosaic laid them. Null for a lens with none. @param {Lens | null | undefined} lens @param {number} W @param {number} H */
export function fringeOf(lens, W, H) {
  if (!lens || !(lens.red.some(Boolean) || lens.blue.some(Boolean))) return null;
  const ck = lens.cKnots || lens.knots, [kn, red] = pad0(ck, lens.red, 0), [, blue] = pad0(ck, lens.blue, 0);
  const fR = makeSpline(kn, red), fB = makeSpline(kn, blue);
  const MOST = 1.05, table = new Float32Array(64);
  for (let j = 0; j < 16; j++) table.set([fR((j / 15) * MOST), fB((j / 15) * MOST), 0, 0], j * 4);
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
  const [dk, dist] = pad0(L.knots, L.dist.map((d) => d / 100 + 1), 1);
  const ck0 = L.cKnots || L.knots, [ck, red] = pad0(ck0, L.red, 0), [, blue] = pad0(ck0, L.blue, 0);
  const [bk, vig] = pad0(L.bKnots || L.knots, L.vig.map((x) => x / 100), 1);
  const fD = makeSpline(dk, dist), fR = makeSpline(ck, red), fB = makeSpline(ck, blue), fV = makeSpline(bk, vig);
  // from "where it was recorded" to "where it belongs": a point recorded at distance s belongs at s / m(s)
  const M = 48, at = /** @type {number[]} */ ([]), cor = /** @type {number[][]} */ ([[], [], []]);
  for (let i = 0; i < M; i++) {
    const s = (i / (M - 1)) * REACH, m = fD(s) * (1 + 0.12 * more * s * s);
    at.push(s / m); cor[0].push(m * (fR(s) + 1)); cor[1].push(m); cor[2].push(m * (fB(s) + 1));
  }
  const fCor = cor.map((c) => makeSpline(at, c));
  // enlarged just enough that the picture's short side still reaches its edge: no empty border
  const short = Math.min(w, h) / Math.hypot(w, h);
  let scale = 0;
  for (let i = 0; i < 200; i++) for (const fn of fCor) scale = Math.max(scale, fn(short + ((1 - short) * i) / 199));
  const out = new Float32Array(N * 4);
  for (let j = 0; j < N; j++) {
    const r = (j / (N - 1)) * REACH, f = fCor.map((fn) => fn(r / scale) / scale), s = r * f[1];   // s: where green was recorded
    const dark = fV(s) / (1 + 0.5 * light * s * s);
    out.set([f[0], f[1], f[2], 1 / Math.max(0.05, dark)], j * 4);
  }
  return out;
}
