// @ts-check
// Geometry: where each pixel of the finished picture comes from on the sensor. One pass makes a copy of the
// photo already laid out as the picture (cropped, straightened, turned upright, the lens's distortion, colour
// fringing and darkened corners undone: lens.js), in the editing copy's own form, so the frame pass stays one
// read a pixel and every control costs what it did. The same pass serves the editing copy and, a rectangle at
// a time, the sensor's own pixels (full.js).
//
// From a point of the picture back to the sensor: out of the crop and its straighten angle, through the
// perspective, across the flips, back through the quarter turns, then outwards or inwards along the line from
// the centre by the lens table, once for each colour.
import { N, REACH, lensTable } from './lens.js';
import { frame, isNone } from './crop.js';
import { SPOTS, SPOT_ROWS, mendWGSL } from './mend.js';

const ROT = /** @type {Record<string, number>} */ ({ Rotate90: 1, Rotate180: 2, Rotate270: 3 });
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** @typedef {{ W: number, H: number, rot: number, flip: number, cos: number, sin: number, cx: number, cy: number, ow: number, oh: number, h: number[], lens: Float32Array, head: number, spots?: Float32Array | null }} Geo
 * the sensor's size; quarter turns; flips (1 across, 2 down); the straighten angle; the crop's centre in the
 * upright picture; the picture's size; the perspective's 3 × 3; the lens table and its largest gain */

/** A photo's geometry. @param {any} meta the decoder's (orientation, fullWidth, fullHeight, lens)
 * @param {{ distortion?: number, vignetting?: number, crop?: import('./crop.js').Crop | null }} [o] the lens corrections added by
 * hand, each −1..1; the crop (none: the whole upright picture) @returns {Geo} */
export function geometry(meta, o = {}) {
  const W = meta.fullWidth, H = meta.fullHeight, rot = ROT[meta.orientation] || 0, [uw, uh] = rot % 2 ? [H, W] : [W, H];
  const lens = lensTable(meta.lens || null, W, H, o.distortion || 0, o.vignetting || 0) || new Float32Array(N * 4).fill(1);
  let head = 1;
  for (let j = 3; j < lens.length; j += 4) head = Math.max(head, lens[j]);
  if (!o.crop || isNone(o.crop)) return { W, H, rot, flip: 0, cos: 1, sin: 0, cx: uw / 2, cy: uh / 2, ow: uw, oh: uh, h: IDENTITY, lens, head };
  // the crop's frame in its box, enlarged (cos holds the enlargement: the crop's own turns and flips are in its 3 × 3);
  // the picture's size in whole editing-copy pixels
  const c = frame(o.crop, uw, uh), cell = W / meta.width || 3, whole = (/** @type {number} */ v) => Math.max(8 * cell, Math.round(v / cell) * cell);
  return { W, H, rot, flip: 0, cos: c.mag, sin: 0, cx: c.rect.x + c.rect.w / 2, cy: c.rect.y + c.rect.h / 2, ow: whole(c.ow), oh: whole(c.oh), h: c.h, lens, head };
}
/** Where a point of the picture was recorded on the sensor (both in sensor pixels, a pixel's middle at .5).
 * @param {Geo} g @param {number} x @param {number} y @param {number} [colour] 0 red, 1 green, 2 blue */
export function toSensor(g, x, y, colour = 1) {
  const dx = x - g.ow / 2, dy = y - g.oh / 2, [uw, uh] = g.rot % 2 ? [g.H, g.W] : [g.W, g.H], m = g.h;
  let ux = g.cx + dx * g.cos - dy * g.sin, uy = g.cy + dx * g.sin + dy * g.cos;
  const q = m[6] * ux + m[7] * uy + m[8]; [ux, uy] = [(m[0] * ux + m[1] * uy + m[2]) / q, (m[3] * ux + m[4] * uy + m[5]) / q];
  if (g.flip & 1) ux = uw - ux;
  if (g.flip & 2) uy = uh - uy;
  return fromUpright(g, ux, uy, colour);
}
/** From a point of the upright, uncropped picture (in its pixels) to the sensor: back through the quarter turns,
 * then along the lens table. @param {Geo} g @param {number} ux @param {number} uy @param {number} [colour] */
export function fromUpright(g, ux, uy, colour = 1) {
  const [sx, sy] = [[ux, uy], [uy, g.H - ux], [g.W - ux, g.H - uy], [g.W - uy, ux]][g.rot];
  const vx = sx - g.W / 2, vy = sy - g.H / 2, t = Math.min(1, Math.hypot(vx, vy) / Math.hypot(g.W / 2, g.H / 2) / REACH) * (N - 1), i = Math.min(N - 2, Math.floor(t));
  const k = g.lens[i * 4 + colour] + (g.lens[(i + 1) * 4 + colour] - g.lens[i * 4 + colour]) * (t - i);
  return [g.W / 2 + vx * k, g.H / 2 + vy * k];
}
/** The sensor rectangle a rectangle of the picture draws on: [x, y, w, h], whole pixels, with room for the
 * resampling's neighbours and noise reduction's neighbourhoods (denoise.js), kept on the sensor. @param {Geo} g @param {number} X @param {number} Y @param {number} w @param {number} h */
