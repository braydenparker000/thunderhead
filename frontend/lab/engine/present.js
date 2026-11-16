// @ts-check
// The fitted photo at the screen's own pixels. The frame is made at the editing copy's size (a third of the sensor:
// 2576 pixels across for an X-E5), which a phone shows in about 1170: left to the browser, that shrink skips
// pixels, and fine detail past the screen's limit comes out as false rings and shimmer (a zone plate: 16.5 of 255
// of ripple where a proper shrink leaves 5.8). So the engine shrinks the frame itself, as an export is shrunk
// (reduce.js): Lanczos-3 in linear light, rows then columns, each result held between the least and most of the
// pixels at its middle, so the fitted view is the picture a reduced export would be. Used only while the photo is
// fitted: zoomed in, the canvas is the editing copy's size, so a pinch stays sharp (the editor's app/session.js).

const SHADER = /* wgsl */ `
struct P { src: vec2u, dst: vec2u, k: vec2f, axis: u32, pad: u32 }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> p: P;
fn lin(c: vec3f) -> vec3f { return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045)); }
fn enc(c: vec3f) -> vec3f { return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308)); }
fn sinc(x: f32) -> f32 { if (abs(x) < 1e-5) { return 1.0; } let a = 3.14159265 * x; return sin(a) / a; }
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  // axis 0: across, from the frame (sRGB numbers) to half-way (light); axis 1: down, from half-way to the screen (sRGB numbers)
  let out = select(vec2u(p.dst.x, p.src.y), p.dst, p.axis == 1u);
  if (id.x >= out.x || id.y >= out.y) { return; }
  let k = select(p.k.x, p.k.y, p.axis == 1u); let s = max(k, 1.0);
  let at = select(f32(id.x), f32(id.y), p.axis == 1u); let c = (at + 0.5) * k - 0.5;
  let n = select(p.src.x, p.src.y, p.axis == 1u);
  var sum = vec3f(0.0); var w = 0.0; var lo = vec3f(1e9); var hi = vec3f(-1e9);
  for (var i = i32(ceil(c - 3.0 * s)); i <= i32(floor(c + 3.0 * s)); i++) {
    let j = u32(clamp(i, 0, i32(n) - 1)); let t = (f32(i) - c) / s; let wt = sinc(t) * sinc(t / 3.0);
    let q = select(vec2u(j, id.y), vec2u(id.x, j), p.axis == 1u);
    var v = textureLoad(src, q, 0).rgb; if (p.axis == 0u) { v = lin(v); }
    sum += wt * v; w += wt;
    if (abs(f32(i) - c) <= max(1.0, k * 0.5)) { lo = min(lo, v); hi = max(hi, v); }
  }
  var r = clamp(sum / w, lo, hi); if (p.axis == 1u) { r = enc(r); }
  textureStore(dst, id.xy, vec4f(r, 1.0));
}`;
const COPY = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) { let d = textureDimensions(dst); if (id.x < d.x && id.y < d.y) { textureStore(dst, id.xy, textureLoad(src, id.xy, 0)); } }`;

/** @param {GPUDevice} device */
export function presenter(device) {
  const mod = device.createShaderModule({ code: SHADER }), copyMod = device.createShaderModule({ code: COPY });
  const pipe = device.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } }), last = device.createComputePipeline({ layout: 'auto', compute: { module: copyMod, entryPoint: 'main' } });
  const unis = [0, 1].map(() => device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
  let half = /** @type {GPUTexture | null} */ (null), full = /** @type {GPUTexture | null} */ (null), done = /** @type {GPUTexture | null} */ (null), key = '';
  return {
    /** Shrinks `src` (the frame, sw x sh) to dw x dh into a texture of its own, which it gives (rgba8unorm, to copy or read).
     * @param {GPUCommandEncoder} enc @param {GPUTexture} src @param {number} sw @param {number} sh @param {number} dw @param {number} dh */
    run(enc, src, sw, sh, dw, dh) {
      if (key !== `${sw},${sh},${dw},${dh}`) {
        for (const t of [half, full, done]) t?.destroy();
        key = `${sw},${sh},${dw},${dh}`;
        half = device.createTexture({ size: [dw, sh], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
        full = device.createTexture({ size: [dw, dh], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
        done = device.createTexture({ size: [dw, dh], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
      }
      const ks = [sw / dw, sh / dh];
      for (const axis of [0, 1]) {
        const u = new ArrayBuffer(32); new Uint32Array(u).set([sw, sh, dw, dh]); new Float32Array(u).set(ks, 4); new Uint32Array(u).set([axis, 0], 6);
        device.queue.writeBuffer(unis[axis], 0, u);
      }
      const pass = enc.beginComputePass();
      for (const [axis, a, b, w, h] of /** @type {[number, GPUTexture, GPUTexture, number, number][]} */ ([[0, src, /** @type {GPUTexture} */ (half), dw, sh], [1, /** @type {GPUTexture} */ (half), /** @type {GPUTexture} */ (full), dw, dh]])) {
        pass.setPipeline(pipe);
        pass.setBindGroup(0, device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: a.createView() }, { binding: 1, resource: b.createView() }, { binding: 2, resource: { buffer: unis[axis] } }] }));
        pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
      }
      pass.setPipeline(last);
      pass.setBindGroup(0, device.createBindGroup({ layout: last.getBindGroupLayout(0), entries: [{ binding: 0, resource: /** @type {GPUTexture} */ (full).createView() }, { binding: 1, resource: /** @type {GPUTexture} */ (done).createView() }] }));
      pass.dispatchWorkgroups(Math.ceil(dw / 8), Math.ceil(dh / 8));
      pass.end();
      return /** @type {GPUTexture} */ (done);
    },
    destroy() { for (const t of [half, full, done]) t?.destroy(); for (const u of unis) u.destroy(); },
  };
}
