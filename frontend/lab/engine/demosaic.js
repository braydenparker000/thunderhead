// @ts-check
// Full resolution from the sensor's own pixels: an X-Trans sensor records one colour at each, and this makes
// the other two. The method is vkdt's demosaic (Johannes Hanika and the vkdt authors, BSD 2-clause; its
// gauss, splat and fix passes), ported to WGSL and made to work on any rectangle of the photo:
//   gauss  for each 3 × 3 block of the pattern, which way the detail runs there: the spread of its five green
//          sites, weighted once by their brightness and once by its inverse, and the tighter of the two (an
//          edge's bright side or its dark side) as a short and a long axis, snapped to rows or columns
//   splat  green at every pixel: the greens around it, weighted along that direction, not across it
//   fix    red and blue at every pixel: the nearby sites of each, as a ratio to the green found there
// The 2 × 2 eigen solver in gauss is Christoph Peters's, as vkdt marks it. The result is in the editing copy's
// own form (two u32 a pixel, the clipped colours flagged), so the frame pass (wgsl.js) develops it unchanged.

/** The pattern as vkdt lays it out (0 red, 1 green, 2 blue): green at the corners and centre of each 3 × 3 block. */
const LAYOUT = '101121212010101121121101010212121101';
const WGSL = /* wgsl */ `
struct D { at: vec4i,       // the rectangle being made: x, y, width, height, in sensor pixels
           blocks: vec4i,   // the first block of directions kept (x, y), and how many across and down
           phase: vec2i,    // added to a sensor position, it lands on the pattern as laid out above
           black: f32, scale: f32 };
@group(0) @binding(0) var mosaic: texture_2d<u32>;
@group(0) @binding(1) var<uniform> d: D;
@group(0) @binding(2) var<storage, read_write> cov: array<vec4f>;   // a block's direction: the two axes' spreads, then the first axis
@group(0) @binding(3) var<storage, read_write> green: array<f32>;   // the rectangle and 2 pixels more each way
@group(0) @binding(4) var<storage, read_write> rgb: array<u32>;     // the result, two a pixel
const CLIP = 0.97;   // a site this near the sensor's white has clipped (raw's own threshold for the editing copy)
// a position off the frame reads the same colour's site one pattern (6 pixels) in
fn fold(q: vec2i) -> vec2i { let n = vec2i(textureDimensions(mosaic)); return q + select(vec2i(0), vec2i(6), q < vec2i(0)) - select(vec2i(0), vec2i(6), q >= n); }
fn raw(q: vec2i) -> f32 { return (f32(textureLoad(mosaic, fold(q), 0).r) - d.black) * d.scale; }
fn colour(q: vec2i) -> u32 {   // 0 red, 1 green, 2 blue
  let s = q + d.phase + 6; let b = s / 3; let m = s - b * 3;
  if (((m.x + m.y) & 1) == 0) { return 1u; }
  return select(0u, 2u, (((b.x + b.y) & 1) == 1) != (m.y == 1));
}
const SITE = array<vec2i, 5>(vec2i(0, 0), vec2i(2, 0), vec2i(1, 1), vec2i(0, 2), vec2i(2, 2));
@compute @workgroup_size(8, 8)
fn gauss(@builtin(global_invocation_id) id: vec3u) {
  if (any(vec2i(id.xy) >= d.blocks.zw)) { return; }
  let o = (d.blocks.xy + vec2i(id.xy)) * 3 - d.phase;   // the block's first sensor pixel
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
@compute @workgroup_size(8, 8)
fn splat(@builtin(global_invocation_id) id: vec3u) {
  let gw = d.at.z + 4;
  if (i32(id.x) >= gw || i32(id.y) >= d.at.w + 4) { return; }
  let q = d.at.xy - 2 + vec2i(id.xy);
  if (any(q < vec2i(0)) || any(q >= vec2i(textureDimensions(mosaic)))) { return; }
  let b = (q + d.phase) / 3 - d.blocks.xy; let c = cov[b.y * d.blocks.z + b.x];
  let ev = clamp(c.xy, vec2f(0.01), vec2f(25.0));
  var sum = 0.0; var wsum = 0.0;
  for (var j = -2; j <= 2; j++) { for (var i = -2; i <= 2; i++) {
    if (colour(q + vec2i(i, j)) != 1u) { continue; }
    var wt = along(c, ev, i, j, 1e-4);
    if (i == 0 && j == 0) { wt = 666.0; }   // a green site keeps its own reading
    sum += raw(q + vec2i(i, j)) * wt; wsum += wt;
  } }
  green[id.y * u32(gw) + id.x] = sum / max(1e-8, wsum);
}
fn greenAt(q: vec2i) -> f32 { let s = fold(q) - d.at.xy + 2; return max(green[s.y * (d.at.z + 4) + s.x], 0.0); }
@compute @workgroup_size(8, 8)
fn fix(@builtin(global_invocation_id) id: vec3u) {
  if (any(vec2i(id.xy) >= d.at.zw)) { return; }
  let q = d.at.xy + vec2i(id.xy); let gc = greenAt(q);
  let b = (q + d.phase + 1) / 3 - d.blocks.xy; let c = cov[b.y * d.blocks.z + b.x];
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
  let u = vec3u(clamp(c3, vec3f(0.0), vec3f(1.0)) * 65535.0 + 0.5);
  let n = (id.y * u32(d.at.z) + id.x) * 2u;
  rgb[n] = u.x | (u.y << 16u); rgb[n + 1u] = u.z | (clip << 16u);
}`;

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
/** The three passes, compiled once for a device, the first time full resolution is wanted. @param {GPUDevice} device */
function pipes(device) {
  let p = made.get(device);
  if (!p) {
    const module = device.createShaderModule({ code: WGSL });
    p = Promise.all(['gauss', 'splat', 'fix'].map((entryPoint) => device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint } })));
    made.set(device, p);
  }
  return p;
}

