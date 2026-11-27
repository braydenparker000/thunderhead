// @ts-check
// Noise reduction, on a rectangle of the sensor's own pixels after the demosaic (full.js): like sharpening it
// only shows at 100 % and in an export. Everything is measured against the sensor's own noise at the shot's
// ISO (noise.js): each value is first rescaled so that noise is the same size, 1, in shadows and highlights
// (the variance-stabilising transform darktable's profiled denoise uses), which makes one threshold right
// everywhere and at every ISO: at ISO 125 real detail is hundreds of times the noise and passes untouched.
//   colour    in that scale a pixel is a brightness and two colour differences. What the differences should
//             be given the brightness is read off the neighbourhood (a guided filter over cells of 8 pixels:
//             He, Sun and Tang), and a pixel's own are pulled to that the more, the nearer they already are:
//             within the noise they are replaced, far outside it (a real coloured thing) they are kept.
//             (Tried and dropped: a bilateral mean against the cells' own means. It blurred real colour
//             detail and scored 4 dB worse on a noise test.)
//   brightness a blur in two widening steps (à trous; Dammertz et al.) that mixes a pixel only with neighbours
//             that look like it: not by their own brightness against its own, which is itself noisy, but by the
//             3 × 3 patch round each against the patch round it (the weight of non-local means; Buades, Coll
//             and Morel). Measured at ISO 6400 it keeps about 0.4 dB more of the green than the single-value
//             weight did, nearly what a full non-local means finds, for a twelfth of its reads.
const WGSL = /* wgsl */ `
struct D { at: vec4u,    // the rectangle's width and height, its cells across and down
           a: vec4f, b: vec4f,   // the noise: a value x has variance a·x + b, for red, green, blue
           k: vec4f };   // how many times the noise a brightness difference may be and still be blurred; the same for colour; unused
@group(0) @binding(0) var<storage, read> inp: array<u32>;
@group(0) @binding(1) var<uniform> d: D;
@group(0) @binding(2) var<storage, read_write> outp: array<u32>;
@group(0) @binding(3) var<storage, read> sIn: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> sOut: array<vec4f>;
@group(0) @binding(5) var<storage, read> yIn: array<f32>;          // brightness, in the noise's own scale, a value a pixel
@group(0) @binding(6) var<storage, read_write> yOut: array<f32>;
@group(0) @binding(7) var<storage, read> cIn: array<u32>;          // packed half2 colour differences (r-g, b-g) in GAT scale
@group(0) @binding(8) var<storage, read_write> cOut: array<u32>;
const R = 2;          // a neighbourhood's reach in cells
const EPS = 2.0;      // how much brightness must vary across it before colour is taken to follow brightness
fn off() -> vec3f { return 0.375 + d.b.xyz / (d.a.xyz * d.a.xyz); }   // exact Generalized Anscombe offset (b is variance, not sigma)
fn steady(x: vec3f) -> vec3f { return 2.0 * sqrt(max(x / d.a.xyz + off(), vec3f(0.0))); }
fn back(y: vec3f) -> vec3f { let h = 0.5 * y; return max(d.a.xyz * (h * h - off()), vec3f(0.0)); }
fn px(q: vec2i) -> vec3f {
  let c = clamp(q, vec2i(0), vec2i(d.at.xy) - 1); let i = (u32(c.y) * d.at.x + u32(c.x)) * 2u;
  return steady(vec3f(f32(inp[i] & 0xffffu), f32(inp[i] >> 16u), f32(inp[i + 1u] & 0xffffu)) / 65535.0);
}
fn ycc(c: vec3f) -> vec3f { return vec3f(0.25 * (c.r + 2.0 * c.g + c.b), c.r - c.g, c.b - c.g); }
fn yAt(q: vec2i) -> f32 { let c = clamp(q, vec2i(0), vec2i(d.at.xy) - 1); return yIn[u32(c.y) * d.at.x + u32(c.x)]; }
fn cAt(q: vec2i) -> vec2f { let c = clamp(q, vec2i(0), vec2i(d.at.xy) - 1); return unpack2x16float(cIn[u32(c.y) * d.at.x + u32(c.x)]); }
// a cell's means: brightness, the two colour differences, brightness squared; then brightness times each difference
@compute @workgroup_size(8, 8)
fn stat(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= d.at.z || id.y >= d.at.w) { return; }
  let lo = id.xy * 8u; let hi = min(lo + 8u, d.at.xy); var s = vec4f(0.0); var t = vec2f(0.0);
  for (var y = lo.y; y < hi.y; y++) { for (var x = lo.x; x < hi.x; x++) {
    let idx = y * d.at.x + x; let y0 = yIn[idx]; let cbcr = unpack2x16float(cIn[idx]);
    s += vec4f(y0, cbcr, y0 * y0); t += y0 * cbcr;
  } }
  let n = f32((hi.x - lo.x) * (hi.y - lo.y)); let i = (id.y * d.at.z + id.x) * 2u;
  sOut[i] = s / n; sOut[i + 1u] = vec4f(t / n, 0.0, 0.0);
}
fn mean(at: vec2u, dir: vec2i, k: u32) -> vec4f {
  var s = vec4f(0.0); var n = 0.0;
  for (var j = -R; j <= R; j++) { let q = vec2i(at) + dir * j; if (all(q >= vec2i(0)) && all(q < vec2i(d.at.zw))) { s += sIn[(u32(q.y) * d.at.z + u32(q.x)) * 2u + k]; n += 1.0; } }
  return s / n;
}
@compute @workgroup_size(8, 8)
fn across(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= d.at.z || id.y >= d.at.w) { return; }
  let i = (id.y * d.at.z + id.x) * 2u; sOut[i] = mean(id.xy, vec2i(1, 0), 0u); sOut[i + 1u] = mean(id.xy, vec2i(1, 0), 1u);
}
// down the columns, then each colour difference as slope × brightness + offset
@compute @workgroup_size(8, 8)
fn fitted(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= d.at.z || id.y >= d.at.w) { return; }
  let m = mean(id.xy, vec2i(0, 1), 0u); let p = mean(id.xy, vec2i(0, 1), 1u);
  let a = (p.xy - m.x * m.yz) / (max(m.w - m.x * m.x, 0.0) + EPS); let i = (id.y * d.at.z + id.x) * 2u;
  sOut[i] = vec4f(a.x, m.y - a.x * m.x, a.y, m.z - a.y * m.x); sOut[i + 1u] = vec4f(0.0);
}
@compute @workgroup_size(8, 8)
fn down(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= d.at.z || id.y >= d.at.w) { return; }
  let i = (id.y * d.at.z + id.x) * 2u; sOut[i] = mean(id.xy, vec2i(0, 1), 0u); sOut[i + 1u] = vec4f(0.0);
}
fn cell(q: vec2i) -> vec4f { let c = clamp(q, vec2i(0), vec2i(d.at.zw) - 1); return sIn[(u32(c.y) * d.at.z + u32(c.x)) * 2u]; }
@compute @workgroup_size(8, 8)
fn lum(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= d.at.x || id.y >= d.at.y) { return; }
  let v = ycc(px(vec2i(id.xy))); let i = id.y * d.at.x + id.x;
  yOut[i] = v.x; cOut[i] = pack2x16float(v.yz);
}
// brightness: the pixels two each way, a hole apart, weighted by distance and by how alike the 3 × 3 patch of
// brightness round each is to the one round this pixel. Reads precomputed GAT yIn + packed cIn (zero sqrt in loop).
fn blur(at: vec2i, hole: i32, own: f32) -> vec3f {
  if (d.k.x <= 0.0) { return vec3f(yAt(at), cAt(at)); }
  var mine: array<f32, 9>;
  for (var k = 0; k < 9; k++) { mine[k] = yAt(at + vec2i(k % 3 - 1, k / 3 - 1)); }
  let w1 = vec3f(0.375, 0.25, 0.0625); let s2 = -1.0 / (d.k.x * d.k.x * 0.288); let sc = -0.5 / (d.k.x * d.k.x * 0.375); var sum = vec3f(0.0); var ws = vec2f(0.0);
  for (var y = -2; y <= 2; y++) { for (var x = -2; x <= 2; x++) {
    let q = at + vec2i(x, y) * hole; var far = 0.0;
    for (var k = 0; k < 9; k++) { let e = mine[k] - yAt(q + vec2i(k % 3 - 1, k / 3 - 1)); far += e * e; }
    let yq = yAt(q); let dy = yq - mine[4];
    let w = w1[abs(x)] * w1[abs(y)] * vec2f(exp(s2 * max(far / 9.0 - own, 0.0)), exp(sc * dy * dy));
    sum += vec3f(w.x * yq, w.y * cAt(q)); ws += w;
  } }
  return sum / ws.xyy;
}
fn put(at: vec2u, c: vec3f) {
  let i = (at.y * d.at.x + at.x) * 2u; let o = vec3u(clamp(back(c) * 65535.0, vec3f(0.0), vec3f(65535.0)) + 0.5);
  outp[i] = o.r | (o.g << 16u); outp[i + 1u] = o.b | (outp[i + 1u] & 0xffff0000u);
}
@compute @workgroup_size(8, 8)
fn first(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= d.at.x || id.y >= d.at.y) { return; }
  var v = blur(vec2i(id.xy), 1, 0.75);
  if (d.k.y > 0.0) {
    let u = (vec2f(id.xy) + 0.5) / 8.0 - 0.5; let i = vec2i(floor(u)); let f = u - floor(u);
    let ab = mix(mix(cell(i), cell(i + vec2i(1, 0)), f.x), mix(cell(i + vec2i(0, 1)), cell(i + vec2i(1, 1)), f.x), f.y);
    let want = ab.xz * v.x + ab.yw; let far = (v.yz - want) / (d.k.y * 1.414);
    v = vec3f(v.x, want + (v.yz - want) * (1.0 - exp(-dot(far, far))));   // within the noise: the neighbourhood's colour; far outside it: its own
  }
  let idx = id.y * d.at.x + id.x; yOut[idx] = v.x; cOut[idx] = pack2x16float(v.yz);
}
@compute @workgroup_size(8, 8)
fn second(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= d.at.x || id.y >= d.at.y) { return; }
  let v = blur(vec2i(id.xy), 2, 0.25); let g = v.x - 0.25 * (v.y + v.z); put(id.xy, vec3f(g + v.y, g, g + v.z));
}`;

