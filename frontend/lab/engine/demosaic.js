// @ts-check
// Full resolution from the sensor's own pixels: an X-Trans sensor records one colour at each, and this makes
// the other two. Green is made the way Frank Markesteijn's X-Trans method makes it (dcraw 9.20, as darktable
// carries it in src/iop/demosaicing/xtrans.c, GPL 3): at each red or blue site four guesses, along the row, the
// column and both diagonals, and then whichever are smoothest around that place. Red and blue are vkdt's
// (Johannes Hanika and the vkdt authors, BSD 2-clause; its gauss and fix passes). Measured against a known
// picture laid out as a mosaic again, this green is 2 to 3 dB truer than vkdt's own (its splat pass), and vkdt's
// colour has less false colour than Markesteijn's own red and blue. Everything works on any rectangle of the photo:
//   gauss  for each 3 × 3 block of the pattern, which way the detail runs there: the spread of its five green
//          sites, weighted once by their brightness and once by its inverse, and the tighter of the two (an
//          edge's bright side or its dark side) as a short and a long axis, snapped to rows or columns
//   guess  at each red or blue site, green four ways (each from the greens round it and how its own colour bends
//          there), kept between the least and the most of the six greens round its pair
//   level  for each way, how many of a pixel's neighbours are about as smooth along it as the smoothest way is
//   mean   green at every pixel: a green site's own reading; elsewhere the mean of the ways that are level most
//          widely around it
//   fix    red and blue at every pixel: the nearby sites of each, as a ratio to the green found there
// That is the first look, made for the rectangle and 6 pixels more each way; demosaic-again.js then makes the
// greens again from it, chooses among them by colour as well as brightness, and writes the result.
// The 2 × 2 eigen solver in gauss is Christoph Peters's, as vkdt marks it. The result is in the editing copy's
// own form (two u32 a pixel, the clipped colours flagged), so the frame pass (wgsl.js) develops it unchanged.

import { AGAIN, REACH } from './demosaic-again.js';
import { SPOTS, SPOT_ROWS, mendWGSL } from './mend.js';

/** The pattern as vkdt lays it out (0 red, 1 green, 2 blue): green at the corners and centre of each 3 × 3 block. */
const LAYOUT = '101121212010101121121101010212121101';
/** Markesteijn's map: for each place in a 3 × 3 block of the layout, the way (x, y) to the six greens round a red
 * or blue site and its pair (nothing for a green site). The lone green is each block's middle. */
