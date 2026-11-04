// @ts-check
// A baseline JPEG encoder fed a band of rows at a time (PHOTOS.md, Export), so an export never holds
// more than one band of pixels: ITU T.81 sequential DCT with the example tables of its Annex K (the
// quantisation scaled by quality the usual way), the float AAN transform, 4:2:0 chroma below quality
// 90 and 4:4:4 from there, JFIF (sRGB) with any APP1 segments given (the XMP). Ours, no dependency
// (decisions.md, 2026-11-04). Plain JS, so it runs in the export worker and under Node's tests.

export const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const LUMA_Q = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const CHROMA_Q = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, ...Array(38).fill(99)];
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
export const TABLES = {
  dcL: { bits: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], vals: DC_VALS },
  dcC: { bits: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], vals: DC_VALS },
  acL: { bits: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d], vals: [0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa] },
  acC: { bits: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77], vals: [0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa] },
};
const AAN = [1, 1.387039845, 1.306562965, 1.175875602, 1, 0.785694958, 0.5411961, 0.275899379];

/** Annex C: each symbol's code and length. @param {{ bits: number[], vals: number[] }} t */
function huff(t) {
  const code = new Uint16Array(256), size = new Uint8Array(256);
  let c = 0, k = 0;
  for (let l = 1; l <= 16; l++) {
    for (let i = 0; i < t.bits[l - 1]; i++) { code[t.vals[k]] = c++; size[t.vals[k++]] = l; }
    c <<= 1;
  }
  return { code, size };
}

/** The quality's table (IJG scaling), natural order. @param {number[]} base @param {number} q */
export const scaled = (base, q) => base.map((b) => Math.min(255, Math.max(1, Math.floor((b * (q < 50 ? 5000 / q : 200 - 2 * q) + 50) / 100))));

/** Bytes, growing, with JPEG's 0xFF stuffing in the entropy data. */
function writer() {
  let buf = new Uint8Array(1 << 16), n = 0, acc = 0, bits = 0;
  const byte = (/** @type {number} */ b) => { if (n === buf.length) { const g = new Uint8Array(buf.length * 2); g.set(buf); buf = g; } buf[n++] = b; };
  return {
    byte,
    bytes(/** @type {ArrayLike<number>} */ a) { for (let i = 0; i < a.length; i++) byte(a[i]); },
    u16(/** @type {number} */ v) { byte(v >> 8); byte(v & 255); },
    put(/** @type {number} */ code, /** @type {number} */ len) {
      acc = (acc << len) | code; bits += len;
      while (bits >= 8) { const b = (acc >>> (bits - 8)) & 255; byte(b); if (b === 255) byte(0); bits -= 8; }
      acc &= (1 << bits) - 1;
    },
    pad() { if (bits) this.put((1 << (8 - bits)) - 1, 8 - bits); },
    take() { const out = buf.slice(0, n); n = 0; return out; },
  };
}

/**
 * @param {{ width: number, height: number, quality: number, segments?: Uint8Array[] }} o segments: APP1 payloads
 * @returns {{ head: () => Uint8Array, rows: (rgba: Uint8Array, n: number) => Uint8Array, finish: () => Uint8Array }}
 */
