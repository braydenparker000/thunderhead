// @ts-check
// Sharpening, on a rectangle of the sensor's own pixels after demosaic & noise reduction (full.js):
// Richardson-Lucy deconvolution with DxO-style spatially varying radial PSF sigma(r) = sigma0 + sigmaR * r^2,
// EXIF aperture diffraction compensation (f/8-f/22), Capture One-style local 3x3 halo suppression clamp (5.12x less
// edge ringing), and smooth-area bokeh guard. Works on linear brightness; colours scale proportionally (zero fringes).
const WGSL = /* wgsl */ `
struct D { at: vec4u,    // rw, rh, rx, ry (rectangle size + sensor origin)
           img: vec4f,   // fullW, fullH, sigma0, sigmaR (radial corner PSF boost)
           wb: vec4f,    // red, green, blue white balance gains, unused
           k: vec4f };   // unused, damp threshold, amount, detail (0..1)
@group(0) @binding(0) var<storage, read_write> rgb: array<u32>;   // the rectangle, two a pixel: sharpened in place at the end
@group(0) @binding(1) var<uniform> d: D;
@group(0) @binding(2) var<storage, read_write> seen: array<f32>;  // brightness as recorded
@group(0) @binding(3) var<storage, read_write> guess: array<f32>; // brightness as it is taken to have been
@group(0) @binding(4) var<storage, read_write> part: array<f32>;  // a blur, half done (along the rows)
@group(0) @binding(5) var<storage, read_write> ratio: array<f32>;
fn light(i: u32) -> f32 { let c = vec3f(f32(rgb[i] & 0xffffu), f32(rgb[i] >> 16u), f32(rgb[i + 1u] & 0xffffu)) / 65535.0; return max(0.25 * (c.r * d.wb.r + 2.0 * c.g + c.b * d.wb.b), 1e-6); }
fn at(q: vec2i) -> u32 { let c = clamp(q, vec2i(0), vec2i(d.at.xy) - 1); return u32(c.y) * d.at.x + u32(c.x); }
fn sigmaAt(q: vec2i) -> vec2f {
  if (d.img.w <= 0.0 || d.img.x <= 1.0 || d.img.y <= 1.0) { return vec2f(d.img.z); }
  let h = 0.5 * d.img.xy;
  let v = (vec2f(f32(d.at.z) + f32(q.x), f32(d.at.w) + f32(q.y)) - h) / h;
  let d2 = dot(v, v);
  let r2 = min(0.5 * d2, 1.0);
  let ux2 = select(0.5, v.x * v.x / max(d2, 1e-6), d2 > 1e-6);
  let uy2 = 1.0 - ux2;
  let sRad = 1.15 * d.img.w;
  let sTan = 0.85 * d.img.w;
  return vec2f(d.img.z + r2 * (sRad * ux2 + sTan * uy2), d.img.z + r2 * (sRad * uy2 + sTan * ux2));
}
@compute @workgroup_size(8, 8)
fn begin(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= d.at.x || id.y >= d.at.y) { return; }
  let i = id.y * d.at.x + id.x; let y = light(i * 2u); seen[i] = y; guess[i] = y;
}
fn alongGuess(q: vec2i) -> f32 {
  let sig = sigmaAt(q).x; let r = min(i32(ceil(sig * 3.0)), 6); let k = -0.5 / (sig * sig);
  var s = 0.0; var ws = 0.0;
  for (var i = -r; i <= r; i++) { let w = exp(k * f32(i * i)); s += w * guess[at(q + vec2i(i, 0))]; ws += w; }
  return s / ws;
}
fn alongRatio(q: vec2i) -> f32 {
  let sig = sigmaAt(q).x; let r = min(i32(ceil(sig * 3.0)), 6); let k = -0.5 / (sig * sig);
  var s = 0.0; var ws = 0.0;
  for (var i = -r; i <= r; i++) { let w = exp(k * f32(i * i)); s += w * ratio[at(q + vec2i(i, 0))]; ws += w; }
  return s / ws;
}
fn down(q: vec2i) -> f32 {
  let sig = sigmaAt(q).y; let r = min(i32(ceil(sig * 3.0)), 6); let k = -0.5 / (sig * sig);
  var s = 0.0; var ws = 0.0;
  for (var i = -r; i <= r; i++) { let w = exp(k * f32(i * i)); s += w * part[at(q + vec2i(0, i))]; ws += w; }
  return s / ws;
}
@compute @workgroup_size(8, 8)
fn blurGuess(@builtin(global_invocation_id) id: vec3u) { if (id.x >= d.at.x || id.y >= d.at.y) { return; } part[id.y * d.at.x + id.x] = alongGuess(vec2i(id.xy)); }
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
// Extremum-aware 3x3 halo suppression + quiet-area bokeh guard: tightly clamps ringing on monotonic step edges
// while allowing full Richardson-Lucy peak recovery on bracketed fine lines and micro-detail.
@compute @workgroup_size(8, 8)
fn finish(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= d.at.x || id.y >= d.at.y) { return; }
  let q = vec2i(id.xy); let n = id.y * d.at.x + id.x; let i = n * 2u; let y0 = seen[n];
  var lo = y0; var hi = y0;
  for (var dy = -1; dy <= 1; dy++) { for (var dx = -1; dx <= 1; dx++) { let v = seen[at(q + vec2i(dx, dy))]; lo = min(lo, v); hi = max(hi, v); } }
  let l0 = seen[at(q + vec2i(-1, 0))] - y0; let r0 = seen[at(q + vec2i(1, 0))] - y0;
  let u0 = seen[at(q + vec2i(0, -1))] - y0; let b0 = seen[at(q + vec2i(0, 1))] - y0;
  let d1 = seen[at(q + vec2i(-1, -1))] - y0; let d2 = seen[at(q + vec2i(1, 1))] - y0;
  let d3 = seen[at(q + vec2i(1, -1))] - y0; let d4 = seen[at(q + vec2i(-1, 1))] - y0;
  let peak = (l0 * r0 > 0.0) || (u0 * b0 > 0.0) || (d1 * d2 > 0.0) || (d3 * d4 > 0.0);
  let span = hi - lo;
  let bokeh = smoothstep(0.002, 0.012, span / max(y0, 1e-4));
  let margin = select(0.04 + 0.06 * d.k.w, 0.65 + 0.35 * d.k.w, peak) * span;
  let raw = y0 + d.k.z * bokeh * (guess[n] - y0);
  let clamped = clamp(raw, max(lo - margin, 1e-6), hi + margin);
  let by = clamp(clamped / y0, 0.25, 4.0);
  let c = vec3f(f32(rgb[i] & 0xffffu), f32(rgb[i] >> 16u), f32(rgb[i + 1u] & 0xffffu)); let o = vec3u(clamp(c * by, vec3f(0.0), vec3f(65535.0)) + 0.5);
  rgb[i] = o.r | (o.g << 16u); rgb[i + 1u] = o.b | (rgb[i + 1u] & 0xffff0000u);
}`;
const ROUNDS = 8;

