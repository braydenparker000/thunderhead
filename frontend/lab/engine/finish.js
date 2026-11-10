// @ts-check
// The last pass of a full-size view (full.js): sharpening, then the dither. Sharpening is only ever done on the
// sensor's own pixels (100 % and export): the editing copy is a third of their size, where it would not show.
// It is an unsharp mask on brightness, the standard one (Lightroom's Amount, Radius and Detail; RawTherapee's
// unsharp mask with its halo control): each pixel moves away from a Gaussian blur of its surroundings. Detail
// decides what counts: low, only clear edges are sharpened (small differences are mostly noise) and no edge
// may pass its neighbours' brightest and darkest; high, everything is and edges may overshoot a little.
import { DITHER } from './wgsl.js';

const wgsl = (/** @type {string} */ format) => /* wgsl */ `
struct F { size: vec4u,   // width, height, 1: dither, unused
           s: vec4f };    // amount, radius in pixels, detail 0..1, unused
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> f: F;
@group(0) @binding(2) var dst: texture_storage_2d<${format}, write>;
${DITHER}
const W = vec3f(0.2126, 0.7152, 0.0722);
fn lum(q: vec2i) -> f32 { return dot(textureLoad(src, clamp(q, vec2i(0), vec2i(f.size.xy) - 1), 0).rgb, W); }
@compute @workgroup_size(8, 8)
fn finish(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= f.size.x || id.y >= f.size.y) { return; }
  let at = vec2i(id.xy); var o = textureLoad(src, at, 0).rgb;
  if (f.s.x > 0.0) {
    let l = dot(o, W); let r = min(i32(ceil(f.s.y * 2.0)), 4); let k = -0.5 / (f.s.y * f.s.y);
    var sum = 0.0; var ws = 0.0; var lo = l; var hi = l;
    for (var y = -r; y <= r; y++) { for (var x = -r; x <= r; x++) {
      let v = lum(at + vec2i(x, y)); let w = exp(k * f32(x * x + y * y)); sum += w * v; ws += w;
      if (abs(x) <= 1 && abs(y) <= 1) { lo = min(lo, v); hi = max(hi, v); }
    } }
    var d = l - sum / ws;
    let quiet = (1.0 - f.s.z) * 0.012;   // differences under this are left alone
    d *= smoothstep(quiet * 0.5, quiet * 1.5 + 1e-6, abs(d));
    let over = 0.02 + 0.10 * f.s.z;      // how far past its neighbours an edge may go
    o += clamp(l + f.s.x * d, lo - over, hi + over) - l;
  }
  if (f.size.z != 0u) { o = dither(o, id.xy); }
  textureStore(dst, at, vec4f(o, 1.0));
}`;
const made = /** @type {WeakMap<GPUDevice, Record<string, Promise<GPUComputePipeline>>>} */ (new WeakMap());
/** The pass, compiled once for a device and an output format. @param {GPUDevice} device @param {'rgba8unorm' | 'rgba16float'} format */
export function finishPipe(device, format) {
  const mine = made.get(device) || {};
  made.set(device, mine);
  return (mine[format] ||= device.createComputePipelineAsync({ layout: 'auto', compute: { module: device.createShaderModule({ code: wgsl(format) }), entryPoint: 'finish' } }));
}
