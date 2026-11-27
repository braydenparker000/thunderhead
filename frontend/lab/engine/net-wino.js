// @ts-check
// Strip-sliced HWC4 + coalesced SoA 2x2 zero-spill Winograd F(2x2, 3x3) + zero-array low-register head for Starfish v0.2.0.
// Every trunk layer of v0.2.0 (01..11) is a 3x3 conv at 1/3 resolution (352x352 for a 1056x1056 window), with channel
// counts 15->64->64(x6)->128->128(x2)->27. Using SoA V/M [16, c4, nTiles] with workgroup_size(16, 4, 1) gives 100%
// coalesced warp reads/writes, 100% uniform L1 weight broadcasts, 0% wasted threads on 64/128-ch layers, and ~38 live
// 32-bit registers (strictly under Mali Valhall's 64-register spill cap) while preserving full f32 accumulation precision.
// Strip-slicing V/M to STRIP_TILES=4 keeps each Winograd slice to 180 KB (< Mali-G57's 256 KB L2 cache) and scratch
// VRAM to ~5.76 MB (f16, while bufs[3]/bufs[4] still supply 23 MB spare reuse for deconv).

const STRIP_TILES = 4;    // 4 Winograd tile rows = 8 packed rows = 24 sensor rows per strip (~180 KB/slice in f16)
const yieldUi = () => new Promise((r) => setTimeout(r, 0));

/** IEEE-754 half float -> float32. @param {number} h */
export function unhalf(h) {
  const e = (h >> 10) & 31, m = h & 1023;
  const v = e === 0 ? m * 2 ** -24 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15);
  return h & 32768 ? -v : v;
}

let UNHALF = /** @type {Float32Array | null} */ (null);
const unhalfLut = () => (UNHALF ||= (() => { const t = new Float32Array(65536); for (let h = 0; h < 65536; h++) t[h] = unhalf(h); return t; })());

/** Batch float32 -> IEEE-754 half float (round-to-nearest-even), tight loop without per-element callbacks. @param {Float32Array} src */
function toHalfBuffer(src) {
  const n = src.length, u32 = new Uint32Array(src.buffer, src.byteOffset, n), dst = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const x = u32[i], s = (x >>> 16) & 0x8000;
    let e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
    if (e <= 0) {
      if (e < -10) { dst[i] = s; continue; }
      m = (m | 0x800000) >> (1 - e);
      if ((m & 0x1000) && ((m & 0x2000) || (m & 0xfff))) m += 0x2000;
      dst[i] = s | (m >> 13);
      continue;
    }
    if (e >= 31) { dst[i] = s | 0x7c00; continue; }
    if ((m & 0x1000) && ((m & 0x2000) || (m & 0xfff))) { m += 0x2000; if (m & 0x800000) { m = 0; e++; if (e >= 31) { dst[i] = s | 0x7c00; continue; } } }
    dst[i] = s | (e << 10) | (m >> 13);
  }
  return dst.buffer;
}

/** @typedef {{ cin: number, cout: number, ci4: number, co4: number, uOff: number, bOff: number, preAct: boolean, skip: boolean, outShuf: boolean }} WinoLayer */

/** Checks whether a parsed Starfish graph matches v0.2.0 (S=3 prep, all 3x3 trunk convs, 64-hidden 12_head).
 * @param {import('./neural.js').Graph} g */
export function isV02(g) {
  if (g.ops.length < 4) return false;
  if (!/const TL: u32 = 3u;/.test(g.ops[0].code)) return false;
  if (!/const NV: u32 = 16u;/.test(g.ops[g.ops.length - 1].code)) return false;
  return g.ops.slice(1, -1).every((o) => /const K: u32 = 3u;/.test(o.code));
}

/** Parses v0.2.0 trunk layers and transforms weights.bin into Winograd U[16, co4, ci4, 4, 4] + bias,
 * yielding between layers so main-thread UI gestures never stall during background Starfish preparation.
 * @param {import('./neural.js').Graph} g @param {ArrayBuffer} wBuf */