function hexes() {
  const fc = (/** @type {number} */ r, /** @type {number} */ c) => +LAYOUT[((r + 6) % 6) * 6 + ((c + 6) % 6)];
  const orth = [1, 0, 0, 1, -1, 0, 0, -1, 1, 0, 0, 1], patt = [0, 1, 0, -1, 2, 0, -1, 0, 1, 1, 1, -1], out = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    const hex = Array.from({ length: 6 }, () => [0, 0]);
    for (let ng = 0, d = 0; d < 10 && fc(row, col) !== 1; d += 2) {
      if (fc(row + orth[d], col + orth[d + 2]) === 1) ng = 0; else ng++;
      if (ng === 1) for (let c = 0; c < 6; c++) hex[c] = [orth[d + 2] * patt[c * 2] + orth[d + 3] * patt[c * 2 + 1], orth[d] * patt[c * 2] + orth[d + 1] * patt[c * 2 + 1]];
    }
    out.push(...hex);
  }
  return out.map(([x, y]) => `vec2i(${x}, ${y})`).join(', ');
}
const WGSL = /* wgsl */ `
struct D { at: vec4i,       // the rectangle being made: x, y, width, height, in sensor pixels
           blocks: vec4i,   // the first block of directions kept (x, y), and how many across and down
           phase: vec2i,    // added to a sensor position, it lands on the pattern as laid out above
           black: f32, scale: f32,
           n: vec4u,        // spots to retouch (heal.js): how many
           wb: vec4f,       // what brings red, green and blue to one scale (the shot's white balance): guess compares them
           sp: array<vec4f, ${SPOTS * SPOT_ROWS}> };
@group(0) @binding(0) var mosaic: texture_2d<u32>;
@group(0) @binding(1) var<uniform> d: D;
@group(0) @binding(2) var<storage, read_write> cov: array<vec4f>;   // a block's direction: the two axes' spreads, then the first axis
@group(0) @binding(3) var<storage, read_write> green: array<f32>;   // the rectangle and 8 pixels more each way
@group(0) @binding(4) var<storage, read_write> rgb: array<u32>;     // the result, two a pixel
@group(0) @binding(5) var<storage, read_write> ways: array<u32>;    // green four ways (half floats, two u32 a pixel): the rectangle and 12 more each way
@group(0) @binding(6) var<storage, read_write> calm: array<u32>;    // how level each way is (a byte each): the rectangle and 10 more each way
const OWN = 0.5;   // how far a red or blue site's own reading is trusted over what its neighbours say (measured: half gains 0.5 to 0.6 dB and costs next to no false colour; all of it gains 0.8 and costs 0.5 to 1 dB of colour)
const CLIP = 0.97;   // a site this near the sensor's white has clipped (raw's own threshold for the editing copy)
// a position off the frame reads the same colour's site one pattern (6 pixels) in
fn fold(q: vec2i) -> vec2i { let n = vec2i(textureDimensions(mosaic)); return q + select(vec2i(0), vec2i(6), q < vec2i(0)) - select(vec2i(0), vec2i(6), q >= n); }
fn own(q: vec2i) -> f32 { return (f32(textureLoad(mosaic, fold(q), 0).r) - d.black) * d.scale; }
fn colour(q: vec2i) -> u32 {   // 0 red, 1 green, 2 blue
  let s = q + d.phase + 6; let b = s / 3; let m = s - b * 3;
  if (((m.x + m.y) & 1) == 0) { return 1u; }
  return select(0u, 2u, (((b.x + b.y) & 1) == 1) != (m.y == 1));
}
${mendWGSL('d.sp', 'd.n.x')}
// a site's value: its own, or near a retouched spot what the spot puts there (a site of the same colour, a whole
// number of patterns away)
fn raw(q: vec2i) -> f32 {
  var v = own(q); if (near == 0u) { return v; }
  let c = colour(q); let s = vec2f(q) + 0.5;
  for (var i = 0u; i < d.n.x; i++) { if ((near & (1u << i)) == 0u) { continue; } let k = spot(i, s, c); if (k.x > 0.0) { v = mix(v, own(q + vec2i(d.sp[i * ${SPOT_ROWS}u + 1u].xy)) * k.y, k.x); } }
  return v;
}
const SITE = array<vec2i, 5>(vec2i(0, 0), vec2i(2, 0), vec2i(1, 1), vec2i(0, 2), vec2i(2, 2));
@compute @workgroup_size(8, 8)
fn gauss(@builtin(global_invocation_id) id: vec3u) {
  if (any(vec2i(id.xy) >= d.blocks.zw)) { return; }
  let o = (d.blocks.xy + vec2i(id.xy)) * 3 - d.phase;   // the block's first sensor pixel
  nearby(vec2f(o) + 1.5, 12.0);
  var v: array<f32, 5>; var mw = vec2f(0.0); var mb = vec2f(0.0); var smw = 0.0; var smb = 0.0;
  for (var k = 0; k < 5; k++) { let px = max(raw(o + SITE[k]), 1e-4); v[k] = px; let q = vec2f(SITE[k]); mw += q * px; smw += px; mb += q / px; smb += 1.0 / px; }
  mw /= smw; mb /= smb;
  var sw = vec3f(0.0); var sb = vec3f(0.0); var nw = 0.0; var nb = 0.0;   // each spread as xx, xy, yy
  for (var k = 0; k < 5; k++) {
    let p2 = v[k] * v[k]; var q = vec2f(SITE[k]) - mw; sw += p2 * vec3f(q.x * q.x, q.x * q.y, q.y * q.y); nw += p2;
    q = vec2f(SITE[k]) - mb; sb += vec3f(q.x * q.x, q.x * q.y, q.y * q.y) / p2; nb += 1.0 / p2;
  }
  sw /= nw; sb /= nb;
  let s = select(sb, sw, sw.x * sw.z - sw.y * sw.y < sb.x * sb.z - sb.y * sb.y);
  let mid = 0.5 * (s.x + s.z); let root = sqrt(max(mid * mid - (s.x * s.z - s.y * s.y), 0.0));
  var ev = vec2f(mid + root, mid - root);
  let a0 = s.x - ev.x; let c0 = s.z - ev.x;
  var e1 = select(vec2f(s.y, c0), vec2f(a0, s.y), a0 * a0 > c0 * c0);
  let len = dot(e1, e1);
  if (len == 0.0) { e1 = vec2f(1.0, 0.0); } else { e1 = e1 / sqrt(len); }
  var e0 = vec2f(e1.y, -e1.x);
  ev *= 0.4;
  if (abs(e0.x) > 2.0 * abs(e0.y)) { e0 = vec2f(1.0, 0.0); } else if (abs(e0.y) > 2.0 * abs(e0.x)) { e0 = vec2f(0.0, 1.0); } else { ev = vec2f(0.1); }
  cov[id.y * u32(d.blocks.z) + id.x] = vec4f(ev, e0);
}
// how much a site i across and j down counts, for a direction c whose spreads are ev
fn along(c: vec4f, ev: vec2f, i: i32, j: i32, least: f32) -> f32 {
  let t = vec2f(c.z * f32(i) + c.w * f32(j), -c.w * f32(i) + c.z * f32(j));
  return clamp(exp(-0.5 * dot(t / ev, t)), least, 1.0);
}
const HEX = array<vec2i, 54>(${hexes()});
const WAY = array<vec2i, 4>(vec2i(1, 0), vec2i(0, 1), vec2i(1, 1), vec2i(-1, 1));
@compute @workgroup_size(8, 8)
fn guess(@builtin(global_invocation_id) id: vec3u) {
  let ww = d.at.z + 24;
  if (i32(id.x) >= ww || i32(id.y) >= d.at.w + 24) { return; }
  let q = d.at.xy - 12 + vec2i(id.xy); let k = colour(q);
  nearby(vec2f(q) + 0.5, 12.0);
  var c = vec4f(raw(q));
  if (k != 1u) {
    let s = q + d.phase + 6; let m = s - (s / 3) * 3; let h = u32(m.y * 3 + m.x) * 6u; let wb = d.wb[k];
    var lo = 1e9; var hi = 0.0;
    for (var i = 0u; i < 6u; i++) { let v = raw(q + HEX[h + i]); lo = min(lo, v); hi = max(hi, v); }
    let mine = c.x * wb;
    let a = 0.6796875 * (raw(q + HEX[h + 1u]) + raw(q + HEX[h])) - 0.1796875 * (raw(q + 2 * HEX[h + 1u]) + raw(q + 2 * HEX[h]));
    let b = 0.87109375 * raw(q + HEX[h + 3u]) + 0.13 * raw(q + HEX[h + 2u]) + 0.359375 * (mine - raw(q - HEX[h + 2u]) * wb);
    let e = 0.640625 * raw(q + HEX[h + 4u]) + 0.359375 * raw(q - 2 * HEX[h + 4u]) + 0.12890625 * (2.0 * mine - (raw(q + 3 * HEX[h + 4u]) + raw(q - 3 * HEX[h + 4u])) * wb);
    let f = 0.640625 * raw(q + HEX[h + 5u]) + 0.359375 * raw(q - 2 * HEX[h + 5u]) + 0.12890625 * (2.0 * mine - (raw(q + 3 * HEX[h + 5u]) + raw(q - 3 * HEX[h + 5u])) * wb);
    c = clamp(select(vec4f(a, b, e, f), vec4f(b, a, f, e), m.y == 1), vec4f(lo), vec4f(hi));   // in the lone greens' rows the guesses lie the other way round
  }
  let n = (id.y * u32(ww) + id.x) * 2u;
  ways[n] = pack2x16float(c.xy); ways[n + 1u] = pack2x16float(c.zw);
}
fn waysAt(q: vec2i) -> vec4f { let s = q - d.at.xy + 12; let n = u32(s.y * (d.at.z + 24) + s.x) * 2u; return vec4f(unpack2x16float(ways[n]), unpack2x16float(ways[n + 1u])); }
@compute @workgroup_size(8, 8)
fn level(@builtin(global_invocation_id) id: vec3u) {
  let fw = d.at.z + 20;
  if (i32(id.x) >= fw || i32(id.y) >= d.at.w + 20) { return; }
  let q = d.at.xy - 10 + vec2i(id.xy);
  var g: array<vec4f, 25>;
  for (var j = 0; j < 5; j++) { for (var i = 0; i < 5; i++) { g[j * 5 + i] = waysAt(q + vec2i(i - 2, j - 2)); } }
  var bend: array<vec4f, 9>;   // how much each way's green bends along its own line, here and at the eight around
  for (var j = 0; j < 3; j++) { for (var i = 0; i < 3; i++) {
    let o = (j + 1) * 5 + i + 1; var v = vec4f(0.0);
    for (var w = 0; w < 4; w++) { let st = WAY[w].y * 5 + WAY[w].x; let t = 2.0 * g[o][w] - g[o + st][w] - g[o - st][w]; v[w] = t * t; }
    bend[j * 3 + i] = v;
  } }
  let least = max(8.0 * min(min(bend[4].x, bend[4].y), min(bend[4].z, bend[4].w)), 1e-10);
  var n = vec4u(0u);
  for (var i = 0; i < 9; i++) { n += vec4u(bend[i] <= vec4f(least)); }
  calm[id.y * u32(fw) + id.x] = n.x | (n.y << 8u) | (n.z << 16u) | (n.w << 24u);
}
@compute @workgroup_size(8, 8)
fn mean(@builtin(global_invocation_id) id: vec3u) {
  let gw = d.at.z + 16;
  if (i32(id.x) >= gw || i32(id.y) >= d.at.w + 16) { return; }
  let q = d.at.xy - 8 + vec2i(id.xy);
  var v = 0.0;
  if (colour(q) == 1u) { nearby(vec2f(q) + 0.5, 12.0); v = raw(q); }   // a green site keeps its own reading
  else {
    var n = vec4u(0u); let s = q - d.at.xy + 10;
    for (var j = -2; j <= 2; j++) { for (var i = -2; i <= 2; i++) { let f = calm[u32((s.y + j) * (d.at.z + 20) + s.x + i)]; n += vec4u(f & 255u, (f >> 8u) & 255u, (f >> 16u) & 255u, f >> 24u); } }
    var most = max(max(n.x, n.y), max(n.z, n.w)); most -= most >> 3u;
    let take = vec4f(n >= vec4u(most));
    v = dot(waysAt(q), take) / (take.x + take.y + take.z + take.w);
  }
  green[id.y * u32(gw) + id.x] = v;
}
fn greenAt(q: vec2i) -> f32 { let s = fold(q) - d.at.xy + 8; return max(green[s.y * (d.at.z + 16) + s.x], 0.0); }
@compute @workgroup_size(8, 8)
fn fix(@builtin(global_invocation_id) id: vec3u) {
  let ew = d.at.z + ${2 * REACH};
  if (i32(id.x) >= ew || i32(id.y) >= d.at.w + ${2 * REACH}) { return; }
  let q = d.at.xy - ${REACH} + vec2i(id.xy); let gc = greenAt(q);
  nearby(vec2f(q) + 0.5, 12.0);
  let b = clamp((max(q, vec2i(0)) + d.phase + 1) / 3 - d.blocks.xy, vec2i(0), d.blocks.zw - 1); let c = cov[b.y * d.blocks.z + b.x];
  let ev = 3.0 * clamp(c.xy, vec2f(1.0), vec2f(10.0));
  var sum = vec3f(0.0); var wsum = vec3f(0.0); var clip = 0u;
  for (var j = -2; j <= 2; j++) { for (var i = -2; i <= 2; i++) {
    let at = q + vec2i(i, j); let k = colour(at); let v = raw(at);
    if (max(abs(i), abs(j)) <= 1 && v >= CLIP) { clip |= 1u << k; }   // ours: which colours clipped beside this pixel
    if (k == 1u) { continue; }
    let wt = along(c, ev, i, j, 1e-3); let m = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), k == 2u);
    sum += m * (v * (1e-4 + gc) / (1e-4 + greenAt(at)) * wt); wsum += m * wt;
  } }
  var c3 = sum / max(vec3f(1e-8), wsum); c3.g = gc;
  let me = colour(q); if (me != 1u) { c3[me] = mix(c3[me], raw(q), OWN); }   // a red or blue site mostly keeps its own reading
  let u = vec3u(clamp(c3, vec3f(0.0), vec3f(1.0)) * 65535.0 + 0.5);
  let n = (id.y * u32(ew) + id.x) * 2u;
  est[n] = u.x | (u.y << 16u); est[n + 1u] = u.z | (clip << 16u);
}
${AGAIN}`;

