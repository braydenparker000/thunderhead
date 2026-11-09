// @ts-check
// The engine test page's GPU stage (docs/engineering/ENGINE-RESEARCH.md): the binned proxy goes to the
// graphics chip once; every change re-runs one compute pass on it: white balance, camera RGB to linear
// sRGB through the camera's D65 matrix, exposure, a filmic tone curve with contrast, the sRGB curve. A
// first slice: the full pipeline (darktable's and vkdt's modules) replaces this pass step by step.

const WGSL = /* wgsl */ `
struct P { wb: vec4f, m0: vec4f, m1: vec4f, m2: vec4f, ev: f32, contrast: f32, w: u32, h: u32 };
@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<uniform> p: P;
@group(0) @binding(2) var dst: texture_storage_2d<rgba8unorm, write>;
fn tone(x: f32, c: f32) -> f32 {
  // a log-domain S-curve pivoting on mid-grey, then a soft shoulder into white
  let l = log2(max(x, 1e-6) / 0.18) * c;
  let y = 0.18 * exp2(l);
  return y / (1.0 + y * 0.6) * 1.6;
}
fn oetf(x: f32) -> f32 { return select(1.055 * pow(x, 1.0 / 2.4) - 0.055, 12.92 * x, x <= 0.0031308); }
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= p.w || id.y >= p.h) { return; }
  let i = (id.y * p.w + id.x) * 2u;
  let rg = unpack2x16unorm(src[i]); let ba = unpack2x16unorm(src[i + 1u]);
  let cam = vec3f(rg.x, rg.y, ba.x) * p.wb.xyz;
  var c = vec3f(dot(p.m0.xyz, cam), dot(p.m1.xyz, cam), dot(p.m2.xyz, cam)) * exp2(p.ev);
  c = max(c, vec3f(0.0));
  // tone on luminance, keeping hue, then a gentle per-channel roll-off for the brightest colours
  let y = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  let ty = tone(y, p.contrast);
  c = c * (ty / max(y, 1e-6));
  c = c / (1.0 + max(c - vec3f(1.0), vec3f(0.0)));
  let o = clamp(vec3f(oetf(c.x), oetf(c.y), oetf(c.z)), vec3f(0.0), vec3f(1.0));
  textureStore(dst, vec2i(id.xy), vec4f(o, 1.0));
}`;

/** 3 x 3 helpers. @param {number[]} a @param {number[]} b */
const mul = (a, b) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
/** @param {number[]} m */
const inv = (m) => {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
  return [A, c * h - b * i, b * f - c * e, B, a * i - c * g, c * d - a * f, C, b * g - a * h, a * e - b * d].map((x) => x / det);
};
const SRGB_TO_XYZ = [0.4124, 0.3576, 0.1805, 0.2126, 0.7152, 0.0722, 0.0193, 0.1192, 0.9505];

/** Sets up the device, uploads the proxy, returns render(ev, contrast) → GPU ms. @param {HTMLCanvasElement} canvas @param {{ width: number, height: number, proxy: Uint16Array, meta: any }} img */
export async function engine(canvas, img, readback = false) {
  if (!navigator.gpu) throw new Error('This browser has no WebGPU.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No GPU adapter.');
  const device = await adapter.requestDevice();
  const { width: w, height: h } = img;
  canvas.width = w; canvas.height = h;
  // ?readback (tests without a screen): copy the result back and draw it with 2D canvas instead
  const ctx = readback ? null : /** @type {GPUCanvasContext} */ (canvas.getContext('webgpu'));
  ctx?.configure({ device, format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT, alphaMode: 'opaque' });
  const row = Math.ceil((w * 4) / 256) * 256;
  const back = readback ? device.createBuffer({ size: row * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) : null;
  const t0 = performance.now();
  const src = device.createBuffer({ size: img.proxy.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(src, 0, img.proxy.buffer, img.proxy.byteOffset, img.proxy.byteLength);
  const uni = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const out = device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
  const pipe = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: WGSL }), entryPoint: 'main' } });
  const bind = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: src } }, { binding: 1, resource: { buffer: uni } }, { binding: 2, resource: out.createView() }] });
  await device.queue.onSubmittedWorkDone();
  const uploadMs = performance.now() - t0;
  // camera RGB → linear sRGB: inverse of (XYZ→camera · sRGB→XYZ), rows normalised so white stays white
  const m = inv(mul(img.meta.xyzToCamD65, SRGB_TO_XYZ)).map((x, k, a) => x / (a[k - (k % 3)] + a[k - (k % 3) + 1] + a[k - (k % 3) + 2]));
  const wb = img.meta.wb[1] ? img.meta.wb.map((x) => x / img.meta.wb[1]) : [2, 1, 1.6];
  /** @param {number} ev @param {number} contrast */
  const render = async (ev, contrast) => {
    const t = performance.now();
    const u = new ArrayBuffer(80), f = new Float32Array(u), n = new Uint32Array(u);
    f.set([wb[0], wb[1], wb[2], 0, m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, ev, contrast]); n[18] = w; n[19] = h;
    device.queue.writeBuffer(uni, 0, u);
    const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
    pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8)); pass.end();
    if (ctx) enc.copyTextureToTexture({ texture: out }, { texture: ctx.getCurrentTexture() }, [w, h]);
    if (back) enc.copyTextureToBuffer({ texture: out }, { buffer: back, bytesPerRow: row }, [w, h]);
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
    const gpuMs = performance.now() - t;
    if (back) {
      await back.mapAsync(GPUMapMode.READ);
      const src8 = new Uint8Array(back.getMappedRange()), px = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) px.set(src8.subarray(y * row, y * row + w * 4), y * w * 4);
      back.unmap();
      /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')).putImageData(new ImageData(px, w, h), 0, 0);
    }
    return gpuMs;
  };
  device.lost.then((l) => console.warn('GPU device lost:', l.message));
  // keep the adapter and device reachable for as long as the page renders
  return { render, uploadMs, adapter: adapter.info?.description || adapter.info?.architecture || adapter.info?.vendor || 'GPU', keep: [adapter, device] };
}
