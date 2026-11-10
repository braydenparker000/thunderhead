// @ts-check
// Export: the whole photo developed from the sensor's own pixels, a band at a time (full.js), brought to the
// size asked for by averaging in linear light, and handed to a file's writer (files.js) as it comes.

const BAND = 256;   // sensor rows a step: as much as a screenful at 100 %
const decode = (/** @type {number} */ s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
const encode = (/** @type {number} */ v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
// A half float's bits to its value held to 0..1: as 16 bits (SAME), and as light (LIGHT). ENC turns light back
// into 16 bits of sRGB, looked up by its square root, which spreads the dark end out.
const SAME = new Uint16Array(65536), LIGHT = new Float32Array(65536), ENC = new Uint16Array(65536);
for (let i = 0; i < 65536; i++) {
  const e = (i >> 10) & 31, m = i & 1023, x = i & 32768 ? 0 : e === 0 ? m * 2 ** -24 : e === 31 ? (m ? 0 : 1) : Math.min(1, (1 + m / 1024) * 2 ** (e - 15));
  SAME[i] = Math.round(x * 65535); LIGHT[i] = decode(x); ENC[i] = Math.round(encode((i / 65535) ** 2) * 65535);
}

/** Takes bands of sw-wide half-float pixels and gives the writer the photo at ow × oh.
 * @param {number} sw @param {number} sh @param {number} ow @param {number} oh @param {import('./files.js').Writer} out */
function reducer(sw, sh, ow, oh, out) {
  if (sw === ow && sh === oh) return async (/** @type {Uint16Array} */ half, /** @type {number} */ n) => {
    const px = new Uint16Array(n * sw * 3);
    for (let i = 0, o = 0; o < px.length; i += 4, o += 3) { px[o] = SAME[half[i]]; px[o + 1] = SAME[half[i + 1]]; px[o + 2] = SAME[half[i + 2]]; }
    await out.rows(px, n);
  };
  // each sensor pixel's light goes to the output pixel it falls in, split with the next where it straddles two
  const rx = sw / ow, ry = sh / oh, norm = 1 / (rx * ry), line = ow * 3, to = new Uint32Array(sw), share = new Float32Array(sw);
  for (let x = 0; x < sw; x++) { const o = Math.min(ow - 1, Math.floor(x / rx)); to[x] = o * 3; share[x] = o + 1 < ow ? Math.max(0, Math.min(1, (o + 1) * rx - x)) : 1; }
  let acc = new Float32Array(line), next = new Float32Array(line), row = 0, y = 0;   // the output row being gathered, and the one after
  const one = new Float32Array(line + 3);
  return async (/** @type {Uint16Array} */ half, /** @type {number} */ n) => {
    const px = new Uint16Array((Math.ceil(n / ry) + 2) * line);
    let made = 0;
    const emit = () => { for (let k = 0, o = made++ * line; k < line; k++) px[o + k] = ENC[Math.min(65535, Math.round(Math.sqrt(acc[k] * norm) * 65535))]; [acc, next] = [next, acc]; next.fill(0); row++; };
    for (let r = 0; r < n; r++, y++) {
      one.fill(0);
      for (let x = 0, i = r * sw * 4; x < sw; x++, i += 4) {
        const o = to[x], a = share[x], R = LIGHT[half[i]], G = LIGHT[half[i + 1]], B = LIGHT[half[i + 2]];
        one[o] += R * a; one[o + 1] += G * a; one[o + 2] += B * a;
        if (a < 1) { one[o + 3] += R * (1 - a); one[o + 4] += G * (1 - a); one[o + 5] += B * (1 - a); }
      }
      const o = Math.min(oh - 1, Math.floor(y / ry)), a = o + 1 < oh ? Math.max(0, Math.min(1, (o + 1) * ry - y)) : 1;
      while (row < o) emit();
      for (let k = 0; k < line; k++) { acc[k] += one[k] * a; next[k] += one[k] * (1 - a); }
    }
    if (y === sh) emit();
    if (made) await out.rows(px, made);
  };
}

/** Develops the photo as it now looks on screen, at `long` pixels on its long edge (no larger than the sensor's).
 * @param {NonNullable<Awaited<ReturnType<typeof import('./full.js').full>>>} big the photo's sensor pixels
 * @param {number} long @param {(w: number, h: number) => import('./files.js').Writer} open the file to write, given its size
 * @param {(done: number) => void} [progress] 0 to 1 */
export async function develop(big, long, open, progress) {
  const sw = big.width, sh = big.height, f = Math.min(1, long / Math.max(sw, sh)), ow = Math.max(1, Math.round(sw * f)), oh = Math.max(1, Math.round(sh * f));
  const v = await big.view(sw, BAND, null, false, true);
  try {
    const out = open(ow, oh), push = reducer(sw, sh, ow, oh, out);
    for (let y = 0; y < sh; y += BAND) {
      const n = Math.min(BAND, sh - y), at = await v.region(0, y, sw, n), half = await v.halves();   // a last band under 8 rows is drawn from higher up
      await push(half.subarray((y - at.Y) * sw * 4), n);
      progress?.((y + n) / sh);
    }
    return { blob: await out.done(), width: ow, height: oh };
  } finally { v.dispose(); }
}
