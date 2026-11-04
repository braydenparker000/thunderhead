// @ts-check
// The histogram (two fingers on the photo) and Auto's start, both from a small render of the photo
// read back from the GPU (256 px wide): red, green and blue drawn over each other, luminance behind.
// Auto sets Exposure from the photo's mean log brightness and Contrast from its spread, as a start.
import { linear } from './color.js';

export const BINS = 64;

/** @param {Uint8Array} px RGBA @returns {{ r: number[], g: number[], b: number[], l: number[] }} */
export function histogram(px) {
  const h = { r: Array(BINS).fill(0), g: Array(BINS).fill(0), b: Array(BINS).fill(0), l: Array(BINS).fill(0) };
  const k = BINS / 256;
  for (let i = 0; i < px.length; i += 4) {
    h.r[(px[i] * k) | 0]++;
    h.g[(px[i + 1] * k) | 0]++;
    h.b[(px[i + 2] * k) | 0]++;
    h.l[((0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) * k) | 0]++;
  }
  return h;
}

/** @param {HTMLCanvasElement} c @param {ReturnType<typeof histogram>} h */
export function drawHistogram(c, h) {
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const { width: w, height: ht } = c;
  g.clearRect(0, 0, w, ht);
  const max = Math.max(1, ...h.l, ...h.r, ...h.g, ...h.b);
  const line = (/** @type {number[]} */ bins, /** @type {string} */ fill) => {
    g.beginPath();
    g.moveTo(0, ht);
    bins.forEach((v, i) => g.lineTo((i / (BINS - 1)) * w, ht - (Math.sqrt(v / max) * ht * 0.95)));
    g.lineTo(w, ht);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };
  g.globalCompositeOperation = 'source-over';
  line(h.l, 'rgba(255,255,255,0.22)');
  g.globalCompositeOperation = 'lighter';
  line(h.r, 'rgba(230,60,60,0.55)');
  line(h.g, 'rgba(60,200,90,0.55)');
  line(h.b, 'rgba(70,110,240,0.55)');
}

/** Exposure and Contrast to start from, read from a render with neither. @param {Uint8Array} px */
export function autoStart(px) {
  const ls = [];
  let sum = 0;
  for (let i = 0; i < px.length; i += 16) {
    const y = 0.2126 * linear(px[i] / 255) + 0.7152 * linear(px[i + 1] / 255) + 0.0722 * linear(px[i + 2] / 255);
    ls.push(y);
    sum += Math.log2(Math.max(y, 1 / 4096));
  }
  if (!ls.length) return { Exposure2012: 0, Contrast2012: 0 };
  ls.sort((a, b) => a - b);
  const mean = sum / ls.length;
  const exposure = Math.max(-3, Math.min(3, -2.6 - mean));
  const enc = (/** @type {number} */ v) => v ** (1 / 2.2);
  const spread = enc(ls[Math.floor(ls.length * 0.97)]) - enc(ls[Math.floor(ls.length * 0.03)]);
  const contrast = Math.max(-30, Math.min(40, (0.78 - spread) * 90));
  return { Exposure2012: Math.round(exposure * 20) / 20, Contrast2012: Math.round(contrast) };
}

/** The average colour around (u, v) of the readback, as display RGB 0–1. @param {Uint8Array} px @param {number} w @param {number} h @param {number} u @param {number} v */
export function colourAt(px, w, h, u, v) {
  const x0 = Math.round(u * (w - 1)), y0 = Math.round(v * (h - 1));
  const c = [0, 0, 0];
  let n = 0;
  for (let y = Math.max(0, y0 - 1); y <= Math.min(h - 1, y0 + 1); y++)
    for (let x = Math.max(0, x0 - 1); x <= Math.min(w - 1, x0 + 1); x++) {
      const i = (y * w + x) * 4;
      c[0] += px[i] / 255; c[1] += px[i + 1] / 255; c[2] += px[i + 2] / 255;
      n++;
    }
  return c.map((x) => x / Math.max(1, n));
}

/** The average colour of the whole readback (Auto white balance's grey world), leaving out clipped and dark pixels. @param {Uint8Array} px */
export function greyWorld(px) {
  const c = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    const m = Math.max(px[i], px[i + 1], px[i + 2]);
    if (m > 250 || m < 12) continue;
    c[0] += linear(px[i] / 255); c[1] += linear(px[i + 1] / 255); c[2] += linear(px[i + 2] / 255);
    n++;
  }
  return n ? c.map((x) => x / n) : [1, 1, 1];
}