/** Where the sensor's pattern sits against vkdt's layout: what to add to a sensor position to land on it. Null
 * for a sensor that is not X-Trans. @param {{ cfa?: string, cfaWidth?: number }} meta @returns {null | [number, number]} */
export function phaseOf(meta) {
  if (meta.cfaWidth !== 6 || meta.cfa?.length !== 36) return null;
  for (let oy = 0; oy < 6; oy++) {
    for (let ox = 0; ox < 6; ox++) {
      let same = true;
      for (let k = 0; k < 36 && same; k++) same = meta.cfa[k] === LAYOUT[((Math.floor(k / 6) + oy) % 6) * 6 + ((k % 6) + ox) % 6];
      if (same) return [ox, oy];
    }
  }
  return null;
}

/** @type {WeakMap<GPUDevice, Promise<GPUComputePipeline[]>>} */
const made = new WeakMap();
/** The eight passes, compiled once for a device, the first time full resolution is wanted. @param {GPUDevice} device */
function pipes(device) {
  let p = made.get(device);
  if (!p) {
    const module = device.createShaderModule({ code: WGSL });
    p = Promise.all(['gauss', 'guess', 'level', 'mean', 'fix', 'again', 'level2', 'pick'].map((entryPoint) => device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint } })));
    made.set(device, p);
  }
  return p;
}

