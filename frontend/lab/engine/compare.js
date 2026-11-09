// @ts-check
// The colour check (docs/engineering/ENGINE-RESEARCH.md): our render against the camera's own JPEG, which
// every RAF carries in the simulation it was shot with. Both are reduced to a small grid, compared in
// CIELAB: the brightness gap in stops (median luminance) and the colour gap as mean ΔE2000 once that
// brightness gap is taken out.

const lin = (/** @type {number} */ v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
/** sRGB 8-bit to CIELAB (D65). @param {number} r @param {number} g @param {number} b @param {number} k a gain on linear light */
const lab = (r, g, b, k = 1) => {
  const R = lin(r) * k, G = lin(g) * k, B = lin(b) * k;
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (/** @type {number} */ t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};
/** CIEDE2000. @param {number[]} a @param {number[]} b */
function de2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180, C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7))), a1p = a1 * (1 + G), a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (/** @type {number} */ x, /** @type {number} */ y) => { const t = Math.atan2(y, x) / rad; return t < 0 ? t + 360 : t; };
  const h1 = h(a1p, b1), h2 = h(a2p, b2), dL = L2 - L1, dC = C2p - C1p;
  let dh = h2 - h1; if (C1p * C2p === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * rad), Lm = (L1 + L2) / 2, Cmp = (C1p + C2p) / 2;
  let hm = h1 + h2; if (C1p * C2p !== 0) hm = Math.abs(h1 - h2) > 180 ? (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2 : (h1 + h2) / 2;
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2), SC = 1 + 0.045 * Cmp, SH = 1 + 0.015 * Cmp * T;
  const RT = -2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}
/** Draws any image source to a w x h grid and returns its pixels. @param {CanvasImageSource} src @param {number} w @param {number} h */
export function grid(src, w = 96, h = 64) {
  const c = new OffscreenCanvas(w, h), x = /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext('2d'));
  x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, h);
  return x.getImageData(0, 0, w, h).data;
}
/** Ours against the camera's: brightness gap in EV (positive: the camera is brighter) and mean / 90th-percentile ΔE2000 after it.
 * @param {Uint8ClampedArray} ours @param {Uint8ClampedArray} cam */
export function compare(ours, cam) {
  const Y = (/** @type {Uint8ClampedArray} */ p, /** @type {number} */ i) => 0.2126 * lin(p[i]) + 0.7152 * lin(p[i + 1]) + 0.0722 * lin(p[i + 2]);
  const idx = []; for (let i = 0; i < ours.length; i += 4) { const a = Y(ours, i), b = Y(cam, i); if (a > 0.01 && b > 0.01 && a < 0.9 && b < 0.9) idx.push(i); }
  const med = (/** @type {number[]} */ v) => v.sort((a, b) => a - b)[v.length >> 1] || 1;
  const k = med(idx.map((i) => Y(cam, i))) / med(idx.map((i) => Y(ours, i)));
  const d = idx.map((i) => de2000(lab(ours[i], ours[i + 1], ours[i + 2], k), lab(cam[i], cam[i + 1], cam[i + 2]))).sort((a, b) => a - b);
  return { ev: Math.log2(k), mean: d.reduce((s, x) => s + x, 0) / Math.max(1, d.length), p90: d[Math.floor(d.length * 0.9)] || 0, n: d.length };
}