export function jpegEncoder(o) {
  const W = o.width, H = o.height, q = Math.min(100, Math.max(1, Math.round(o.quality)));
  const sub = q < 90 ? 2 : 1;
  const qt = [scaled(LUMA_Q, q), scaled(CHROMA_Q, q)];
  const fd = qt.map((t) => Float32Array.from(t, (v, i) => 1 / (v * AAN[i >> 3] * AAN[i & 7] * 8)));
  const dcT = [huff(TABLES.dcL), huff(TABLES.dcC)], acT = [huff(TABLES.acL), huff(TABLES.acC)];
  const w = writer();
  w.bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  for (const s of o.segments ?? []) { w.bytes([0xff, 0xe1]); w.u16(s.length + 2); w.bytes(s); }
  qt.forEach((t, i) => { w.bytes([0xff, 0xdb]); w.u16(67); w.byte(i); for (let k = 0; k < 64; k++) w.byte(t[ZIGZAG[k]]); });
  w.bytes([0xff, 0xc0]); w.u16(17); w.byte(8); w.u16(H); w.u16(W); w.byte(3);
  w.bytes([1, (sub << 4) | sub, 0, 2, 0x11, 1, 3, 0x11, 1]);
  [[0x00, TABLES.dcL], [0x10, TABLES.acL], [0x01, TABLES.dcC], [0x11, TABLES.acC]].forEach(([id, t]) => {
    const tt = /** @type {{ bits: number[], vals: number[] }} */ (t);
    w.bytes([0xff, 0xc4]); w.u16(19 + tt.vals.length); w.byte(/** @type {number} */ (id)); w.bytes(tt.bits); w.bytes(tt.vals);
  });
  w.bytes([0xff, 0xda]); w.u16(12); w.bytes([3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);
  const dc = [0, 0, 0], blk = new Float32Array(64), Y = new Float32Array(64 * sub * sub), Cb = new Float32Array(64), Cr = new Float32Array(64);

  /** @param {Float32Array} d @param {number} c the component */
  const block = (d, c) => {
    for (let i = 0; i < 64; i += 8) fdct(d, i, 1);
    for (let i = 0; i < 8; i++) fdct(d, i, 8);
    const t = c ? 1 : 0, f = fd[t], dt = dcT[t], at = acT[t];
    const v0 = Math.round(d[0] * f[0]), diff = v0 - dc[c];
    dc[c] = v0;
    emit(dt, 0, diff);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      const z = ZIGZAG[k], v = Math.round(d[z] * f[z]);
      if (v === 0) { run++; continue; }
      while (run > 15) { w.put(at.code[0xf0], at.size[0xf0]); run -= 16; }
      emit(at, run, v);
      run = 0;
    }
    if (run) w.put(at.code[0], at.size[0]);
  };
  /** @param {{ code: Uint16Array, size: Uint8Array }} t @param {number} run @param {number} v */
  const emit = (t, run, v) => {
    const a = Math.abs(v), cat = a ? 32 - Math.clz32(a) : 0, sym = (run << 4) | cat;
    w.put(t.code[sym], t.size[sym]);
    if (cat) w.put(v < 0 ? v + (1 << cat) - 1 : v, cat);
  };
  return {
    head: () => w.take(),
    rows(rgba, n) {
      const mh = 8 * sub;
      for (let by = 0; by < n; by += mh) {
        for (let bx = 0; bx < W; bx += mh) {
          Cb.fill(0); Cr.fill(0);
          for (let y = 0; y < mh; y++) {
            const row = Math.min(n - 1, by + y) * W;
            for (let x = 0; x < mh; x++) {
              const p = (row + Math.min(W - 1, bx + x)) * 4, r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
              Y[((y >> 3) * sub + (x >> 3)) * 64 + (y & 7) * 8 + (x & 7)] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
              const ci = ((y / sub) | 0) * 8 + ((x / sub) | 0), k = 1 / (sub * sub);
              Cb[ci] += (-0.168736 * r - 0.331264 * g + 0.5 * b) * k;
              Cr[ci] += (0.5 * r - 0.418688 * g - 0.081312 * b) * k;
            }
          }
          for (let i = 0; i < sub * sub; i++) { blk.set(Y.subarray(i * 64, i * 64 + 64)); block(blk, 0); }
          block(Cb, 1);
          block(Cr, 2);
        }
      }
      return w.take();
    },
    finish() { w.pad(); w.bytes([0xff, 0xd9]); return w.take(); },
  };
}

/** The float AAN forward DCT of eight values `d[i + k·s]`, in place (libjpeg's jfdctflt). @param {Float32Array} d @param {number} i @param {number} s */
function fdct(d, i, s) {
  const a = (/** @type {number} */ k) => i + k * s;
  const t0 = d[a(0)] + d[a(7)], t7 = d[a(0)] - d[a(7)], t1 = d[a(1)] + d[a(6)], t6 = d[a(1)] - d[a(6)];
  const t2 = d[a(2)] + d[a(5)], t5 = d[a(2)] - d[a(5)], t3 = d[a(3)] + d[a(4)], t4 = d[a(3)] - d[a(4)];
  const t10 = t0 + t3, t13 = t0 - t3, t11 = t1 + t2, t12 = t1 - t2;
  d[a(0)] = t10 + t11; d[a(4)] = t10 - t11;
  const z1 = (t12 + t13) * 0.707106781;
  d[a(2)] = t13 + z1; d[a(6)] = t13 - z1;
  const u10 = t4 + t5, u11 = t5 + t6, u12 = t6 + t7;
  const z5 = (u10 - u12) * 0.382683433, z2 = 0.5411961 * u10 + z5, z4 = 1.306562965 * u12 + z5, z3 = u11 * 0.707106781;
  const z11 = t7 + z3, z13 = t7 - z3;
  d[a(5)] = z13 + z2; d[a(3)] = z13 - z2; d[a(1)] = z11 + z4; d[a(7)] = z11 - z4;
}
