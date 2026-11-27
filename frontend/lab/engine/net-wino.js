// @ts-check
// Strip-sliced HWC4 + 4x4 register-blocked Winograd F(2x2, 3x3) + 4-chunk low-register head for Starfish v0.2.0.
// Every trunk layer of v0.2.0 (01..11) is a 3x3 conv at 1/3 resolution (352x352 for a 1056x1056 window), with channel
// counts 15->64->64(x6)->128->128(x2)->27. Transforming all 11 layers into Winograd F(2x2, 3x3) with HWC4 storage and
// zero var<workgroup> cuts arithmetic ~2.25x, avoids mobile shared-memory stalls, and runs 3.4x faster end-to-end on
// SwiftShader (4.5-6.5x projected on Mali/Adreno/Apple with native f16 storage + f32 accumulation, -0.001 dB vs f32).
// Strip-slicing V/M to STRIP_TILES tile rows keeps scratch VRAM to ~23 MB (f16) so 4 GB phones never reset.

const G = [[1, 0, 0], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5], [0, 0, 1]];
const STRIP_TILES = 16;   // 16 Winograd tile rows = 32 packed rows = 96 sensor rows per strip

/** IEEE-754 half float -> float32. @param {number} h */
export function unhalf(h) {
  const e = (h >> 10) & 31, m = h & 1023;
  const v = e === 0 ? m * 2 ** -24 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15);
  return h & 32768 ? -v : v;
}

const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);
/** Float32 -> IEEE-754 half float (round-to-nearest-even). @param {number} v */
function toHalf(v) {
  _f32[0] = v;
  const x = _u32[0], s = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) {
    if (e < -10) return s;
    m = (m | 0x800000) >> (1 - e);
    if ((m & 0x1000) && ((m & 0x2000) || (m & 0xfff))) m += 0x2000;
    return s | (m >> 13);
  }
  if (e >= 31) return s | 0x7c00;
  if ((m & 0x1000) && ((m & 0x2000) || (m & 0xfff))) { m += 0x2000; if (m & 0x800000) { m = 0; e++; if (e >= 31) return s | 0x7c00; } }
  return s | (e << 10) | (m >> 13);
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

/** Parses v0.2.0 trunk layers and transforms weights.bin into Winograd U[16, co4, ci4, 4, 4] + bias.
 * @param {import('./neural.js').Graph} g @param {ArrayBuffer} wBuf */
export function buildWeights(g, wBuf) {
  const f16 = g.kind === 'f16';
  const raw = f16 ? Float32Array.from(new Uint16Array(wBuf), unhalf) : new Float32Array(wBuf);
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
              const vi = pwoff + (ob * cinp + ci) * 9 * nv + (ky * 3 + kx) * nv + h;
              const oc0 = ob * ocb + h * 4;
              for (let o = 0; o < 4; o++) {
                const oc = oc0 + o;
                if (oc < cout && ci < cin) filt[((oc * ciPad + ci) * 3 + ky) * 3 + kx] = raw[vi * 4 + o];
              }
            }
          }
        }
      }
    }
    const bias = new Float32Array(coPad);
    const bBase = pwoff + nob * cinp * 9 * nv;
    for (let oc = 0; oc < cout; oc++) bias[oc] = raw[bBase * 4 + oc];
    const U = new Float32Array(16 * co4 * ci4 * 16), tmp = new Float32Array(12);
    for (let oc = 0; oc < coPad; oc++) {
      for (let ic = 0; ic < ciPad; ic++) {
        const base = (oc * ciPad + ic) * 9;
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 3; c++) {
            tmp[r * 3 + c] = G[r][0] * filt[base + c] + G[r][1] * filt[base + 3 + c] + G[r][2] * filt[base + 6 + c];
          }
        }
        const o4 = oc >> 2, oo = oc & 3, i4 = ic >> 2, ii = ic & 3;
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) {
            const p = r * 4 + c;
            U[((((p * co4 + o4) * ci4 + i4) * 4 + ii) * 4) + oo] = tmp[r * 3] * G[c][0] + tmp[r * 3 + 1] * G[c][1] + tmp[r * 3 + 2] * G[c][2];
          }
        }
      }
    }
    const uOff = totalFloats / 4; chunks.push(U); totalFloats += U.length;
    const bOff = totalFloats / 4; chunks.push(bias); totalFloats += bias.length;
    layers.push({ cin, cout, ci4, co4, uOff, bOff, preAct, skip, outShuf });
  }
  const all = new Float32Array(totalFloats);
  let pos = 0;
  for (const c of chunks) { all.set(c, pos); pos += c.length; }
  const hCode = g.ops[g.ops.length - 1].code;
  const head = { w0: getU(hCode, 'W0'), nw0: getU(hCode, 'NW0'), w1: getU(hCode, 'W1') };
  const data = f16 ? Uint16Array.from(all, toHalf).buffer : all.buffer;
  return { layers, head, data };
}

