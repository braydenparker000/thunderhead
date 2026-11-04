// @ts-check
// Crop and geometry, and the lens's warp (PHOTOS.md, Crop and geometry; Optics): from a point of the
// output back to the photo it samples, the same steps the develop pass takes on the GPU
// (shaders/geometry-body.js): flip, crop, the straightened frame's zoom, rotation, perspective, then
// lens distortion. The zoom keeps the straightened frame inside the photo: always for rotation, and
// for perspective and distortion too when Constrain crop is on. Crop is the last step before output.
import { val } from './fields.js';

/** @typedef {{ a: number, w: number, h: number, crop: number[], cos: number, sin: number, kv: number, kh: number, kd: number, flip: number[], z: number, rmax: number }} Geo */
const GEO_KEYS = ['CropLeft', 'CropTop', 'CropRight', 'CropBottom', 'CropAngle', 'PerspectiveVertical', 'PerspectiveHorizontal', 'CropConstrainToWarp', 'FlipHorizontal', 'FlipVertical'];
export { GEO_KEYS };

/** @param {import('./fields.js').Recipe} r @param {number} w @param {number} h @returns {Geo} */
export function geometry(r, w, h) {
  const t = (val(r, 'CropAngle') * Math.PI) / 180;
  /** @type {Geo} */
  const g = {
    a: w / h, w, h, crop: [val(r, 'CropLeft'), val(r, 'CropTop'), val(r, 'CropRight'), val(r, 'CropBottom')],
    cos: Math.cos(t), sin: Math.sin(t), kv: (val(r, 'PerspectiveVertical') / 100) * 0.8, kh: (val(r, 'PerspectiveHorizontal') / 100) * 0.8,
    kd: (val(r, 'LensManualDistortionAmount') / 100) * 0.3, flip: [r.FlipHorizontal ? 1 : 0, r.FlipVertical ? 1 : 0], z: 1, rmax: Math.hypot(w / h, 1) / 2,
  };
  const ex = (g.a / 2) * Math.abs(g.cos) + 0.5 * Math.abs(g.sin), ey = (g.a / 2) * Math.abs(g.sin) + 0.5 * Math.abs(g.cos);
  g.z = Math.max((2 * ex) / g.a, 2 * ey);
  if (r.CropConstrainToWarp && (g.kv || g.kh || g.kd)) g.z = fit(g);
  return g;
}

/** A point of the straightened frame (0–1 each way) to the photo's uv. @param {Geo} g @param {number} cx @param {number} cy */
export function toPhoto(g, cx, cy) {
  const gx = ((cx - 0.5) * g.a) / g.z, gy = (cy - 0.5) / g.z;
  let x = g.cos * gx + g.sin * gy, y = -g.sin * gx + g.cos * gy;
  const pw = 1 - g.kv * y - (g.kh * x) / g.a;
  x /= pw; y /= pw;
  const df = 1 + (g.kd * (x * x + y * y)) / (g.rmax * g.rmax);
  return [(x * df) / g.a + 0.5, y * df + 0.5];
}

/** A point of the output (0–1) to the straightened frame: the flip, then the crop. @param {Geo} g @param {number} qx @param {number} qy */
export const toFrame = (g, qx, qy) => {
  const fx = g.flip[0] ? 1 - qx : qx, fy = g.flip[1] ? 1 - qy : qy;
  return [g.crop[0] + fx * (g.crop[2] - g.crop[0]), g.crop[1] + fy * (g.crop[3] - g.crop[1])];
};

/** The output's size in pixels at full size: the crop of the straightened frame. @param {Geo} g */
export const frameSize = (g) => [(g.w * (g.crop[2] - g.crop[0])) / g.z, (g.h * (g.crop[3] - g.crop[1])) / g.z];

/** The smallest zoom that keeps the warped frame's border inside the photo. @param {Geo} g */
function fit(g) {
  let lo = 0.5, hi = 4;
  for (let i = 0; i < 28; i++) {
    const z = (lo + hi) / 2;
    if (inside({ ...g, z })) hi = z; else lo = z;
  }
  return hi;
}

/** @param {Geo} g */
function inside(g) {
  for (let i = 0; i <= 16; i++) {
    const s = i / 16;
    for (const [x, y] of [[s, 0], [s, 1], [0, s], [1, s]]) {
      const [u, v] = toPhoto(g, x, y);
      if (u < -1e-6 || v < -1e-6 || u > 1 + 1e-6 || v > 1 + 1e-6) return false;
    }
  }
  return true;
}

/** The photo's region (uv, padded by `pad` photo pixels) an output rectangle samples.
 * @param {Geo} g @param {number[]} q0 @param {number[]} q1 @param {number} pad */
export function photoBox(g, q0, q1, pad) {
  let u0 = 1, v0 = 1, u1 = 0, v1 = 0;
  for (let i = 0; i <= 8; i++) {
    const s = i / 8;
    for (const [qx, qy] of [[q0[0] + s * (q1[0] - q0[0]), q0[1]], [q0[0] + s * (q1[0] - q0[0]), q1[1]], [q0[0], q0[1] + s * (q1[1] - q0[1])], [q1[0], q0[1] + s * (q1[1] - q0[1])]]) {
      const [cx, cy] = toFrame(g, qx, qy);
      const [u, v] = toPhoto(g, cx, cy);
      u0 = Math.min(u0, u); v0 = Math.min(v0, v); u1 = Math.max(u1, u); v1 = Math.max(v1, v);
    }
  }
  const pu = pad / g.w, pv = pad / g.h;
  return [Math.max(0, u0 - pu), Math.max(0, v0 - pv), Math.min(1, u1 + pu), Math.min(1, v1 + pv)];
}

/** The largest crop of aspect `k` (width over height, in pixels) centred on the frame. @param {Geo} g @param {number} k */
export function aspectCrop(g, k) {
  const fw = g.w / g.z, fh = g.h / g.z;
  const w = Math.min(fw, fh * k), h = w / k;
  const cw = w / fw / 2, ch = h / fh / 2;
  return { CropLeft: 0.5 - cw, CropTop: 0.5 - ch, CropRight: 0.5 + cw, CropBottom: 0.5 + ch };
}
