// @ts-check
// The tone mask for Highlights and Shadows (the idea is darktable's tone equalizer): how bright each area of
// the photo is, in stops, smoothed across texture but not across edges. Highlights and Shadows add stops by the
// area's brightness, not the pixel's own, so detail inside a lifted shadow keeps its contrast and a darkened
// sky leaves no glow on the trees against it. The smoothing is a guided filter (He, Sun and Tang) on log2
// luminance, so it treats a stop alike in shadows and highlights, with two changes of ours that keep texture
// out of it: the variance that tells an edge from an even area is taken on a lightly blurred brightness, and
// the step from one to the other is squared. It is made at one eighth of the editing copy, where each cell
// ends up holding a slope and an offset; the frame pass turns those and the pixel's own log2 luminance into
// the area's brightness (wgsl.js, area()).
//
// Three masks are made this way. The tone mask, for Highlights, Shadows and Clarity (what a pixel adds to its
// area's brightness is the local contrast Clarity scales). A finer one for Texture: cells of 4 pixels, areas of
// 5 cells. And the haze mask for Dehaze (after He, Sun and Tang's dark channel, as in darktable's haze removal):
// how much of the air's light each area holds, the darkest colour share in its neighbourhood, smoothed by the
// same guided filter with the brightness as its guide.
import { HEAD } from './wgsl.js';

/** @param {{ cell: number, r: number, soft: number }} o cell size in pixels, an area's reach and the pre-blur's, in cells */
const wgsl = (o) => /* wgsl */ `${HEAD}
@group(0) @binding(2) var mOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(3) var mIn: texture_2d<f32>;
const MC = ${o.cell}u;   // a cell's side, in pixels
const R = ${o.r};        // how far an area reaches, in cells each way (the tone mask: 17 cells of 8, about 5 % of the long side)
const SOFT = ${o.soft};     // the blur before the variance is taken, in cells each way: texture finer than this is no edge
const EPS = 1.0;    // stops²: the variance at which the mask goes half-way from the area's mean to the pixel's own
// a cell's brightness: log2 of its pixels' mean luminance
@compute @workgroup_size(8, 8)
fn down(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(mOut))) { return; }
  let lo = id.xy * MC; let hi = min(lo + MC, p.size.xy); var s = 0.0;
  for (var y = lo.y; y < hi.y; y++) { for (var x = lo.x; x < hi.x; x++) { s += dot(pixel(x, y), LUM); } }
  textureStore(mOut, id.xy, vec4f(log2(max(s / f32((hi.x - lo.x) * (hi.y - lo.y)), FLOOR)), 0.0, 0.0, 1.0));
}
// the mean of the cells within r along one direction (along rows, then down columns: a box); cells off the frame don't count
fn box(at: vec2u, d: vec2i, r: i32) -> vec4f {
  let n = vec2i(textureDimensions(mIn)); var s = vec4f(0.0); var k = 0.0;
  for (var i = -r; i <= r; i++) { let q = vec2i(at) + d * i; if (all(q >= vec2i(0)) && all(q < n)) { s += textureLoad(mIn, q, 0); k += 1.0; } }
  return s / k;
}
// beside each cell's brightness, the same lightly blurred (softH, then softV), and that squared, for the variance
@compute @workgroup_size(8, 8)
fn softH(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(mIn))) { return; }
  let l = textureLoad(mIn, id.xy, 0).x; textureStore(mOut, id.xy, vec4f(l, box(id.xy, vec2i(1, 0), SOFT).x, 0.0, 1.0));
}
@compute @workgroup_size(8, 8)
fn softV(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(mIn))) { return; }
  let l = textureLoad(mIn, id.xy, 0).x; let s = box(id.xy, vec2i(0, 1), SOFT).y; textureStore(mOut, id.xy, vec4f(l, s, s * s, 1.0));
}
@compute @workgroup_size(8, 8)
fn boxH(@builtin(global_invocation_id) id: vec3u) { if (any(id.xy >= textureDimensions(mIn))) { return; } textureStore(mOut, id.xy, box(id.xy, vec2i(1, 0), R)); }
@compute @workgroup_size(8, 8)
fn boxV(@builtin(global_invocation_id) id: vec3u) { if (any(id.xy >= textureDimensions(mIn))) { return; } textureStore(mOut, id.xy, box(id.xy, vec2i(0, 1), R)); }
// from the box's mean and variance, the slope and offset: where brightness is even, or only textured, the slope
// is 0 and the offset the mean (the area's brightness is the box's); across an edge the slope nears 1 (it is
// the pixel's own). The guided filter's slope is v / (v + EPS); squaring both parts tells the two apart harder.
@compute @workgroup_size(8, 8)
fn boxAB(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(mIn))) { return; }
  let m = box(id.xy, vec2i(0, 1), R); let v = max(m.z - m.y * m.y, 0.0); let a = v * v / (v * v + EPS * EPS);
  textureStore(mOut, id.xy, vec4f(a, m.x * (1.0 - a), 0.0, 1.0));
}
// Haze. A cell's brightness beside its darkest colour, as a share of the air's light (p.air): haze lifts every colour.
@compute @workgroup_size(8, 8)
fn hazeDown(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(mOut))) { return; }
  let lo = id.xy * MC; let hi = min(lo + MC, p.size.xy); var s = 0.0; var d = 1.0;
  for (var y = lo.y; y < hi.y; y++) { for (var x = lo.x; x < hi.x; x++) { let c = pixel(x, y); s += dot(c, LUM); let q = c / p.air.rgb; d = min(d, min(q.r, min(q.g, q.b))); } }
  textureStore(mOut, id.xy, vec4f(log2(max(s / f32((hi.x - lo.x) * (hi.y - lo.y)), FLOOR)), max(d, 0.0), 0.0, 1.0));
}
// the darkest share within 2 cells (along rows, then down columns), then the products the guided filter averages
fn least(at: vec2u, d: vec2i) -> f32 {
  let n = vec2i(textureDimensions(mIn)); var m = 1.0;
  for (var i = -2; i <= 2; i++) { m = min(m, textureLoad(mIn, clamp(vec2i(at) + d * i, vec2i(0), n - 1), 0).y); }
  return m;
}
@compute @workgroup_size(8, 8)
fn minH(@builtin(global_invocation_id) id: vec3u) { if (any(id.xy >= textureDimensions(mIn))) { return; } textureStore(mOut, id.xy, vec4f(textureLoad(mIn, id.xy, 0).x, least(id.xy, vec2i(1, 0)), 0.0, 1.0)); }
@compute @workgroup_size(8, 8)
fn minV(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(mIn))) { return; }
  let l = textureLoad(mIn, id.xy, 0).x; let d = least(id.xy, vec2i(0, 1)); textureStore(mOut, id.xy, vec4f(l, d, l * l, l * d));
}
// the guided filter's slope and offset for the share, by brightness: share ≈ slope × brightness + offset
@compute @workgroup_size(8, 8)
fn hazeAB(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(mIn))) { return; }
  let m = box(id.xy, vec2i(0, 1), R); let a = (m.w - m.x * m.y) / (max(m.z - m.x * m.x, 0.0) + 0.1);
  textureStore(mOut, id.xy, vec4f(a, m.y - a * m.x, 0.0, 1.0));
}`;