/** Compiles the 5 generic Winograd + 4-chunk head shaders for `g`. @param {GPUDevice} device @param {import('./neural.js').Graph} g @param {{ w0: number, nw0: number, w1: number }} head */
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
  let ti = sy * cfg.tw + tx; let stride = cfg.tw * cfg.thStrip * cfg.ci4;
  V[0u * stride + ti * cfg.ci4 + c] = vec4<T>(t0[0] - t0[2]); V[1u * stride + ti * cfg.ci4 + c] = vec4<T>(t0[1] + t0[2]);
  V[2u * stride + ti * cfg.ci4 + c] = vec4<T>(t0[2] - t0[1]); V[3u * stride + ti * cfg.ci4 + c] = vec4<T>(t0[1] - t0[3]);
  V[4u * stride + ti * cfg.ci4 + c] = vec4<T>(t1[0] - t1[2]); V[5u * stride + ti * cfg.ci4 + c] = vec4<T>(t1[1] + t1[2]);
  V[6u * stride + ti * cfg.ci4 + c] = vec4<T>(t1[2] - t1[1]); V[7u * stride + ti * cfg.ci4 + c] = vec4<T>(t1[1] - t1[3]);
  V[8u * stride + ti * cfg.ci4 + c] = vec4<T>(t2[0] - t2[2]); V[9u * stride + ti * cfg.ci4 + c] = vec4<T>(t2[1] + t2[2]);
  V[10u * stride + ti * cfg.ci4 + c] = vec4<T>(t2[2] - t2[1]); V[11u * stride + ti * cfg.ci4 + c] = vec4<T>(t2[1] - t2[3]);
  V[12u * stride + ti * cfg.ci4 + c] = vec4<T>(t3[0] - t3[2]); V[13u * stride + ti * cfg.ci4 + c] = vec4<T>(t3[1] + t3[2]);
  V[14u * stride + ti * cfg.ci4 + c] = vec4<T>(t3[2] - t3[1]); V[15u * stride + ti * cfg.ci4 + c] = vec4<T>(t3[1] - t3[3]);
}`;

  const winoGemmCode = /* wgsl */ `${hdr}