/** Makes rectangles of the photo at full resolution, each up to maxW × maxH sensor pixels. `run` adds the three
 * passes to a frame's commands (one rectangle a submit: its place is written when `run` is called); the result
 * is in `out`, rw pixels a row.
 * @param {GPUDevice} device @param {GPUTexture} mosaic the sensor's pixels, r16uint
 * @param {{ phase: number[], black: number, white: number }} info @param {number} maxW @param {number} maxH */
export async function demosaicer(device, mosaic, info, maxW, maxH) {
  const [gauss, splat, fix] = await pipes(device), W = mosaic.width, H = mosaic.height, [px, py] = info.phase;
  const buf = (/** @type {number} */ size, /** @type {number} */ usage) => device.createBuffer({ size, usage });
  const uni = buf(48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const cov = buf((Math.ceil(maxW / 3) + 4) * (Math.ceil(maxH / 3) + 4) * 16, GPUBufferUsage.STORAGE);
  const green = buf((maxW + 4) * (maxH + 4) * 4, GPUBufferUsage.STORAGE);
  const out = buf(maxW * maxH * 8, GPUBufferUsage.STORAGE);
  const all = [{ binding: 0, resource: mosaic.createView() }, { binding: 1, resource: { buffer: uni } }, { binding: 2, resource: { buffer: cov } }, { binding: 3, resource: { buffer: green } }, { binding: 4, resource: { buffer: out } }];
  const group = (/** @type {GPUComputePipeline} */ pipe, /** @type {number} */ n) => ({ pipe, bind: device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: all.slice(0, n) }) });
  const steps = [group(gauss, 3), group(splat, 4), group(fix, 5)];
  /** @param {GPUCommandEncoder} enc @param {number} rx @param {number} ry @param {number} rw @param {number} rh */
  const run = (enc, rx, ry, rw, rh) => {
    // the blocks whose direction a pixel of the rectangle, or of the 2 around it, reads
    const first = (/** @type {number} */ r, /** @type {number} */ ph) => Math.floor((Math.max(r - 2, 0) + ph) / 3);
    const count = (/** @type {number} */ r, /** @type {number} */ n, /** @type {number} */ N, /** @type {number} */ ph) => Math.floor((Math.min(r + n + 1, N - 1) + ph + 1) / 3) - first(r, ph) + 1;
    const bx = first(rx, px), by = first(ry, py), bw = count(rx, rw, W, px), bh = count(ry, rh, H, py);
    const u = new ArrayBuffer(48), n = new Int32Array(u), f = new Float32Array(u);
    n.set([rx, ry, rw, rh, bx, by, bw, bh, px, py]); f[10] = info.black; f[11] = 1 / (info.white - info.black);
    device.queue.writeBuffer(uni, 0, u);
    const pass = enc.beginComputePass(), sizes = [[bw, bh], [rw + 4, rh + 4], [rw, rh]];
    steps.forEach((s, k) => { pass.setPipeline(s.pipe); pass.setBindGroup(0, s.bind); pass.dispatchWorkgroups(Math.ceil(sizes[k][0] / 8), Math.ceil(sizes[k][1] / 8)); });
    pass.end();
  };
  return { out, run, destroy: () => { for (const b of [uni, cov, green, out]) b.destroy(); } };
}
