// @ts-check
// Sharpening, on a rectangle of the sensor's own pixels after the demosaic and noise reduction (full.js): it only
// shows at 100 % and in an export. A lens, and the demosaic after it, spread each point of light over its
// neighbours; an unsharp mask answers by exaggerating edges, which reads as crisp but is not what was there.
// This takes the spreading back out: Richardson and Lucy's deconvolution (as RawTherapee's capture sharpening
// uses it), for a spread taken to be a Gaussian. Each round blurs the current guess as the lens would, compares
// that with what the sensor recorded, and corrects the guess by the blurred ratio of the two. It works on linear
// brightness, and each colour follows by the ratio brightness changed by, so no colour fringes are made.
// Measured on a known picture blurred by 0.8 of a pixel and laid out as a mosaic: the unsharp mask won back
// 0.9 dB of it, this 4 dB; with ISO 1600 noise 0.5 dB against 2 dB (engine/raw/quality/, sharp.mjs).
const WGSL = /* wgsl */ `
struct D { at: vec4u,    // the rectangle's width and height
           wb: vec4f,    // what brings red, green and blue to one scale
           k: vec4f };   // the spread's sigma in pixels, how small a correction is held back as noise, how much of the result is taken (1: all), unused
@group(0) @binding(0) var<storage, read_write> rgb: array<u32>;   // the rectangle, two a pixel: sharpened in place at the end
@group(0) @binding(1) var<uniform> d: D;
@group(0) @binding(2) var<storage, read_write> seen: array<f32>;  // brightness as recorded
@group(0) @binding(3) var<storage, read_write> guess: array<f32>; // brightness as it is taken to have been
@group(0) @binding(4) var<storage, read_write> part: array<f32>;  // a blur, half done (along the rows)
@group(0) @binding(5) var<storage, read_write> ratio: array<f32>;
fn light(i: u32) -> f32 { let c = vec3f(f32(rgb[i] & 0xffffu), f32(rgb[i] >> 16u), f32(rgb[i + 1u] & 0xffffu)) / 65535.0; return max(0.25 * (c.r * d.wb.r + 2.0 * c.g + c.b * d.wb.b), 1e-6); }
fn at(q: vec2i) -> u32 { let c = clamp(q, vec2i(0), vec2i(d.at.xy) - 1); return u32(c.y) * d.at.x + u32(c.x); }
@compute @workgroup_size(8, 8)
fn begin(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= d.at.x || id.y >= d.at.y) { return; }
  let i = id.y * d.at.x + id.x; let y = light(i * 2u); seen[i] = y; guess[i] = y;
}
// one half of a Gaussian blur: along the rows of the guess, or of the ratio
fn alongGuess(q: vec2i) -> f32 { let r = i32(ceil(d.k.x * 3.0)); let k = -0.5 / (d.k.x * d.k.x); var s = 0.0; var ws = 0.0; for (var i = -r; i <= r; i++) { let w = exp(k * f32(i * i)); s += w * guess[at(q + vec2i(i, 0))]; ws += w; } return s / ws; }
fn alongRatio(q: vec2i) -> f32 { let r = i32(ceil(d.k.x * 3.0)); let k = -0.5 / (d.k.x * d.k.x); var s = 0.0; var ws = 0.0; for (var i = -r; i <= r; i++) { let w = exp(k * f32(i * i)); s += w * ratio[at(q + vec2i(i, 0))]; ws += w; } return s / ws; }
// the other half: down the columns of what the first half left
fn down(q: vec2i) -> f32 { let r = i32(ceil(d.k.x * 3.0)); let k = -0.5 / (d.k.x * d.k.x); var s = 0.0; var ws = 0.0; for (var i = -r; i <= r; i++) { let w = exp(k * f32(i * i)); s += w * part[at(q + vec2i(0, i))]; ws += w; } return s / ws; }
@compute @workgroup_size(8, 8)
fn blurGuess(@builtin(global_invocation_id) id: vec3u) { if (id.x >= d.at.x || id.y >= d.at.y) { return; } part[id.y * d.at.x + id.x] = alongGuess(vec2i(id.xy)); }
// what was recorded against the guess as the lens would have shown it; a correction within the noise is held back
@compute @workgroup_size(8, 8)
fn compare(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= d.at.x || id.y >= d.at.y) { return; }
  let i = id.y * d.at.x + id.x; var q = seen[i] / max(down(vec2i(id.xy)), 1e-6);
  if (d.k.y > 0.0) { let t = abs(q - 1.0) / d.k.y; q = 1.0 + (q - 1.0) * min(1.0, t * t); }
  ratio[i] = q;
}
@compute @workgroup_size(8, 8)
fn blurRatio(@builtin(global_invocation_id) id: vec3u) { if (id.x >= d.at.x || id.y >= d.at.y) { return; } part[id.y * d.at.x + id.x] = alongRatio(vec2i(id.xy)); }
@compute @workgroup_size(8, 8)
fn correct(@builtin(global_invocation_id) id: vec3u) { if (id.x >= d.at.x || id.y >= d.at.y) { return; } let i = id.y * d.at.x + id.x; guess[i] = guess[i] * down(vec2i(id.xy)); }
// each colour moves by the ratio brightness moved by (never more than fourfold); what clipped stays as it was
@compute @workgroup_size(8, 8)
fn finish(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= d.at.x || id.y >= d.at.y) { return; }
  let n = id.y * d.at.x + id.x; let i = n * 2u; let by = clamp(1.0 + d.k.z * (guess[n] / seen[n] - 1.0), 0.25, 4.0);
  let c = vec3f(f32(rgb[i] & 0xffffu), f32(rgb[i] >> 16u), f32(rgb[i + 1u] & 0xffffu)); let o = vec3u(clamp(c * by, vec3f(0.0), vec3f(65535.0)) + 0.5);
  rgb[i] = o.r | (o.g << 16u); rgb[i + 1u] = o.b | (rgb[i + 1u] & 0xffff0000u);
}`;
const ROUNDS = 8;   // measured: with noise in the picture, 6 to 15 rounds end within 0.2 dB of each other