export async function buildWeights(g, wBuf) {
  const f16 = g.kind === 'f16';
  let raw;
  if (f16) {
    const lut = unhalfLut(), s = new Uint16Array(wBuf), n = s.length;
    raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = lut[s[i]];
    await yieldUi();
  } else raw = new Float32Array(wBuf);
  const getU = (/** @type {string} */ s, /** @type {string} */ k) => {
    const m = new RegExp(`const ${k}: u32 = (\\d+)u;`).exec(s);
    if (!m) throw new Error(`net-wino: missing ${k}`);
    return +m[1];
  };
  /** @type {WinoLayer[]} */
  const layers = [];
  /** @type {Float32Array[]} */
  const chunks = [];
  let totalFloats = 0;
  for (const op of g.ops.slice(1, -1)) {
    const s = op.code;
    const cin = getU(s, 'CIN'), cinp = getU(s, 'CINP'), cout = getU(s, 'COUT');
    const nob = getU(s, 'NOB'), ocb = getU(s, 'OCB'), nv = ocb / 4, pwoff = getU(s, 'PWOFF');
    const preAct = s.includes('return max(v, v * T(0.1))');
    const skip = s.includes('r += A(inp[');
    const outShuf = /const OUT_SHUF: bool = true;/.test(s);
    const ciPad = Math.ceil(cin / 4) * 4, coPad = Math.ceil(cout / 4) * 4;
    const ci4 = ciPad / 4, co4 = coPad / 4;
    const filt = new Float32Array(coPad * ciPad * 9);
    for (let ob = 0; ob < nob; ob++) {
      for (let ci = 0; ci < cinp; ci++) {
        for (let ky = 0; ky < 3; ky++) {
          for (let kx = 0; kx < 3; kx++) {
            for (let h = 0; h < nv; h++) {
              const vi = (pwoff + (ob * cinp + ci) * 9 * nv + (ky * 3 + kx) * nv + h) * 4;
              const oc0 = ob * ocb + h * 4;
              for (let o = 0; o < 4; o++) {
                const oc = oc0 + o;
                if (oc < cout && ci < cin) filt[((oc * ciPad + ci) * 3 + ky) * 3 + kx] = raw[vi + o];
              }
            }
          }
        }
      }
    }
    const bias = new Float32Array(coPad);
    const bBase = (pwoff + nob * cinp * 9 * nv) * 4;
    for (let oc = 0; oc < cout; oc++) bias[oc] = raw[bBase + oc];
    const U = new Float32Array(16 * co4 * ci4 * 16), pStep = co4 * ci4 * 16;
    for (let oc = 0; oc < coPad; oc++) {
      const o4 = oc >> 2, oo = oc & 3;
      for (let ic = 0; ic < ciPad; ic++) {
        const base = (oc * ciPad + ic) * 9;
        const f0 = filt[base], f1 = filt[base + 1], f2 = filt[base + 2];
        const f3 = filt[base + 3], f4 = filt[base + 4], f5 = filt[base + 5];
        const f6 = filt[base + 6], f7 = filt[base + 7], f8 = filt[base + 8];
        const t00 = f0, t01 = f1, t02 = f2;
        const t10 = 0.5 * (f0 + f3 + f6), t11 = 0.5 * (f1 + f4 + f7), t12 = 0.5 * (f2 + f5 + f8);
        const t20 = 0.5 * (f0 - f3 + f6), t21 = 0.5 * (f1 - f4 + f7), t22 = 0.5 * (f2 - f5 + f8);
        const t30 = f6, t31 = f7, t32 = f8;
        const i4 = ic >> 2, ii = ic & 3, dst0 = ((o4 * ci4 + i4) * 4 + ii) * 4 + oo;
        U[dst0] = t00; U[pStep + dst0] = 0.5 * (t00 + t01 + t02); U[2 * pStep + dst0] = 0.5 * (t00 - t01 + t02); U[3 * pStep + dst0] = t02;
        U[4 * pStep + dst0] = t10; U[5 * pStep + dst0] = 0.5 * (t10 + t11 + t12); U[6 * pStep + dst0] = 0.5 * (t10 - t11 + t12); U[7 * pStep + dst0] = t12;
        U[8 * pStep + dst0] = t20; U[9 * pStep + dst0] = 0.5 * (t20 + t21 + t22); U[10 * pStep + dst0] = 0.5 * (t20 - t21 + t22); U[11 * pStep + dst0] = t22;
        U[12 * pStep + dst0] = t30; U[13 * pStep + dst0] = 0.5 * (t30 + t31 + t32); U[14 * pStep + dst0] = 0.5 * (t30 - t31 + t32); U[15 * pStep + dst0] = t32;
      }
    }
    const uOff = totalFloats / 4; chunks.push(U); totalFloats += U.length;
    const bOff = totalFloats / 4; chunks.push(bias); totalFloats += bias.length;
    layers.push({ cin, cout, ci4, co4, uOff, bOff, preAct, skip, outShuf });
    await yieldUi();
  }
  const all = new Float32Array(totalFloats);
  let pos = 0;
  for (const c of chunks) { all.set(c, pos); pos += c.length; }
  const hCode = g.ops[g.ops.length - 1].code;
  const head = { w0: getU(hCode, 'W0'), nw0: getU(hCode, 'NW0'), w1: getU(hCode, 'W1') };
  const data = f16 ? toHalfBuffer(all) : all.buffer;
  return { layers, head, data };
}