export function reach(g, X, Y, w, h) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const see = (/** @type {number} */ x, /** @type {number} */ y) => { for (const c of [0, 2]) { const [sx, sy] = toSensor(g, x, y, c); x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); } };
  for (let i = 0; i <= 16; i++) { see(X + (w * i) / 16, Y); see(X + (w * i) / 16, Y + h); see(X, Y + (h * i) / 16); see(X + w, Y + (h * i) / 16); }
  const PAD = 36, ax = Math.max(0, Math.floor(x0) - PAD), ay = Math.max(0, Math.floor(y0) - PAD);
  return [ax, ay, Math.max(8, Math.min(g.W, Math.ceil(x1) + PAD) - ax), Math.max(8, Math.min(g.H, Math.ceil(y1) + PAD) - ay)];
}

const WGSL = /* wgsl */ `
struct G { out: vec4f,    // this pass's first pixel in the picture (x, y); picture pixels to one of this pass's; unused
           pic: vec4f,    // the picture's size; the cosine and sine of its straighten angle
           crop: vec4f,   // the crop's centre in the upright picture; the upright picture's size
           h0: vec4f, h1: vec4f, h2: vec4f,   // the perspective, a row each
           src: vec4f,    // the source's first pixel on the sensor (x, y); sensor pixels to one of its; 1 / the largest gain
           sen: vec4f,    // the sensor's size; unused
           dims: vec4u,   // this pass's size; the source's size
           mode: vec4u,   // quarter turns; flips (1 across, 2 down); 1: fine (cubic, each colour from its own place), 2: fine, the colours already in place; spots to retouch
           lens: array<vec4f, ${N}>,     // by distance from the centre: red, green and blue's shift, the gain
           sp: array<vec4f, ${SPOTS * SPOT_ROWS}> };   // retouching (heal.js), for the editing copy: the sensor's own pixels come already retouched
@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<uniform> g: G;
@group(0) @binding(2) var<storage, read_write> dst: array<u32>;
fn word(q: vec2i, k: u32) -> u32 { let c = clamp(q, vec2i(0), vec2i(g.dims.zw) - 1); return src[(u32(c.y) * g.dims.z + u32(c.x)) * 2u + k]; }
fn own(q: vec2i, colour: u32) -> f32 { if (colour == 2u) { return f32(word(q, 1u) & 0xffffu); } return f32((word(q, 0u) >> (16u * colour)) & 0xffffu); }
${mendWGSL('g.sp', 'g.mode.w')}
// one colour of one of the source's pixels: its own, or near a retouched spot what the spot puts there
fn one(q: vec2i, colour: u32) -> f32 {
  var v = own(q, colour); if (near == 0u) { return v; }
  let s = (vec2f(q) + 0.5) * g.src.z + g.src.xy;
  for (var i = 0u; i < g.mode.w; i++) { if ((near & (1u << i)) == 0u) { continue; } let k = spot(i, s, colour); if (k.x > 0.0) { v = mix(v, own(q + vec2i(g.sp[i * ${SPOT_ROWS}u + 1u].xy / g.src.z), colour) * k.y, k.x); } }
  return v;
}
fn cubic(t: f32) -> vec4f { let t2 = t * t; let t3 = t2 * t; return vec4f(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2); }
// one colour at a place on the sensor: between the four pixels around it, or (fine) a cubic through sixteen, held
// between the brightest and darkest of the middle four so an edge doesn't ring
fn sample(s: vec2f, colour: u32) -> f32 {
  let b = (s - g.src.xy) / g.src.z - 0.5; let i = vec2i(floor(b)); let f = b - floor(b);
  let a = one(i, colour); let c = one(i + vec2i(1, 0), colour); let d = one(i + vec2i(0, 1), colour); let e = one(i + vec2i(1, 1), colour);
  if (g.mode.z == 0u) { return mix(mix(a, c, f.x), mix(d, e, f.x), f.y); }
  let wx = cubic(f.x); let wy = cubic(f.y); var sum = 0.0;
  for (var y = 0; y < 4; y++) { var row = 0.0; for (var x = 0; x < 4; x++) { row += wx[x] * one(i + vec2i(x - 1, y - 1), colour); } sum += wy[y] * row; }
  return clamp(sum, min(min(a, c), min(d, e)), max(max(a, c), max(d, e)));
}
@compute @workgroup_size(8, 8)
fn warp(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= g.dims.x || id.y >= g.dims.y) { return; }
  let d = (vec2f(id.xy) + 0.5) * g.out.z + g.out.xy - 0.5 * g.pic.xy;
  var u = g.crop.xy + vec2f(d.x * g.pic.z - d.y * g.pic.w, d.x * g.pic.w + d.y * g.pic.z);
  let q = vec3f(dot(g.h0.xyz, vec3f(u, 1.0)), dot(g.h1.xyz, vec3f(u, 1.0)), dot(g.h2.xyz, vec3f(u, 1.0))); u = q.xy / q.z;
  if ((g.mode.y & 1u) != 0u) { u.x = g.crop.z - u.x; }
  if ((g.mode.y & 2u) != 0u) { u.y = g.crop.w - u.y; }
  var s = u;
  switch (g.mode.x) { case 1u: { s = vec2f(u.y, g.sen.y - u.x); } case 2u: { s = g.sen.xy - u; } case 3u: { s = vec2f(g.sen.x - u.y, u.x); } default: {} }
  let c = 0.5 * g.sen.xy; let v = s - c; let t = min(1.0, length(v) / length(c) / ${REACH}) * ${N - 1}.0; let j = min(u32(t), ${N - 2}u);
  let k = mix(g.lens[j], g.lens[j + 1u], t - f32(j));
  let at = c + v * k.g;
  nearby(at, 6.0 * g.src.z);
  var raw = vec3f(sample(at, 0u), sample(at, 1u), sample(at, 2u));
  if (g.mode.z == 1u) { raw.r = sample(c + v * k.r, 0u); raw.b = sample(c + v * k.b, 2u); }   // 2: the demosaic has laid red and blue on green's places already
  let n = vec2i(floor((at - g.src.xy) / g.src.z - 0.5));   // a colour the sensor clipped in any of the four pixels around stays marked
  let bits = ((word(n, 1u) | word(n + vec2i(1, 0), 1u) | word(n + vec2i(0, 1), 1u) | word(n + vec2i(1, 1), 1u)) >> 16u) & 7u;
  let o = vec3u(clamp(raw * (k.a * g.src.w), vec3f(0.0), vec3f(65535.0)) + 0.5);
  let i = (id.y * g.dims.x + id.x) * 2u;
  dst[i] = o.r | (o.g << 16u); dst[i + 1u] = o.b | (bits << 16u);
}`;
const SIZE = 160 + N * 16 + SPOTS * SPOT_ROWS * 16;   // the pass's settings in bytes (struct G)
export const warpPipe = (/** @type {GPUDevice} */ device) => device.createComputePipelineAsync({ layout: 'auto', compute: { module: device.createShaderModule({ code: WGSL }), entryPoint: 'warp' } });

