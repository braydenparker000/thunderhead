// @ts-check
// The working copy as JS planes in the engine's worker (engine-worker.js, PHOTOS.md the two-stage decode): the
// engine hands it over in bands, so wasm never holds the whole copy, and a copy already out of wasm is re-expressed
// in a new camera matrix here the way the engine's setMatrix does in place.

/** Planar f16 (`3 × width × height`) and the sink that copies each band or chunk `{ptr, x, y, width, height}` out of wasm.
 * @param {{ memory: WebAssembly.Memory }} wasm @param {number} width @param {number} height */
export function gather(wasm, width, height) {
  const n = width * height;
  const planes = new Uint16Array(3 * n);
  /** @param {{ ptr: number, x: number, y: number, width: number, height: number }} b */
  const sink = (b) => {
    const src = new Uint16Array(wasm.memory.buffer, b.ptr, 3 * b.width * b.height);
    for (let p = 0; p < 3; p++)
      for (let y = 0; y < b.height; y++) {
        const s = (p * b.height + y) * b.width;
        planes.set(src.subarray(s, s + b.width), p * n + (b.y + y) * width + b.x);
      }
  };
  return { planes, sink };
}

/** @type {Float32Array | null} */
let table = null;
/** f16 bits → number, for all 65,536 patterns. */
const halves = () => {
  if (table) return table;
  table = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const e = (h >> 10) & 31, f = h & 1023, s = h & 32768 ? -1 : 1;
    table[h] = s * (e === 0 ? f * 2 ** -24 : e === 31 ? (f ? Number.NaN : Number.POSITIVE_INFINITY) : (1 + f / 1024) * 2 ** (e - 15));
  }
  return table;
};
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
/** number → f16 bits, rounded to nearest even. @param {number} v */
function half(v) {
  f32[0] = v;
  const x = u32[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 255) - 112;
  let m = x & 0x7fffff;
  if (e >= 31) return (x & 0x7fffffff) > 0x7f800000 ? s | 0x7e00 : s | 0x7c00;
  if (e <= 0) {
    if (e < -10) return s;
    m = (m | 0x800000) >> (1 - e);
    return s | ((m + 0xfff + ((m >> 13) & 1)) >> 13);
  }
  return s | ((e << 10) + ((m + 0xfff + ((m >> 13) & 1)) >> 13));
}

/** Each pixel `p` of the planes becomes `k · p` (`k` 3×3, rows). @param {Uint16Array} planes @param {number[][]} k */
export function remap(planes, k) {
  const n = planes.length / 3;
  const [a, b, c] = k;
  const F16 = /** @type {any} */ (globalThis).Float16Array;
  if (F16) {
    const v = new F16(planes.buffer, planes.byteOffset, planes.length);
    for (let i = 0; i < n; i++) {
      const r = v[i], g = v[n + i], bl = v[2 * n + i];
      v[i] = a[0] * r + a[1] * g + a[2] * bl;
      v[n + i] = b[0] * r + b[1] * g + b[2] * bl;
      v[2 * n + i] = c[0] * r + c[1] * g + c[2] * bl;
    }
    return;
  }
  const t = halves();
  for (let i = 0; i < n; i++) {
    const r = t[planes[i]], g = t[planes[n + i]], bl = t[planes[2 * n + i]];
    planes[i] = half(a[0] * r + a[1] * g + a[2] * bl);
    planes[n + i] = half(b[0] * r + b[1] * g + b[2] * bl);
    planes[2 * n + i] = half(c[0] * r + c[1] * g + c[2] * bl);
  }
}
