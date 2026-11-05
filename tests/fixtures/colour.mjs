// Colour measures for the Photos tests (PHOTOS.md, the colour pipeline): CIE76 ΔE between two RGBA
// renders of the same size (sRGB, D65), and the camera's own JPEG inside a RAF (its header points at it).

const lin = (/** @type {number} */ v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const f = (/** @type {number} */ t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);

/** CIE L*a*b* (D65) of one sRGB pixel, 0–255. @param {number} r @param {number} g @param {number} b */
export function lab(r, g, b) {
  const R = lin(r / 255), G = lin(g / 255), B = lin(b / 255);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), y = f(0.2126 * R + 0.7152 * G + 0.0722 * B), z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Mean CIE76 ΔE of `a` against `b` (RGBA bytes, the same size), with the mean L* offset and the chroma
 * ratio, so a number that moves says whether brightness or colour moved it.
 * @param {ArrayLike<number>} a @param {ArrayLike<number>} b */
export function deltaE(a, b) {
  let de = 0, dl = 0, ca = 0, cb = 0;
  const n = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const p = lab(a[i], a[i + 1], a[i + 2]), q = lab(b[i], b[i + 1], b[i + 2]);
    de += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    dl += p[0] - q[0];
    ca += Math.hypot(p[1], p[2]);
    cb += Math.hypot(q[1], q[2]);
  }
  return { mean: de / n, dL: dl / n, chroma: ca / Math.max(cb, 1e-9) };
}

/** The embedded JPEG of a RAF: offset and length are big-endian at bytes 84 and 88. @param {Buffer} raf */
export const rafJpeg = (raf) => raf.subarray(raf.readUInt32BE(84), raf.readUInt32BE(84) + raf.readUInt32BE(88));
