// @ts-check
// Dehaze's "air light": the colour of the haze itself (He, Sun and Tang; darktable's haze removal). Haze lifts
// every colour of a far-off thing towards it, so the pixels whose darkest colour is brightest are the haziest,
// and their mean colour is the air's.

/** @param {{ proxy: Uint16Array, width: number, height: number }} img the editing copy
 * @param {number[]} m camera RGB to the working colour, white balance included (3 × 3, by rows) @returns {number[]} */
export function airOf(img, m) {
  const { proxy: d, width: w, height: h } = img, STEP = 4, n = Math.ceil(w / STEP) * Math.ceil(h / STEP), dark = new Float32Array(n), col = new Float32Array(n * 3);
  let k = 0, top = 0;
  for (let y = 0; y < h; y += STEP) for (let x = 0; x < w; x += STEP, k++) {
    const i = (y * w + x) * 4, r = d[i] / 65535, g = d[i + 1] / 65535, b = d[i + 2] / 65535;
    const c = [0, 3, 6].map((o) => Math.max(0, m[o] * r + m[o + 1] * g + m[o + 2] * b));
    col.set(c, k * 3); dark[k] = Math.min(c[0], c[1], c[2]); top = Math.max(top, dark[k]);
  }
  // the haziest thousandth: found through a count of how many pixels are how dark
  const BINS = 1024, count = new Uint32Array(BINS), bin = (/** @type {number} */ v) => Math.min(BINS - 1, Math.floor((v / (top || 1)) * BINS));
  for (let j = 0; j < k; j++) count[bin(dark[j])]++;
  let from = BINS - 1;
  for (let seen = 0; from > 0 && seen + count[from] < k / 1000; from--) seen += count[from];
  const sum = [0, 0, 0]; let got = 0;
  for (let j = 0; j < k; j++) if (bin(dark[j]) >= from) { sum[0] += col[j * 3]; sum[1] += col[j * 3 + 1]; sum[2] += col[j * 3 + 2]; got++; }
  // half-way to grey: the air is rarely as coloured as the sky it is read from, and taking a tint out of the
  // whole picture shows more than leaving a little haze in
  const a = sum.map((s) => s / (got || 1)), grey = 0.288 * a[0] + 0.712 * a[1];
  return a.map((v) => Math.max(1e-3, (v + grey) / 2));
}