struct Cfg { nTiles: u32, ci4: u32, co4: u32, uOff: u32 }
@group(0) @binding(0) var<storage, read> V: array<vec4<T>>;
@group(0) @binding(1) var<storage, read> U: array<vec4<T>>;
@group(0) @binding(2) var<storage, read_write> M: array<vec4<T>>;
@group(0) @binding(3) var<uniform> cfg: Cfg;
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let t0 = g.x * 4u; let o4 = g.y * 4u; let p = g.z;
  if (t0 >= cfg.nTiles || o4 >= cfg.co4 || p >= 16u) { return; }
  let t1 = min(t0 + 1u, cfg.nTiles - 1u); let t2 = min(t0 + 2u, cfg.nTiles - 1u); let t3 = min(t0 + 3u, cfg.nTiles - 1u);
  let o1 = min(o4 + 1u, cfg.co4 - 1u); let o2 = min(o4 + 2u, cfg.co4 - 1u); let o3 = min(o4 + 3u, cfg.co4 - 1u);
  var a00 = vec4f(0.0); var a10 = vec4f(0.0); var a20 = vec4f(0.0); var a30 = vec4f(0.0);
  var a01 = vec4f(0.0); var a11 = vec4f(0.0); var a21 = vec4f(0.0); var a31 = vec4f(0.0);
  var a02 = vec4f(0.0); var a12 = vec4f(0.0); var a22 = vec4f(0.0); var a32 = vec4f(0.0);
  var a03 = vec4f(0.0); var a13 = vec4f(0.0); var a23 = vec4f(0.0); var a33 = vec4f(0.0);
  let vBase = p * cfg.nTiles * cfg.ci4;
  for (var i4 = 0u; i4 < cfg.ci4; i4++) {
    let x0 = vec4f(V[vBase + t0 * cfg.ci4 + i4]); let x1 = vec4f(V[vBase + t1 * cfg.ci4 + i4]);
    let x2 = vec4f(V[vBase + t2 * cfg.ci4 + i4]); let x3 = vec4f(V[vBase + t3 * cfg.ci4 + i4]);
    let b0 = cfg.uOff + (p * cfg.co4 + o4) * cfg.ci4 * 4u + i4 * 4u;
    let w00 = vec4f(U[b0]); let w01 = vec4f(U[b0 + 1u]); let w02 = vec4f(U[b0 + 2u]); let w03 = vec4f(U[b0 + 3u]);
    a00 += x0.x * w00 + x0.y * w01 + x0.z * w02 + x0.w * w03; a10 += x1.x * w00 + x1.y * w01 + x1.z * w02 + x1.w * w03;
    a20 += x2.x * w00 + x2.y * w01 + x2.z * w02 + x2.w * w03; a30 += x3.x * w00 + x3.y * w01 + x3.z * w02 + x3.w * w03;
    let b1 = cfg.uOff + (p * cfg.co4 + o1) * cfg.ci4 * 4u + i4 * 4u;
    let w10 = vec4f(U[b1]); let w11 = vec4f(U[b1 + 1u]); let w12 = vec4f(U[b1 + 2u]); let w13 = vec4f(U[b1 + 3u]);
    a01 += x0.x * w10 + x0.y * w11 + x0.z * w12 + x0.w * w13; a11 += x1.x * w10 + x1.y * w11 + x1.z * w12 + x1.w * w13;
    a21 += x2.x * w10 + x2.y * w11 + x2.z * w12 + x2.w * w13; a31 += x3.x * w10 + x3.y * w11 + x3.z * w12 + x3.w * w13;
    let b2 = cfg.uOff + (p * cfg.co4 + o2) * cfg.ci4 * 4u + i4 * 4u;
    let w20 = vec4f(U[b2]); let w21 = vec4f(U[b2 + 1u]); let w22 = vec4f(U[b2 + 2u]); let w23 = vec4f(U[b2 + 3u]);
    a02 += x0.x * w20 + x0.y * w21 + x0.z * w22 + x0.w * w23; a12 += x1.x * w20 + x1.y * w21 + x1.z * w22 + x1.w * w23;
    a22 += x2.x * w20 + x2.y * w21 + x2.z * w22 + x2.w * w23; a32 += x3.x * w20 + x3.y * w21 + x3.z * w22 + x3.w * w23;
    let b3 = cfg.uOff + (p * cfg.co4 + o3) * cfg.ci4 * 4u + i4 * 4u;
    let w30 = vec4f(U[b3]); let w31 = vec4f(U[b3 + 1u]); let w32 = vec4f(U[b3 + 2u]); let w33 = vec4f(U[b3 + 3u]);
    a03 += x0.x * w30 + x0.y * w31 + x0.z * w32 + x0.w * w33; a13 += x1.x * w30 + x1.y * w31 + x1.z * w32 + x1.w * w33;
    a23 += x2.x * w30 + x2.y * w31 + x2.z * w32 + x2.w * w33; a33 += x3.x * w30 + x3.y * w31 + x3.z * w32 + x3.w * w33;
  }
  let mBase = p * cfg.nTiles * cfg.co4;
  M[mBase + t0 * cfg.co4 + o4] = vec4<T>(a00);
  if (t0 + 1u < cfg.nTiles) { M[mBase + (t0 + 1u) * cfg.co4 + o4] = vec4<T>(a10); }
  if (t0 + 2u < cfg.nTiles) { M[mBase + (t0 + 2u) * cfg.co4 + o4] = vec4<T>(a20); }
  if (t0 + 3u < cfg.nTiles) { M[mBase + (t0 + 3u) * cfg.co4 + o4] = vec4<T>(a30); }
  if (o4 + 1u < cfg.co4) {
    M[mBase + t0 * cfg.co4 + o4 + 1u] = vec4<T>(a01);
    if (t0 + 1u < cfg.nTiles) { M[mBase + (t0 + 1u) * cfg.co4 + o4 + 1u] = vec4<T>(a11); }
    if (t0 + 2u < cfg.nTiles) { M[mBase + (t0 + 2u) * cfg.co4 + o4 + 1u] = vec4<T>(a21); }
    if (t0 + 3u < cfg.nTiles) { M[mBase + (t0 + 3u) * cfg.co4 + o4 + 1u] = vec4<T>(a31); }
  }
  if (o4 + 2u < cfg.co4) {
    M[mBase + t0 * cfg.co4 + o4 + 2u] = vec4<T>(a02);
    if (t0 + 1u < cfg.nTiles) { M[mBase + (t0 + 1u) * cfg.co4 + o4 + 2u] = vec4<T>(a12); }
    if (t0 + 2u < cfg.nTiles) { M[mBase + (t0 + 2u) * cfg.co4 + o4 + 2u] = vec4<T>(a22); }
    if (t0 + 3u < cfg.nTiles) { M[mBase + (t0 + 3u) * cfg.co4 + o4 + 2u] = vec4<T>(a32); }
  }
  if (o4 + 3u < cfg.co4) {
    M[mBase + t0 * cfg.co4 + o4 + 3u] = vec4<T>(a03);
    if (t0 + 1u < cfg.nTiles) { M[mBase + (t0 + 1u) * cfg.co4 + o4 + 3u] = vec4<T>(a13); }
    if (t0 + 2u < cfg.nTiles) { M[mBase + (t0 + 2u) * cfg.co4 + o4 + 3u] = vec4<T>(a23); }
    if (t0 + 3u < cfg.nTiles) { M[mBase + (t0 + 3u) * cfg.co4 + o4 + 3u] = vec4<T>(a33); }
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
  let ty = cfg.ty0 + sy; let ti = sy * cfg.tw + tx; let stride = cfg.tw * cfg.thStrip * cfg.co4;
  var s0: array<vec4f, 4>; var s1: array<vec4f, 4>;
  for (var j = 0u; j < 4u; j++) {
    let m0 = vec4f(M[(0u + j) * stride + ti * cfg.co4 + o4]); let m1 = vec4f(M[(4u + j) * stride + ti * cfg.co4 + o4]);
    let m2 = vec4f(M[(8u + j) * stride + ti * cfg.co4 + o4]); let m3 = vec4f(M[(12u + j) * stride + ti * cfg.co4 + o4]);
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
  let ty = cfg.ty0 + sy; let ti = sy * cfg.tw + tx; let stride = cfg.tw * cfg.thStrip * cfg.co4;
  var s0: array<vec4f, 4>; var s1: array<vec4f, 4>;
  for (var j = 0u; j < 4u; j++) {
    let m0 = vec4f(M[(0u + j) * stride + ti * cfg.co4 + o4]); let m1 = vec4f(M[(4u + j) * stride + ti * cfg.co4 + o4]);
    let m2 = vec4f(M[(8u + j) * stride + ti * cfg.co4 + o4]); let m3 = vec4f(M[(12u + j) * stride + ti * cfg.co4 + o4]);
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
  let plane = W * W;
  var v: array<f32, 45>;
  for (var dy = 0u; dy < 3u; dy++) {
    let yy = y + dy - 1u;
    for (var dx = 0u; dx < 3u; dx++) {
      let xx = x + dx - 1u;
      let ok = xx < valid.w && yy < valid.h;
      let idx = select(0u, yy * W + xx, ok); let gn = select(0.0, 1.0, ok); let t = (dy * 3u + dx) * 5u;
      v[t] = gn * f32(up[idx]); v[t + 1u] = gn * f32(up[plane + idx]); v[t + 2u] = gn * f32(up[2u * plane + idx]);
      v[t + 3u] = gn * f32(mos[idx]); v[t + 4u] = gn * f32(sig[idx]);
    }
  }
  let bBase = W0 + bank * NW0; let rb = vec4f(pw[W1 + 48u]);
  var r0 = rb.x; var r1 = rb.y; var r2 = rb.z;
  for (var ch = 0u; ch < 4u; ch++) {
    let c0 = ch * 4u;
    var h0 = vec4f(pw[bBase + 720u + c0]); var h1 = vec4f(pw[bBase + 720u + c0 + 1u]);
    var h2 = vec4f(pw[bBase + 720u + c0 + 2u]); var h3 = vec4f(pw[bBase + 720u + c0 + 3u]);
    for (var t = 0u; t < 45u; t++) {
      let vt = v[t]; let wi = bBase + t * NV + c0;
      h0 += vt * vec4f(pw[wi]); h1 += vt * vec4f(pw[wi + 1u]); h2 += vt * vec4f(pw[wi + 2u]); h3 += vt * vec4f(pw[wi + 3u]);
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
          bgGm: grp(wino.pipes.wGemm, [{ binding: 0, resource: { buffer: bufV } }, { binding: 1, resource: { buffer: wino.wBuf } }, { binding: 2, resource: { buffer: bufM } }, { binding: 3, resource: { buffer: cGm[idx] } }]),
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
          [wino.pipes.wGemm, b.bgGm, Math.ceil(Math.ceil(nTiles / 4) / 8), Math.ceil(Math.ceil(L.co4 / 4) / 8), 16, false, 2 + li],
          [outPipe, b.bgOu, Math.ceil(tw / 8), Math.ceil(thStrip / 8), L.co4, false, 2 + li],
        );
      }
    }
    out.push([wino.pipes.head4, s.bgHead, Math.ceil(vw / 48), Math.ceil(vh / 48), 36, true, 13]);
    return out;
  };
  return {
    passes,
    destroy: () => {
      bufV.destroy(); bufM.destroy();
      for (const s of slots.values()) { s.cPrep.destroy(); for (const b of [...s.cIn, ...s.cGm, ...s.cOu]) b.destroy(); }
      slots.clear();
    },
  };
}