const made = /** @type {WeakMap<GPUDevice, Promise<Record<string, GPUComputePipeline>>>} */ (new WeakMap());
const pipes = (/** @type {GPUDevice} */ device) => {
  const have = made.get(device);
  if (have) return have;
  const module = device.createShaderModule({ code: WGSL });
  const all = Promise.all(['stat', 'across', 'fitted', 'down', 'lum', 'first', 'second'].map(async (entryPoint) => [entryPoint, await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint } })])).then(Object.fromEntries);
  made.set(device, all);
  return all;
};

/** Noise reduction for a demosaicer's rectangles: `run` adds its passes to a frame's commands and leaves the
 * result where it found the rectangle, in `raw`. @param {GPUDevice} device @param {GPUBuffer} raw the demosaic's result, two u32 a pixel */
export const compile = pipes;   // starts compiling the passes, so the first 100 % does not wait for them
export async function denoiser(device, raw) {
  const P = await pipes(device), buf = (/** @type {number} */ size, /** @type {number} */ usage) => device.createBuffer({ size, usage });
  const uni = buf(64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST), y = [0, 1].map(() => buf(raw.size / 2, GPUBufferUsage.STORAGE)), c = [0, 1].map(() => buf(raw.size / 2, GPUBufferUsage.STORAGE));
  const cells = Math.ceil(raw.size / 8 / 64) + 4096, s = [0, 1].map(() => buf(cells * 32, GPUBufferUsage.STORAGE));   // a rectangle's cells, whatever its shape
  const group = (/** @type {string} */ name, /** @type {Record<number, GPUBuffer>} */ at) => ({ pipe: P[name], bind: device.createBindGroup({ layout: P[name].getBindGroupLayout(0), entries: [[1, uni], ...Object.entries(at)].map(([binding, buffer]) => ({ binding: +binding, resource: { buffer: /** @type {GPUBuffer} */ (buffer) } })) }) });
  const init = group('lum', { 0: raw, 6: y[0], 8: c[0] });
  const small = [group('stat', { 4: s[0], 5: y[0], 7: c[0] }), group('across', { 3: s[0], 4: s[1] }), group('fitted', { 3: s[1], 4: s[0] }), group('across', { 3: s[0], 4: s[1] }), group('down', { 3: s[1], 4: s[0] })];
  const big = [group('first', { 3: s[0], 5: y[0], 6: y[1], 7: c[0], 8: c[1] }), group('second', { 2: raw, 5: y[1], 7: c[1] })];
  return {
    /** @param {GPUCommandEncoder} enc @param {number} rw @param {number} rh the rectangle's size
     * @param {{ a: number[], b: number[] }} noise the sensor's, at the shot's ISO @param {number} luma @param {number} colour how many times the noise counts as noise (0: off) */
    run(enc, rw, rh, noise, luma, colour) {
      const cw = Math.ceil(rw / 8), ch = Math.ceil(rh / 8), u = new ArrayBuffer(64);
      new Uint32Array(u).set([rw, rh, cw, ch]); new Float32Array(u).set([...noise.a, 0, ...noise.b, 0, luma, colour, 0, 0], 4);
      device.queue.writeBuffer(uni, 0, u);
      const pass = enc.beginComputePass();
      pass.setPipeline(init.pipe); pass.setBindGroup(0, init.bind); pass.dispatchWorkgroups(Math.ceil(rw / 8), Math.ceil(rh / 8));
      if (colour > 0) for (const g of small) { pass.setPipeline(g.pipe); pass.setBindGroup(0, g.bind); pass.dispatchWorkgroups(Math.ceil(cw / 8), Math.ceil(ch / 8)); }
      for (const g of big) { pass.setPipeline(g.pipe); pass.setBindGroup(0, g.bind); pass.dispatchWorkgroups(Math.ceil(rw / 8), Math.ceil(rh / 8)); }
      pass.end();
    },
    /** Buffers free once `run` has been added to a frame: sharpening (deconv.js), which comes next, works in them. */
    spare: [y[0], y[1], c[0], c[1]],
    destroy: () => { for (const b of [uni, ...s, ...y, ...c]) b.destroy(); },
  };
}
