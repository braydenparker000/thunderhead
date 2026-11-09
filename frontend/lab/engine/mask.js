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
import { CELL, HEAD } from './wgsl.js';

const WGSL = /* wgsl */ `${HEAD}
@group(0) @binding(2) var mOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(3) var mIn: texture_2d<f32>;
const R = 8;        // how far an area reaches, in cells each way: 17 cells, about 5 % of the long side
const SOFT = 2;     // the blur before the variance is taken, in cells each way: texture finer than this is no edge
const EPS = 1.0;    // stops²: the variance at which the mask goes half-way from the area's mean to the pixel's own
// a cell's brightness: log2 of its pixels' mean luminance
@compute @workgroup_size(8, 8)
fn down(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(mOut))) { return; }
  let lo = id.xy * CELL; let hi = min(lo + CELL, p.size.xy); var s = 0.0;
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
}`;

/** The mask's compiled passes, made once for the device. @param {GPUDevice} device */
export async function maskPipes(device) {
  const module = device.createShaderModule({ code: WGSL });
  const [down, softH, softV, boxH, boxAB, boxV] = await Promise.all(['down', 'softH', 'softV', 'boxH', 'boxAB', 'boxV'].map((entryPoint) => device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint } })));
  return { down, softH, softV, boxH, boxAB, boxV };
}

/** One photo's mask: two small textures and the steps between them (brightness → its light blur → box along rows → box
 * down columns, to slope and offset → the same box over those). `run` adds the steps to a frame's commands; the
 * result is behind `view`.
 * @param {GPUDevice} device @param {Awaited<ReturnType<typeof maskPipes>>} pipes
 * @param {GPUBuffer} src the editing copy @param {GPUBuffer} uni the frame's settings @param {number} w @param {number} h */
export function toneMask(device, pipes, src, uni, w, h) {
  const size = [Math.ceil(w / CELL), Math.ceil(h / CELL)];
  const tex = [0, 1].map(() => device.createTexture({ size, format: 'rgba32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING }));
  const [a, b] = tex.map((t) => t.createView());
  const group = (/** @type {GPUComputePipeline} */ pipe, /** @type {GPUBindGroupEntry[]} */ entries) => ({ pipe, bind: device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries }) });
  const io = (/** @type {GPUTextureView} */ i, /** @type {GPUTextureView} */ o) => [{ binding: 3, resource: i }, { binding: 2, resource: o }];
  const steps = [group(pipes.down, [{ binding: 0, resource: { buffer: src } }, { binding: 1, resource: { buffer: uni } }, { binding: 2, resource: a }]),
    group(pipes.softH, io(a, b)), group(pipes.softV, io(b, a)), group(pipes.boxH, io(a, b)), group(pipes.boxAB, io(b, a)), group(pipes.boxH, io(a, b)), group(pipes.boxV, io(b, a))];
  /** @param {GPUCommandEncoder} enc */
  const run = (enc) => {
    const pass = enc.beginComputePass();
    for (const s of steps) { pass.setPipeline(s.pipe); pass.setBindGroup(0, s.bind); pass.dispatchWorkgroups(Math.ceil(size[0] / 8), Math.ceil(size[1] / 8)); }
    pass.end();
  };
  return { view: a, run, destroy: () => tex.forEach((t) => t.destroy()) };
}
