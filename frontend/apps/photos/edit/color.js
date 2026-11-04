// @ts-check
// White balance on the phone: Temperature and Tint ↔ a white point ↔ channel gains on the working copy,
// which arrives balanced to the file's own as-shot white (the engine's, or D65 for a JPEG). The
// Planckian locus by Kim et al.'s cubic fit, Tint as a shift off it in CIE 1960 uv (1 unit = 1/3000),
// Bradford adaptation, Rec.2020 primaries. The picker and Auto solve for the Temperature and Tint that
// make a colour neutral.

const D65 = [0.3127, 0.329];
/** XYZ → linear Rec.2020. */
const XYZ_2020 = [[1.7166512, -0.3556708, -0.2533663], [-0.6666844, 1.6164812, 0.0157685], [0.0176399, -0.0427706, 0.9421031]];
const BRADFORD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
const BRADFORD_INV = [[0.9869929, -0.1470543, 0.1599627], [0.4323053, 0.5183603, 0.0492912], [-0.0085287, 0.0400428, 0.9684867]];
/** @param {number[][]} m @param {number[]} v */
const mul = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
/** @param {number[]} xy */
const xyz = (xy) => [xy[0] / xy[1], 1, (1 - xy[0] - xy[1]) / xy[1]];

/** The Planckian locus at `t` kelvin, in CIE 1931 xy (Kim et al. 2002, 1667–25000 K; clamped outside). @param {number} t */
export function locus(t) {
  const T = Math.min(25000, Math.max(1667, t));
  const a = 1e9 / T ** 3, b = 1e6 / T ** 2, c = 1e3 / T;
  const x = T <= 4000 ? -0.2661239 * a - 0.234358 * b + 0.8776956 * c + 0.17991 : -3.0258469 * a + 2.1070379 * b + 0.2226347 * c + 0.24039;
  const y = T <= 2222 ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
    : T <= 4000 ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
      : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}

/** @param {number[]} xy */
const uv = (xy) => { const d = -2 * xy[0] + 12 * xy[1] + 3; return [(4 * xy[0]) / d, (6 * xy[1]) / d]; };
/** @param {number[]} p */
const xyOfUv = (p) => { const d = 2 * p[0] - 8 * p[1] + 4; return [(3 * p[0]) / d, (2 * p[1]) / d]; };

/** A white point from Temperature (K) and Tint (+ magenta). @param {number} t @param {number} tint */
export function whiteOf(t, tint) {
  const p = uv(locus(t)), q = uv(locus(t * 1.01));
  const n = [-(q[1] - p[1]), q[0] - p[0]];
  const len = Math.hypot(n[0], n[1]) || 1;
  // the normal pointing below the locus (toward magenta) for a positive tint
  const s = (n[1] > 0 ? -1 : 1) * (tint / 3000);
  return xyOfUv([p[0] + (n[0] / len) * s, p[1] + (n[1] / len) * s]);
}

/** Temperature and Tint of a white point (searched along the locus). @param {number[]} xy */
export function tempTintOf(xy) {
  const target = uv(xy);
  let best = [6500, 0], err = Infinity;
  for (let t = 2000; t <= 25000; t *= 1.01) {
    const w = uv(locus(t));
    const e = Math.hypot(w[0] - target[0], w[1] - target[1]);
    if (e < err) { err = e; best = [t, 0]; }
  }
  for (let tint = -150; tint <= 150; tint += 1) {
    const w = uv(whiteOf(best[0], tint));
    const e = Math.hypot(w[0] - target[0], w[1] - target[1]);
    if (e <= err) { err = e; best = [best[0], tint]; }
  }
  return { temperature: Math.round(best[0] / 50) * 50, tint: Math.round(best[1]) };
}

/** Gains on the working copy (balanced to `asShot`) that make the white `t`/`tint` neutral.
 * @param {number[]} asShot @param {number} t @param {number} tint */
export function gainsFor(asShot, t, tint) {
  const lms0 = mul(BRADFORD, xyz(asShot)), lmsD = mul(BRADFORD, xyz(D65));
  const w = mul(BRADFORD, xyz(whiteOf(t, tint)));
  const adapted = mul(BRADFORD_INV, w.map((v, i) => (v * lmsD[i]) / lms0[i]));
  const rgb = mul(XYZ_2020, adapted);
  return [rgb[1] / rgb[0], 1, rgb[1] / rgb[2]].map((g) => Math.min(8, Math.max(0.125, g)));
}

/** The Temperature and Tint that make linear Rec.2020 `rgb` (as the working copy holds it) neutral.
 * @param {number[]} asShot @param {number[]} rgb */
export function neutralFor(asShot, rgb) {
  const cost = (/** @type {number} */ t, /** @type {number} */ tint) => {
    const g = gainsFor(asShot, t, tint);
    const c = rgb.map((v, i) => Math.log(Math.max(1e-6, v * g[i])));
    return (c[0] - c[1]) ** 2 + (c[2] - c[1]) ** 2;
  };
  let best = { t: 5500, tint: 0, e: Infinity };
  for (let t = 2000; t <= 50000; t *= 1.04) for (let tint = -150; tint <= 150; tint += 10) {
    const e = cost(t, tint);
    if (e < best.e) best = { t, tint, e };
  }
  for (const [dt, dn] of [[1.01, 2], [1.002, 0.5]]) {
    const c = { ...best };
    for (let k = -8; k <= 8; k++) for (let j = -8; j <= 8; j++) {
      const t = c.t * dt ** k, tint = Math.min(150, Math.max(-150, c.tint + j * dn));
      const e = cost(t, tint);
      if (e < best.e) best = { t, tint, e };
    }
  }
  return { temperature: Math.round(Math.min(50000, Math.max(2000, best.t)) / 50) * 50, tint: Math.round(best.tint) };
}

/** sRGB-encoded 0–1 → linear. @param {number} v */
export const linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
/** Linear sRGB → linear Rec.2020 (for a picked display colour). @param {number[]} c */
export const srgbTo2020 = (c) => mul([[0.6274039, 0.3292830, 0.0433131], [0.0690973, 0.9195404, 0.0113623], [0.0163914, 0.0880133, 0.8955953]], c);
/** Linear Rec.2020 → linear sRGB, row by row (the shader's output matrix). */
export const REC2020_TO_SRGB = [[1.6604910, -0.5876411, -0.0728499], [-0.1245505, 1.1328999, -0.0083494], [-0.0181508, -0.1005789, 1.1187297]];