/** Starts compiling the passes, so the first 100 % does not wait for them. @param {GPUDevice} device */
export const compile = (device) => pipes(device);

/** Makes rectangles of the photo at full resolution, each up to maxW × maxH sensor pixels. `run` adds the eight
 * passes to a frame's commands (one rectangle a submit: its place is written when `run` is called); the result
 * is in `out`, rw pixels a row.
 * @param {GPUDevice} device @param {GPUTexture} mosaic the sensor's pixels, r16uint
 * @param {{ phase: number[], black: number, white: number, wb: number[] }} info `wb`: the shot's white balance (red, green, blue)
 * @param {number} maxW @param {number} maxH */
export async function demosaicer(device, mosaic, info, maxW, maxH) {
  const [gauss, guess, level, mean, fix, again, level2, pick] = await pipes(device), W = mosaic.width, H = mosaic.height, [px, py] = info.phase;
  const buf = (/** @type {number} */ size, /** @type {number} */ usage) => device.createBuffer({ size, usage });
  const SIZE = 80 + SPOTS * SPOT_ROWS * 16, uni = buf(SIZE, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const cov = buf((Math.ceil(maxW / 3) + 8) * (Math.ceil(maxH / 3) + 8) * 16, GPUBufferUsage.STORAGE);
  const green = buf((maxW + 16) * (maxH + 16) * 4, GPUBufferUsage.STORAGE);
  const out = buf(maxW * maxH * 8, GPUBufferUsage.STORAGE);
  const ways = buf((maxW + 24) * (maxH + 24) * 8, GPUBufferUsage.STORAGE), flat = buf((maxW + 20) * (maxH + 20) * 4, GPUBufferUsage.STORAGE);
  const est = buf((maxW + 2 * REACH) * (maxH + 2 * REACH) * 8, GPUBufferUsage.STORAGE);
  const all = [mosaic.createView(), ...[uni, cov, green, out, ways, flat, est].map((buffer) => ({ buffer }))];
  // each pass is given just what it uses: mosaic 0, settings 1, directions 2, green 3, result 4, the four greens 5, how level 6, the first look 7
  const group = (/** @type {GPUComputePipeline} */ pipe, /** @type {number[]} */ uses) => ({ pipe, bind: device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: uses.map((binding) => ({ binding, resource: all[binding] })) }) });
  const steps = [group(gauss, [0, 1, 2]), group(guess, [0, 1, 5]), group(level, [1, 5, 6]), group(mean, [0, 1, 3, 5, 6]), group(fix, [0, 1, 2, 3, 7]),
    group(again, [0, 1, 5, 7]), group(level2, [0, 1, 5, 6, 7]), group(pick, [1, 4, 5, 6, 7])];
  /** @param {GPUCommandEncoder} enc @param {number} rx @param {number} ry @param {number} rw @param {number} rh
   * @param {Float32Array | null} [spots] retouching, as heal.js's `spotRows` gives it */
  const run = (enc, rx, ry, rw, rh, spots) => {
    // the blocks whose direction a pixel of the rectangle, or of the 8 around it (the first look's reach and 2), reads
    const first = (/** @type {number} */ r, /** @type {number} */ ph) => Math.floor((Math.max(r - 8, 0) + ph) / 3);
    const count = (/** @type {number} */ r, /** @type {number} */ n, /** @type {number} */ N, /** @type {number} */ ph) => Math.floor((Math.min(r + n + 7, N - 1) + ph + 1) / 3) - first(r, ph) + 1;
    const bx = first(rx, px), by = first(ry, py), bw = count(rx, rw, W, px), bh = count(ry, rh, H, py);
    const u = new ArrayBuffer(SIZE), n = new Int32Array(u), f = new Float32Array(u);
    n.set([rx, ry, rw, rh, bx, by, bw, bh, px, py]); f[10] = info.black; f[11] = 1 / (info.white - info.black);
    const g1 = info.wb?.[1] || 1; f.set([(info.wb?.[0] || g1) / g1, 1, (info.wb?.[2] || g1) / g1], 16);   // a photo with no white balance of its own: the colours as they are
    if (spots) { n[12] = spots[0]; f.set(spots.subarray(4), 20); }
    device.queue.writeBuffer(uni, 0, u);
    const pass = enc.beginComputePass(), sizes = [[bw, bh], [rw + 24, rh + 24], [rw + 20, rh + 20], [rw + 16, rh + 16], [rw + 12, rh + 12], [rw + 8, rh + 8], [rw + 4, rh + 4], [rw, rh]];
    steps.forEach((s, k) => { pass.setPipeline(s.pipe); pass.setBindGroup(0, s.bind); pass.dispatchWorkgroups(Math.ceil(sizes[k][0] / 8), Math.ceil(sizes[k][1] / 8)); });
    pass.end();
  };
  return { out, run, destroy: () => { for (const b of [uni, cov, green, out, ways, flat, est]) b.destroy(); } };
}