/** A pass from a source buffer (the editing copy, or a demosaiced rectangle) to a buffer laid out as the picture.
 * @param {GPUDevice} device @param {GPUComputePipeline} pipe @param {GPUBuffer} src @param {GPUBuffer} dst */
export function warper(device, pipe, src, dst) {
  const uni = device.createBuffer({ size: SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bind = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: src } }, { binding: 1, resource: { buffer: uni } }, { binding: 2, resource: { buffer: dst } }] });
  return {
    /** @param {GPUCommandEncoder} enc @param {Geo} g
     * @param {{ x: number, y: number, scale: number, w: number, h: number }} to this pass's part of the picture, and its size in its own pixels
     * @param {{ x: number, y: number, scale: number, w: number, h: number }} from the source's place on the sensor, likewise @param {boolean} [fine]
     * @param {boolean} [mend] retouch here (the editing copy): the geometry's spots are laid in
     * @param {boolean} [aligned] the source's red and blue are on green's places already (the demosaic undid the lens's fringing) */
    run(enc, g, to, from, fine = true, mend = false, aligned = false) {
      const b = new ArrayBuffer(SIZE), f = new Float32Array(b), n = new Uint32Array(b), [uw, uh] = g.rot % 2 ? [g.H, g.W] : [g.W, g.H], m = g.h;
      f.set([to.x, to.y, to.scale, 0, g.ow, g.oh, g.cos, g.sin, g.cx, g.cy, uw, uh, m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, from.x, from.y, from.scale, 1 / g.head, g.W, g.H, 0, 0]);
      n.set([to.w, to.h, from.w, from.h, g.rot, g.flip, fine ? (aligned ? 2 : 1) : 0, mend && g.spots ? g.spots[0] : 0], 32); f.set(g.lens, 40);
      if (mend && g.spots) f.set(g.spots.subarray(4), 40 + N * 4);
      device.queue.writeBuffer(uni, 0, b);
      const pass = enc.beginComputePass();
      pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(Math.ceil(to.w / 8), Math.ceil(to.h / 8)); pass.end();
    },
    destroy: () => uni.destroy(),
  };
}