/** Compiles the 6 generic Winograd + zero-array head shaders for `g`. @param {GPUDevice} device @param {import('./neural.js').Graph} g @param {{ w0: number, nw0: number, w1: number }} head */
export async function compileWino(device, g, head) {
  const f16 = g.kind === 'f16', hdr = f16 ? 'enable f16;\nalias T = f16;\n' : 'alias T = f32;\n';
  const W = g.win, PW = W / 3;
  const prepCode = /* wgsl */ `${hdr}
struct Cfg { pw: u32, ph: u32, vw: u32, vh: u32 }
@group(0) @binding(0) var<storage, read> mos: array<T>;
@group(0) @binding(1) var<storage, read> sig: array<T>;
@group(0) @binding(2) var<storage, read_write> outp: array<vec4<T>>;
@group(0) @binding(3) var<uniform> cfg: Cfg;
const W: u32 = ${W}u; const PW: u32 = ${PW}u;
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= cfg.pw || g.y >= cfg.ph) { return; }
  let x = g.x; let y = g.y; let src = (3u * y) * W + 3u * x;
  let q = (y % 2u) * 2u + (x % 2u);
  let m9 = ((9u >> q) & 1u) != 0u; let m6 = ((6u >> q) & 1u) != 0u;
  let m00 = mos[src]; let m01 = mos[src + 1u]; let m02 = mos[src + 2u];
  let m10 = mos[src + W]; let m11 = mos[src + W + 1u]; let m12 = mos[src + W + 2u];
  let m20 = mos[src + 2u * W]; let m21 = mos[src + 2u * W + 1u]; let m22 = mos[src + 2u * W + 2u];
  var s = 0.0;
  for (var i = 0u; i < 3u; i++) { for (var j = 0u; j < 3u; j++) { s += f32(sig[src + i * W + j]); } }
  let base = (y * PW + x) * 4u;
  outp[base + 0u] = vec4<T>(m00, m01, select(T(0), m02, m9), select(T(0), m02, m6));
  outp[base + 1u] = vec4<T>(m10, m11, select(T(0), m12, m6), select(T(0), m12, m9));
  outp[base + 2u] = vec4<T>(select(T(0), m20, m6), select(T(0), m20, m9), select(T(0), m21, m9), select(T(0), m21, m6));
  outp[base + 3u] = vec4<T>(m22, select(T(0), T(1), m6), T(s / 9.0), T(0));
}`;

  // Writes V in coalesced SoA layout [p=0..15][c=0..ci4-1][ti=0..nTiles-1]
  const winoInCode = /* wgsl */ `${hdr}
struct Cfg { pw: u32, ph: u32, ci4: u32, preAct: u32, tw: u32, thStrip: u32, ty0: u32, pad: u32 }
@group(0) @binding(0) var<storage, read> inp: array<vec4<T>>;
@group(0) @binding(1) var<storage, read_write> V: array<vec4<T>>;
@group(0) @binding(2) var<uniform> cfg: Cfg;
const PW: u32 = ${PW}u;
fn ld(y: i32, x: i32, c: u32) -> vec4f {
  if (y < 0 || y >= i32(cfg.ph) || x < 0 || x >= i32(cfg.pw)) { return vec4f(0.0); }
  var v = vec4f(inp[(u32(y) * PW + u32(x)) * cfg.ci4 + c]);
  if (cfg.preAct != 0u) { v = max(v, v * 0.1); }
  return v;
}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let tx = g.x; let sy = g.y; let c = g.z;
  if (tx >= cfg.tw || sy >= cfg.thStrip || c >= cfg.ci4) { return; }
  let ty = cfg.ty0 + sy;
  let x0 = i32(tx * 2u) - 1; let y0 = i32(ty * 2u) - 1;
  var t0: array<vec4f, 4>; var t1: array<vec4f, 4>; var t2: array<vec4f, 4>; var t3: array<vec4f, 4>;
  for (var j = 0u; j < 4u; j++) {
    let x = x0 + i32(j);
    let d0 = ld(y0, x, c); let d1 = ld(y0 + 1, x, c); let d2 = ld(y0 + 2, x, c); let d3 = ld(y0 + 3, x, c);
    t0[j] = d0 - d2; t1[j] = d1 + d2; t2[j] = d2 - d1; t3[j] = d1 - d3;
  }
  let nTiles = cfg.tw * cfg.thStrip;
  let cBase = c * nTiles + sy * cfg.tw + tx;
  let pStride = cfg.ci4 * nTiles;
  V[0u * pStride + cBase] = vec4<T>(t0[0] - t0[2]); V[1u * pStride + cBase] = vec4<T>(t0[1] + t0[2]);
  V[2u * pStride + cBase] = vec4<T>(t0[2] - t0[1]); V[3u * pStride + cBase] = vec4<T>(t0[1] - t0[3]);
  V[4u * pStride + cBase] = vec4<T>(t1[0] - t1[2]); V[5u * pStride + cBase] = vec4<T>(t1[1] + t1[2]);
  V[6u * pStride + cBase] = vec4<T>(t1[2] - t1[1]); V[7u * pStride + cBase] = vec4<T>(t1[1] - t1[3]);
  V[8u * pStride + cBase] = vec4<T>(t2[0] - t2[2]); V[9u * pStride + cBase] = vec4<T>(t2[1] + t2[2]);
  V[10u * pStride + cBase] = vec4<T>(t2[2] - t2[1]); V[11u * pStride + cBase] = vec4<T>(t2[1] - t2[3]);
  V[12u * pStride + cBase] = vec4<T>(t3[0] - t3[2]); V[13u * pStride + cBase] = vec4<T>(t3[1] + t3[2]);
  V[14u * pStride + cBase] = vec4<T>(t3[2] - t3[1]); V[15u * pStride + cBase] = vec4<T>(t3[1] - t3[3]);
}`;

  // 2x2 register-blocked GEMM in f32 accumulation (~38 regs: zero spill on Mali Valhall, 100% coalesced, z-sliceable via valid.z0)
  const winoGemmCode = /* wgsl */ `${hdr}
struct Cfg { nTiles: u32, ci4: u32, co4: u32, uOff: u32 }
struct Valid { h: u32, w: u32, z0: u32, pad: u32 }
@group(0) @binding(0) var<storage, read> V: array<vec4<T>>;
@group(0) @binding(1) var<storage, read> U: array<vec4<T>>;
@group(0) @binding(2) var<storage, read_write> M: array<vec4<T>>;
@group(0) @binding(3) var<uniform> cfg: Cfg;
@group(0) @binding(4) var<uniform> valid: Valid;
@compute @workgroup_size(16, 4, 1)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) l: vec3u) {
  let t0 = wg.x * 32u + l.x; let t1 = t0 + 16u;
  let o0 = (wg.y * 4u + l.y) * 2u; let o1 = o0 + 1u;
  let p = wg.z + valid.z0;
  if (t0 >= cfg.nTiles || o0 >= cfg.co4 || p >= 16u) { return; }
  let hasT1 = t1 < cfg.nTiles; let hasO1 = o1 < cfg.co4;
  let t1c = select(t0, t1, hasT1); let o1c = select(o0, o1, hasO1);
  var a00 = vec4f(0.0); var a10 = vec4f(0.0); var a01 = vec4f(0.0); var a11 = vec4f(0.0);
  let vBase = p * cfg.ci4 * cfg.nTiles;
  let uBase0 = cfg.uOff + (p * cfg.co4 + o0) * cfg.ci4 * 4u;
  let uBase1 = cfg.uOff + (p * cfg.co4 + o1c) * cfg.ci4 * 4u;
  for (var i4 = 0u; i4 < cfg.ci4; i4++) {
    let vRow = vBase + i4 * cfg.nTiles;
    let x0 = vec4f(V[vRow + t0]); let x1 = vec4f(V[vRow + t1c]);
    let b0 = uBase0 + i4 * 4u;
    var w = vec4f(U[b0]);      a00 = fma(vec4f(x0.x), w, a00); a10 = fma(vec4f(x1.x), w, a10);
    w = vec4f(U[b0 + 1u]);     a00 = fma(vec4f(x0.y), w, a00); a10 = fma(vec4f(x1.y), w, a10);
    w = vec4f(U[b0 + 2u]);     a00 = fma(vec4f(x0.z), w, a00); a10 = fma(vec4f(x1.z), w, a10);
    w = vec4f(U[b0 + 3u]);     a00 = fma(vec4f(x0.w), w, a00); a10 = fma(vec4f(x1.w), w, a10);
    let b1 = uBase1 + i4 * 4u;
    w = vec4f(U[b1]);          a01 = fma(vec4f(x0.x), w, a01); a11 = fma(vec4f(x1.x), w, a11);
    w = vec4f(U[b1 + 1u]);     a01 = fma(vec4f(x0.y), w, a01); a11 = fma(vec4f(x1.y), w, a11);
    w = vec4f(U[b1 + 2u]);     a01 = fma(vec4f(x0.z), w, a01); a11 = fma(vec4f(x1.z), w, a11);
    w = vec4f(U[b1 + 3u]);     a01 = fma(vec4f(x0.w), w, a01); a11 = fma(vec4f(x1.w), w, a11);
  }
  let mBase = p * cfg.co4 * cfg.nTiles;
  M[mBase + o0 * cfg.nTiles + t0] = vec4<T>(a00);
  if (hasT1) { M[mBase + o0 * cfg.nTiles + t1] = vec4<T>(a10); }
  if (hasO1) {
    M[mBase + o1 * cfg.nTiles + t0] = vec4<T>(a01);
    if (hasT1) { M[mBase + o1 * cfg.nTiles + t1] = vec4<T>(a11); }
  }
}`;

  const winoOutHwc = /* wgsl */ `${hdr}
struct Cfg { pw: u32, ph: u32, co4: u32, bOff: u32, skip: u32, cout: u32, tw: u32, thStrip: u32, ty0: u32, p0: u32, p1: u32, p2: u32 }
@group(0) @binding(0) var<storage, read> M: array<vec4<T>>;
@group(0) @binding(1) var<storage, read> U: array<vec4<T>>;
@group(0) @binding(2) var<storage, read> skipBuf: array<vec4<T>>;
@group(0) @binding(3) var<storage, read_write> outp: array<vec4<T>>;
@group(0) @binding(4) var<uniform> cfg: Cfg;
const PW: u32 = ${PW}u;
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let tx = g.x; let sy = g.y; let o4 = g.z;
  if (tx >= cfg.tw || sy >= cfg.thStrip || o4 >= cfg.co4) { return; }
  let ty = cfg.ty0 + sy; let nTiles = cfg.tw * cfg.thStrip;
  let oBase = o4 * nTiles + sy * cfg.tw + tx; let pStride = cfg.co4 * nTiles;
  var s0: array<vec4f, 4>; var s1: array<vec4f, 4>;
  for (var j = 0u; j < 4u; j++) {
    let m0 = vec4f(M[(0u + j) * pStride + oBase]); let m1 = vec4f(M[(4u + j) * pStride + oBase]);
    let m2 = vec4f(M[(8u + j) * pStride + oBase]); let m3 = vec4f(M[(12u + j) * pStride + oBase]);
    s0[j] = m0 + m1 + m2; s1[j] = m1 - m2 - m3;
  }
  let bias = vec4f(U[cfg.bOff + o4]);
  var y00 = s0[0] + s0[1] + s0[2] + bias; var y01 = s0[1] - s0[2] - s0[3] + bias;
  var y10 = s1[0] + s1[1] + s1[2] + bias; var y11 = s1[1] - s1[2] - s1[3] + bias;
  let x0 = tx * 2u; let y0 = ty * 2u;
  if (cfg.skip != 0u) {
    if (x0 < cfg.pw && y0 < cfg.ph) { y00 += vec4f(skipBuf[(y0 * PW + x0) * cfg.co4 + o4]); }
    if (x0 + 1u < cfg.pw && y0 < cfg.ph) { y01 += vec4f(skipBuf[(y0 * PW + x0 + 1u) * cfg.co4 + o4]); }
    if (x0 < cfg.pw && y0 + 1u < cfg.ph) { y10 += vec4f(skipBuf[((y0 + 1u) * PW + x0) * cfg.co4 + o4]); }
    if (x0 + 1u < cfg.pw && y0 + 1u < cfg.ph) { y11 += vec4f(skipBuf[((y0 + 1u) * PW + x0 + 1u) * cfg.co4 + o4]); }
  }
  if (x0 < cfg.pw && y0 < cfg.ph) { outp[(y0 * PW + x0) * cfg.co4 + o4] = vec4<T>(y00); }
  if (x0 + 1u < cfg.pw && y0 < cfg.ph) { outp[(y0 * PW + x0 + 1u) * cfg.co4 + o4] = vec4<T>(y01); }
  if (x0 < cfg.pw && y0 + 1u < cfg.ph) { outp[((y0 + 1u) * PW + x0) * cfg.co4 + o4] = vec4<T>(y10); }
  if (x0 + 1u < cfg.pw && y0 + 1u < cfg.ph) { outp[((y0 + 1u) * PW + x0 + 1u) * cfg.co4 + o4] = vec4<T>(y11); }
}`;

  const winoOutShuf = /* wgsl */ `${hdr}
struct Cfg { pw: u32, ph: u32, co4: u32, bOff: u32, skip: u32, cout: u32, tw: u32, thStrip: u32, ty0: u32, p0: u32, p1: u32, p2: u32 }
@group(0) @binding(0) var<storage, read> M: array<vec4<T>>;
@group(0) @binding(1) var<storage, read> U: array<vec4<T>>;
@group(0) @binding(2) var<storage, read_write> outChw: array<T>;
@group(0) @binding(3) var<uniform> cfg: Cfg;
const W: u32 = ${W}u;
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let tx = g.x; let sy = g.y; let o4 = g.z;
  if (tx >= cfg.tw || sy >= cfg.thStrip || o4 >= cfg.co4) { return; }
  let ty = cfg.ty0 + sy; let nTiles = cfg.tw * cfg.thStrip;
  let oBase = o4 * nTiles + sy * cfg.tw + tx; let pStride = cfg.co4 * nTiles;
  var s0: array<vec4f, 4>; var s1: array<vec4f, 4>;
  for (var j = 0u; j < 4u; j++) {
    let m0 = vec4f(M[(0u + j) * pStride + oBase]); let m1 = vec4f(M[(4u + j) * pStride + oBase]);
    let m2 = vec4f(M[(8u + j) * pStride + oBase]); let m3 = vec4f(M[(12u + j) * pStride + oBase]);
    s0[j] = m0 + m1 + m2; s1[j] = m1 - m2 - m3;
  }
  let bias = vec4f(U[cfg.bOff + o4]);
  let vals = array<vec4f, 4>(s0[0] + s0[1] + s0[2] + bias, s0[1] - s0[2] - s0[3] + bias, s1[0] + s1[1] + s1[2] + bias, s1[1] - s1[2] - s1[3] + bias);
  let x0 = tx * 2u; let y0 = ty * 2u;
  let xs = array<u32, 4>(x0, x0 + 1u, x0, x0 + 1u); let ys = array<u32, 4>(y0, y0, y0 + 1u, y0 + 1u);
  for (var q = 0u; q < 4u; q++) {
    if (xs[q] >= cfg.pw || ys[q] >= cfg.ph) { continue; }
    for (var k = 0u; k < 4u; k++) {
      let oc = o4 * 4u + k; if (oc >= cfg.cout) { break; }
      let s = oc % 9u; let ch = oc / 9u;
      outChw[(ch * W + 3u * ys[q] + s / 3u) * W + 3u * xs[q] + s % 3u] = T(vals[q][k]);
    }
  }
}`;

  // Zero-array streaming 4-chunk head (~32 live registers: 100% Mali occupancy, 0 spills, full f32 precision)
  const head4Code = /* wgsl */ `${hdr}
struct Valid { h: u32, w: u32, z0: u32, pad: u32 }
@group(0) @binding(0) var<storage, read> up: array<T>;
@group(0) @binding(1) var<storage, read> pw: array<vec4<T>>;
@group(0) @binding(2) var<storage, read> mos: array<T>;
@group(0) @binding(3) var<storage, read> sig: array<T>;
@group(0) @binding(4) var<storage, read_write> outp: array<T>;
@group(0) @binding(5) var<uniform> valid: Valid;
const W: u32 = ${W}u; const P: u32 = 6u; const NV: u32 = 16u;
const W0: u32 = ${head.w0}u; const NW0: u32 = ${head.nw0}u; const W1: u32 = ${head.w1}u;
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) l: vec3u) {
  let bank = wg.z + valid.z0;
  let x = (wg.x * 8u + l.x) * P + bank % P; let y = (wg.y * 8u + l.y) * P + bank / P;
  if (x >= valid.w || y >= valid.h) { return; }
  let plane = W * W; let bBase = W0 + bank * NW0; let rb = vec4f(pw[W1 + 48u]);
  var r0 = rb.x; var r1 = rb.y; var r2 = rb.z;
  for (var ch = 0u; ch < 4u; ch++) {
    let c0 = ch * 4u;
    var h0 = vec4f(pw[bBase + 720u + c0]); var h1 = vec4f(pw[bBase + 720u + c0 + 1u]);
    var h2 = vec4f(pw[bBase + 720u + c0 + 2u]); var h3 = vec4f(pw[bBase + 720u + c0 + 3u]);
    for (var dy = 0u; dy < 3u; dy++) {
      let yy = y + dy - 1u;
      for (var dx = 0u; dx < 3u; dx++) {
        let xx = x + dx - 1u;
        let ok = xx < valid.w && yy < valid.h;
        let idx = select(0u, yy * W + xx, ok); let gn = select(0.0, 1.0, ok);
        let v0 = gn * f32(up[idx]); let v1 = gn * f32(up[plane + idx]); let v2 = gn * f32(up[2u * plane + idx]);
        let v3 = gn * f32(mos[idx]); let v4 = gn * f32(sig[idx]);
        var wi = bBase + (dy * 3u + dx) * 5u * NV + c0;
        h0 = fma(vec4f(v0), vec4f(pw[wi]), h0); h1 = fma(vec4f(v0), vec4f(pw[wi + 1u]), h1); h2 = fma(vec4f(v0), vec4f(pw[wi + 2u]), h2); h3 = fma(vec4f(v0), vec4f(pw[wi + 3u]), h3); wi += NV;
        h0 = fma(vec4f(v1), vec4f(pw[wi]), h0); h1 = fma(vec4f(v1), vec4f(pw[wi + 1u]), h1); h2 = fma(vec4f(v1), vec4f(pw[wi + 2u]), h2); h3 = fma(vec4f(v1), vec4f(pw[wi + 3u]), h3); wi += NV;
        h0 = fma(vec4f(v2), vec4f(pw[wi]), h0); h1 = fma(vec4f(v2), vec4f(pw[wi + 1u]), h1); h2 = fma(vec4f(v2), vec4f(pw[wi + 2u]), h2); h3 = fma(vec4f(v2), vec4f(pw[wi + 3u]), h3); wi += NV;
        h0 = fma(vec4f(v3), vec4f(pw[wi]), h0); h1 = fma(vec4f(v3), vec4f(pw[wi + 1u]), h1); h2 = fma(vec4f(v3), vec4f(pw[wi + 2u]), h2); h3 = fma(vec4f(v3), vec4f(pw[wi + 3u]), h3); wi += NV;
        h0 = fma(vec4f(v4), vec4f(pw[wi]), h0); h1 = fma(vec4f(v4), vec4f(pw[wi + 1u]), h1); h2 = fma(vec4f(v4), vec4f(pw[wi + 2u]), h2); h3 = fma(vec4f(v4), vec4f(pw[wi + 3u]), h3);
      }
    }
    h0 = max(h0, h0 * 0.1); h1 = max(h1, h1 * 0.1); h2 = max(h2, h2 * 0.1); h3 = max(h3, h3 * 0.1);
    r0 += dot(h0, vec4f(pw[W1 + c0])) + dot(h1, vec4f(pw[W1 + c0 + 1u])) + dot(h2, vec4f(pw[W1 + c0 + 2u])) + dot(h3, vec4f(pw[W1 + c0 + 3u]));
    r1 += dot(h0, vec4f(pw[W1 + NV + c0])) + dot(h1, vec4f(pw[W1 + NV + c0 + 1u])) + dot(h2, vec4f(pw[W1 + NV + c0 + 2u])) + dot(h3, vec4f(pw[W1 + NV + c0 + 3u]));
    r2 += dot(h0, vec4f(pw[W1 + 2u * NV + c0])) + dot(h1, vec4f(pw[W1 + 2u * NV + c0 + 1u])) + dot(h2, vec4f(pw[W1 + 2u * NV + c0 + 2u])) + dot(h3, vec4f(pw[W1 + 2u * NV + c0 + 3u]));
  }
  let px = y * W + x; outp[px] = T(r0); outp[plane + px] = T(r1); outp[2u * plane + px] = T(r2);
}`;

  const mk = (/** @type {string} */ code) => device.createComputePipelineAsync({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
  const [prep, wIn, wGemm, wOutHwc, wOutShuf, head4] = await Promise.all([mk(prepCode), mk(winoInCode), mk(winoGemmCode), mk(winoOutHwc), mk(winoOutShuf), mk(head4Code)]);
  return { prep, wIn, wGemm, wOutHwc, wOutShuf, head4 };
}

/** Allocates strip-sliced V/M scratch buffers and returns a per-slot pass-list builder for one window.
 * Reuses `bufs[3]` and `bufs[4]` for HWC4 ping-pong & up (zero duplicate 63 MB buffers!).
 * @param {GPUDevice} device @param {import('./neural.js').Graph} g
 * @param {{ pipes: Awaited<ReturnType<typeof compileWino>>, layers: WinoLayer[], wBuf: GPUBuffer }} wino
 * @param {GPUBuffer[]} bufs */
export function winoRunner(device, g, wino, bufs) {
  const wide = g.kind === 'f16' ? 2 : 4, PW = g.win / 3, TW = PW / 2, maxStrips = Math.ceil((PW / 2) / STRIP_TILES);
  const scratchBytes = 16 * STRIP_TILES * TW * 128 * wide, maxStep = wino.layers.length * maxStrips;
  const bufV = device.createBuffer({ size: scratchBytes, usage: GPUBufferUsage.STORAGE });
  const bufM = device.createBuffer({ size: scratchBytes, usage: GPUBufferUsage.STORAGE });
  const grp = (/** @type {GPUComputePipeline} */ pipe, /** @type {GPUBindGroupEntry[]} */ entries) => device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries });
  /** @type {Map<GPUBuffer, { cPrep: GPUBuffer, cIn: GPUBuffer[], cGm: GPUBuffer[], cOu: GPUBuffer[], bgPrep: GPUBindGroup, bgStep: { bgIn: GPUBindGroup, bgGm: GPUBindGroup, bgOu: GPUBindGroup }[], bgHead: GPUBindGroup }>} */
  const slots = new Map();
  const slotFor = (/** @type {GPUBuffer} */ valid) => {
    let s = slots.get(valid);
    if (s) return s;
    const cPrep = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const cIn = Array.from({ length: maxStep }, () => device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    const cGm = Array.from({ length: maxStep }, () => device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    const cOu = Array.from({ length: maxStep }, () => device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    const bgPrep = grp(wino.pipes.prep, [
      { binding: 0, resource: { buffer: bufs[g.mosaic] } }, { binding: 1, resource: { buffer: bufs[g.sigma] } },
      { binding: 2, resource: { buffer: bufs[3] } }, { binding: 3, resource: { buffer: cPrep } },
    ]);
    const bgStep = /** @type {{ bgIn: GPUBindGroup, bgGm: GPUBindGroup, bgOu: GPUBindGroup }[]} */ ([]);
    let curIn = 3, curOut = 4;
    for (let li = 0; li < wino.layers.length; li++) {
      const shuf = wino.layers[li].outShuf;
      for (let si = 0; si < maxStrips; si++) {
        const idx = li * maxStrips + si;
        bgStep[idx] = {
          bgIn: grp(wino.pipes.wIn, [{ binding: 0, resource: { buffer: bufs[curIn] } }, { binding: 1, resource: { buffer: bufV } }, { binding: 2, resource: { buffer: cIn[idx] } }]),
          bgGm: grp(wino.pipes.wGemm, [{ binding: 0, resource: { buffer: bufV } }, { binding: 1, resource: { buffer: wino.wBuf } }, { binding: 2, resource: { buffer: bufM } }, { binding: 3, resource: { buffer: cGm[idx] } }, { binding: 4, resource: { buffer: valid } }]),
          bgOu: shuf
            ? grp(wino.pipes.wOutShuf, [{ binding: 0, resource: { buffer: bufM } }, { binding: 1, resource: { buffer: wino.wBuf } }, { binding: 2, resource: { buffer: bufs[4] } }, { binding: 3, resource: { buffer: cOu[idx] } }])
            : grp(wino.pipes.wOutHwc, [{ binding: 0, resource: { buffer: bufM } }, { binding: 1, resource: { buffer: wino.wBuf } }, { binding: 2, resource: { buffer: bufs[curIn] } }, { binding: 3, resource: { buffer: bufs[curOut] } }, { binding: 4, resource: { buffer: cOu[idx] } }]),
        };
      }
      [curIn, curOut] = [curOut, curIn];
    }
    const bgHead = grp(wino.pipes.head4, [
      { binding: 0, resource: { buffer: bufs[4] } }, { binding: 1, resource: { buffer: bufs[0] } },
      { binding: 2, resource: { buffer: bufs[g.mosaic] } }, { binding: 3, resource: { buffer: bufs[g.sigma] } },
      { binding: 4, resource: { buffer: bufs[g.output] } }, { binding: 5, resource: { buffer: valid } },
    ]);
    s = { cPrep, cIn, cGm, cOu, bgPrep, bgStep, bgHead };
    slots.set(valid, s);
    return s;
  };
  /** @param {GPUBuffer} valid @param {number} vw @param {number} vh */
  const passes = (valid, vw, vh) => {
    const s = slotFor(valid);
    const pw = Math.min(PW, Math.ceil(vw / 3)), ph = Math.min(PW, Math.ceil(vh / 3));
    const tw = Math.ceil(pw / 2), th = Math.ceil(ph / 2), strips = Math.ceil(th / STRIP_TILES);
    device.queue.writeBuffer(s.cPrep, 0, new Uint32Array([pw, ph, vw, vh]));
    /** @type {[GPUComputePipeline, GPUBindGroup, number, number, number, boolean, number][]} */
    const out = [[wino.pipes.prep, s.bgPrep, Math.ceil(pw / 8), Math.ceil(ph / 8), 1, false, 1]];
    for (let li = 0; li < wino.layers.length; li++) {
      const L = wino.layers[li], outPipe = L.outShuf ? wino.pipes.wOutShuf : wino.pipes.wOutHwc;
      for (let si = 0; si < strips; si++) {
        const ty0 = si * STRIP_TILES, thStrip = Math.min(STRIP_TILES, th - ty0), nTiles = tw * thStrip, idx = li * maxStrips + si;
        device.queue.writeBuffer(s.cIn[idx], 0, new Uint32Array([pw, ph, L.ci4, L.preAct ? 1 : 0, tw, thStrip, ty0, 0]));
        device.queue.writeBuffer(s.cGm[idx], 0, new Uint32Array([nTiles, L.ci4, L.co4, L.uOff]));
        device.queue.writeBuffer(s.cOu[idx], 0, new Uint32Array([pw, ph, L.co4, L.bOff, L.skip ? 1 : 0, L.cout, tw, thStrip, ty0, 0, 0, 0]));
        const b = s.bgStep[idx];
        out.push(
          [wino.pipes.wIn, b.bgIn, Math.ceil(tw / 8), Math.ceil(thStrip / 8), L.ci4, false, 2 + li],
          [wino.pipes.wGemm, b.bgGm, Math.ceil(nTiles / 32), Math.ceil(Math.ceil(L.co4 / 2) / 4), 16, true, 2 + li],
          [outPipe, b.bgOu, Math.ceil(tw / 8), Math.ceil(thStrip / 8), L.co4, false, 2 + li],
        );
      }
    }
    out.push([wino.pipes.head4, s.bgHead, Math.ceil(vw / 48), Math.ceil(vh / 48), 36, true, 13]);
    return out;
  };
  return {
    passes,
    spare: [bufV, bufM],
    destroy: () => {
      bufV.destroy(); bufM.destroy();
      for (const s of slots.values()) { s.cPrep.destroy(); for (const b of [...s.cIn, ...s.cGm, ...s.cOu]) b.destroy(); }
      slots.clear();
    },
  };
}