const made = /** @type {WeakMap<GPUDevice, Promise<Record<string, GPUComputePipeline>>>} */ (new WeakMap());
const pipes = (/** @type {GPUDevice} */ device) => {
  const have = made.get(device);
  if (have) return have;
  const module = device.createShaderModule({ code: WGSL });
  const all = Promise.all(['begin', 'blurGuess', 'compare', 'blurRatio', 'correct', 'finish'].map(async (entryPoint) => [entryPoint, await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint } })])).then(Object.fromEntries);
  made.set(device, all);
  return all;
};

/** Sharpens rectangles held in `raw` (the demosaic's result, two u32 a pixel), in place.
 * @param {GPUDevice} device @param {GPUBuffer} raw
 * @param {GPUBuffer[]} [spare] three buffers of at least a value a pixel that are free while this runs (the noise reduction's): saves making its own */
export async function sharpener(device, raw, spare = []) {
  const P = await pipes(device), buf = (/** @type {number} */ size, /** @type {number} */ usage) => device.createBuffer({ size, usage });
  const uni = buf(48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST), own = [0, 1, 2, 3].slice(spare.length).map(() => buf(raw.size / 2, GPUBufferUsage.STORAGE)), planes = [...spare.slice(0, 4), ...own];   // seen, guess, part, ratio: a value a pixel
  const all = [raw, uni, ...planes];
  const group = (/** @type {string} */ name, /** @type {number[]} */ uses) => ({ pipe: P[name], bind: device.createBindGroup({ layout: P[name].getBindGroupLayout(0), entries: uses.map((binding) => ({ binding, resource: { buffer: all[binding] } })) }) });
  const begin = group('begin', [0, 1, 2, 3]), round = [group('blurGuess', [1, 3, 4]), group('compare', [1, 2, 4, 5]), group('blurRatio', [1, 4, 5]), group('correct', [1, 3, 4])], end = group('finish', [0, 1, 2, 3]);
  return {
    /** @param {GPUCommandEncoder} enc @param {number} rw @param {number} rh the rectangle's size @param {number[]} wb the shot's white balance
     * @param {number} amount Sharpening as the frame carries it (1 at the plate's 40: the spread taken out; less: part of that; more: past it)
     * @param {number} radius the plate's Radius (1: a spread of 0.7 of a pixel) @param {number} detail 0..1: how little is held back as noise */
    run(enc, rw, rh, wb, amount, radius, detail) {
      if (!(amount > 0)) return;
      const u = new ArrayBuffer(48), g = wb?.[1] || 1;
      new Uint32Array(u).set([rw, rh, 0, 0]); new Float32Array(u).set([(wb?.[0] || g) / g, 1, (wb?.[2] || g) / g, 0, 0.7 * Math.max(0.3, radius), (1 - Math.max(0, Math.min(1, detail))) * 0.06, amount <= 1 ? amount : 1 + (amount - 1) / 2.75, 0], 4);
      device.queue.writeBuffer(uni, 0, u);
      const pass = enc.beginComputePass(), go = (/** @type {{ pipe: GPUComputePipeline, bind: GPUBindGroup }} */ s) => { pass.setPipeline(s.pipe); pass.setBindGroup(0, s.bind); pass.dispatchWorkgroups(Math.ceil(rw / 8), Math.ceil(rh / 8)); };
      go(begin); for (let r = 0; r < ROUNDS; r++) round.forEach(go); go(end);
      pass.end();
    },
    destroy: () => { for (const b of [uni, ...own]) b.destroy(); },
  };
}