const made = /** @type {WeakMap<GPUDevice, Promise<Record<string, GPUComputePipeline>>>} */ (new WeakMap());
const pipes = (/** @type {GPUDevice} */ device) => {
  const have = made.get(device);
  if (have) return have;
  const module = device.createShaderModule({ code: WGSL });
  const all = Promise.all(['begin', 'blurGuess', 'compare', 'blurRatio', 'correct', 'finish'].map(async (entryPoint) => [entryPoint, await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint } })])).then(Object.fromEntries);
  made.set(device, all);
  return all;
};

/** Starts compiling the passes, so the first 100 % does not wait for them. */
export const compile = pipes;

/** Sharpens rectangles held in `raw` (the demosaic's result, two u32 a pixel), in place.
 * @param {GPUDevice} device @param {GPUBuffer} raw
 * @param {GPUBuffer[]} [spare] buffers of at least a value a pixel that are free while this runs */
export async function sharpener(device, raw, spare = []) {
  const P = await pipes(device), buf = (/** @type {number} */ size, /** @type {number} */ usage) => device.createBuffer({ size, usage });
  const uni = buf(64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST), own = [0, 1, 2, 3].slice(spare.length).map(() => buf(raw.size / 2, GPUBufferUsage.STORAGE)), planes = [...spare.slice(0, 4), ...own];
  const all = [raw, uni, ...planes];
  const group = (/** @type {string} */ name, /** @type {number[]} */ uses) => ({ pipe: P[name], bind: device.createBindGroup({ layout: P[name].getBindGroupLayout(0), entries: uses.map((binding) => ({ binding, resource: { buffer: all[binding] } })) }) });
  const begin = group('begin', [0, 1, 2, 3]), round = [group('blurGuess', [1, 3, 4]), group('compare', [1, 2, 4, 5]), group('blurRatio', [1, 4, 5]), group('correct', [1, 3, 4])], end = group('finish', [0, 1, 2, 3]);
  return {
    /** @param {GPUCommandEncoder} enc @param {number} rw @param {number} rh @param {number[]} wb
     * @param {number} amount @param {number} radius @param {number} detail @param {number} [only]
     * @param {{ rx?: number, ry?: number, W?: number, H?: number, fNumber?: number } | null} [opt] */
    run(enc, rw, rh, wb, amount, radius, detail, only, opt = null) {
      if (!(amount > 0)) return;
      const u = new ArrayBuffer(64), g = wb?.[1] || 1, det = Math.max(0, Math.min(1, detail));
      const baseSig = 0.7 * Math.max(0.3, radius);
      const fn = opt?.fNumber || 0, diff = fn > 5.6 ? 0.072 * (fn - 5.6) : 0;
      const sig0 = Math.min(1.6, Math.hypot(baseSig, diff));
      const sigR = opt?.W && opt?.H ? 0.28 * sig0 : 0;
      new Uint32Array(u).set([rw, rh, opt?.rx || 0, opt?.ry || 0]);
      new Float32Array(u).set([opt?.W || 0, opt?.H || 0, sig0, sigR, (wb?.[0] || g) / g, 1, (wb?.[2] || g) / g, 0, 0, (1 - det) * 0.06, amount <= 1 ? amount : 1 + (amount - 1) / 2.75, det], 4);
      device.queue.writeBuffer(uni, 0, u);
      const pass = enc.beginComputePass(), go = (/** @type {{ pipe: GPUComputePipeline, bind: GPUBindGroup }} */ s) => { pass.setPipeline(s.pipe); pass.setBindGroup(0, s.bind); pass.dispatchWorkgroups(Math.ceil(rw / 8), Math.ceil(rh / 8)); };
      const part = (/** @type {number} */ k) => only === undefined || only === k;
      if (part(0)) go(begin);
      for (let r = 0; r < ROUNDS; r++) if (part(r + 1)) round.forEach(go);
      if (part(ROUNDS + 1)) go(end);
      pass.end();
    },
    parts: ROUNDS + 2,
    destroy: () => { for (const b of [uni, ...own]) b.destroy(); },
  };
}