const TONE = { cell: 8, r: 8, soft: 2 }, FINE = { cell: 4, r: 2, soft: 1 };
/** The masks' compiled passes, made once for the device. @param {GPUDevice} device */
export async function maskPipes(device) {
  const names = ['down', 'softH', 'softV', 'boxH', 'boxAB', 'boxV', 'hazeDown', 'minH', 'minV', 'hazeAB'];
  const make = async (/** @type {typeof TONE} */ o, /** @type {string[]} */ which) => { const module = device.createShaderModule({ code: wgsl(o) }); return Object.fromEntries(await Promise.all(which.map(async (entryPoint) => [entryPoint, await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint } })]))); };
  const [tone, fine] = await Promise.all([make(TONE, names), make(FINE, names.slice(0, 6))]);
  return { tone, fine };
}

/** One photo's masks: for each, two small textures and the steps between them (tone and fine: brightness → its
 * light blur → box along rows → box down columns, to slope and offset → the same box over those; haze: brightness
 * and darkest share → the least nearby → the same boxes). `tone.run` and the others add their steps to a frame's
 * commands; each result is behind its `view`.
 * @param {GPUDevice} device @param {Awaited<ReturnType<typeof maskPipes>>} pipes
 * @param {GPUBuffer} src the photo laid out as the picture @param {GPUBuffer} uni the frame's settings @param {number} w @param {number} h */
export function masks(device, pipes, src, uni, w, h) {
  const one = (/** @type {Record<string, GPUComputePipeline>} */ P, /** @type {number} */ cell, /** @type {string[]} */ order) => {
    const size = [Math.ceil(w / cell), Math.ceil(h / cell)];
    const tex = [0, 1].map(() => device.createTexture({ size, format: 'rgba32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING }));
    const v = tex.map((t) => t.createView());
    // the first step reads the photo; each later one reads what the one before wrote, to and fro between the two textures
    const steps = order.map((name, k) => ({ pipe: P[name], bind: device.createBindGroup({ layout: P[name].getBindGroupLayout(0), entries: k ? [{ binding: 3, resource: v[(k + 1) % 2] }, { binding: 2, resource: v[k % 2] }] : [{ binding: 0, resource: { buffer: src } }, { binding: 1, resource: { buffer: uni } }, { binding: 2, resource: v[0] }] }) }));
    return { view: v[(order.length + 1) % 2], destroy: () => tex.forEach((t) => t.destroy()),
      /** @param {GPUCommandEncoder} enc */
      run: (enc) => { const pass = enc.beginComputePass(); for (const s of steps) { pass.setPipeline(s.pipe); pass.setBindGroup(0, s.bind); pass.dispatchWorkgroups(Math.ceil(size[0] / 8), Math.ceil(size[1] / 8)); } pass.end(); } };
  };
  const smooth = ['down', 'softH', 'softV', 'boxH', 'boxAB', 'boxH', 'boxV'];
  const tone = one(pipes.tone, TONE.cell, smooth), fine = one(pipes.fine, FINE.cell, smooth), haze = one(pipes.tone, TONE.cell, ['hazeDown', 'minH', 'minV', 'boxH', 'hazeAB', 'boxH', 'boxV']);
  return { tone, fine, haze, destroy: () => { tone.destroy(); fine.destroy(); haze.destroy(); } };
}
