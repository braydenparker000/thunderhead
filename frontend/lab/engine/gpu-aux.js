// @ts-check
// Auxiliary lightweight GPU passes for interactive 60-90 fps editing (gpu.js):
// 1. 3 KB compute histogram (replaces 17.7 MB full-frame readback in scope.js).
// 2. Downsampled linear-flat cache + tiny thumbnail render (replaces 4.42 MP renders for 168 px Profile/Look tiles).

const SHADER = /* wgsl */ `
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> bins: array<atomic<u32>, 772>;
@compute @workgroup_size(8, 8)
fn hist(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(srcTex);
  let step = max(1u, min(dim.x, dim.y) / 400u);
  let x = id.x * step; let y = id.y * step;
  if (x >= dim.x || y >= dim.y) { return; }
  let c = textureLoad(srcTex, vec2u(x, y), 0);
  let r = u32(clamp(round(c.r * 255.0), 0.0, 255.0));
  let g = u32(clamp(round(c.g * 255.0), 0.0, 255.0));
  let b = u32(clamp(round(c.b * 255.0), 0.0, 255.0));
  let mx = max(r, max(g, b));
  atomicAdd(&bins[r], 1u);
  atomicAdd(&bins[256u + g], 1u);
  atomicAdd(&bins[512u + b], 1u);
  if (mx <= 1u) { atomicAdd(&bins[768u], 1u); }
  else if (mx >= 254u) { atomicAdd(&bins[769u], 1u); }
  atomicAdd(&bins[770u], 1u);
}

struct D { sw: u32, sh: u32, tw: u32, th: u32 }
@group(0) @binding(0) var<uniform> d: D;
@group(0) @binding(1) var<storage, read> flatIn: array<u32>;
@group(0) @binding(2) var<storage, read_write> flatOut: array<u32>;
@compute @workgroup_size(8, 8)
fn shrink(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= d.tw || id.y >= d.th) { return; }
  let x0 = (id.x * d.sw) / d.tw; let x1 = max(x0 + 1u, ((id.x + 1u) * d.sw) / d.tw);
  let y0 = (id.y * d.sh) / d.th; let y1 = max(y0 + 1u, ((id.y + 1u) * d.sh) / d.th);
  let sx = max(1u, (x1 - x0) / 4u); let sy = max(1u, (y1 - y0) / 4u);
  var s = vec3f(0.0); var n = 0.0; var bits = 0u;
  for (var y = y0; y < y1; y += sy) {
    for (var x = x0; x < x1; x += sx) {
      let i = (y * d.sw + x) * 2u;
      let rg = unpack2x16unorm(flatIn[i]); let ba = unpack2x16unorm(flatIn[i + 1u]);
      s += vec3f(rg.x, rg.y, ba.x); bits |= (flatIn[i + 1u] >> 16u) & 7u; n += 1.0;
    }
  }
  let v = clamp(s / max(n, 1.0), vec3f(0.0), vec3f(1.0));
  let u = vec3u(round(v * 65535.0));
  let o = (id.y * d.tw + id.x) * 2u;
  flatOut[o] = u.x | (u.y << 16u); flatOut[o + 1u] = u.z | (bits << 16u);
}`;

/** @type {WeakMap<GPUDevice, Promise<{ hist: GPUComputePipeline, shrink: GPUComputePipeline }>>} */
const compiled = new WeakMap();
/** @param {GPUDevice} device */
export function auxPipes(device) {
  let p = compiled.get(device);
  if (!p) {
    const module = device.createShaderModule({ code: SHADER });
    p = Promise.all([
      device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'hist' } }),
      device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'shrink' } }),
    ]).then(([hist, shrink]) => ({ hist, shrink }));
    compiled.set(device, p);
  }
  return p;
}

const BINS_BYTES = 772 * 4;
const ZERO_BINS = new Uint32Array(772);

/** Per-engine auxiliary helper for fast 3 KB GPU histograms and cached downsampled thumbnail surfaces.
 * @param {GPUDevice} device @param {{ hist: GPUComputePipeline, shrink: GPUComputePipeline }} pipes */
export function auxHelper(device, pipes) {
  const bins = device.createBuffer({ size: BINS_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const read = device.createBuffer({ size: BINS_BYTES, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const dUni = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  let sFlat = /** @type {GPUBuffer | null} */ (null), sOut = /** @type {GPUTexture | null} */ (null), sBack = /** @type {GPUBuffer | null} */ (null);
  let tw = 0, th = 0, sRow = 0, fromGen = -1;

  /** Computes 256-bin R/G/B histogram + shadow/highlight clip counts in ~0.4 ms with a 3 KB readback.
   * @param {GPUTexture} tex @param {number} w @param {number} h */
  async function histogram(tex, w, h) {
    device.queue.writeBuffer(bins, 0, ZERO_BINS);
    const step = Math.max(1, Math.floor(Math.min(w, h) / 400));
    const gx = Math.ceil(Math.ceil(w / step) / 8), gy = Math.ceil(Math.ceil(h / step) / 8);
    const bg = device.createBindGroup({ layout: pipes.hist.getBindGroupLayout(0), entries: [{ binding: 0, resource: tex.createView() }, { binding: 1, resource: { buffer: bins } }] });
    const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
    pass.setPipeline(pipes.hist); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(gx, gy); pass.end();
    enc.copyBufferToBuffer(bins, 0, read, 0, BINS_BYTES);
    device.queue.submit([enc.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const raw = new Uint32Array(read.getMappedRange()).slice();
    read.unmap();
    return {
      r: Float64Array.from(raw.subarray(0, 256)),
      g: Float64Array.from(raw.subarray(256, 512)),
      b: Float64Array.from(raw.subarray(512, 768)),
      lo: raw[768], hi: raw[769], all: Math.max(1, raw[770]),
    };
  }

  /** Ensures the cached downsampled `flat` buffer + tiny output texture/readback match `(nw, nh)` and `gen`.
   * @param {GPUCommandEncoder} enc @param {GPUBuffer} flat @param {number} sw @param {number} sh @param {number} nw @param {number} nh @param {number} gen */
  function thumbTarget(enc, flat, sw, sh, nw, nh, gen) {
    if (nw !== tw || nh !== th || !sFlat || !sOut || !sBack) {
      sFlat?.destroy(); sOut?.destroy(); sBack?.destroy();
      tw = nw; th = nh; sRow = Math.ceil((tw * 4) / 256) * 256; fromGen = -1;
      sFlat = device.createBuffer({ size: tw * th * 8, usage: GPUBufferUsage.STORAGE });
      sOut = device.createTexture({ size: [tw, th], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });   // a texture's own flags (GPUBufferUsage has no STORAGE_BINDING: the frame could not be written, and every small tile came back empty)
      sBack = device.createBuffer({ size: sRow * th, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    }
    if (fromGen !== gen) {
      device.queue.writeBuffer(dUni, 0, new Uint32Array([sw, sh, tw, th]));
      const bg = device.createBindGroup({ layout: pipes.shrink.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: dUni } }, { binding: 1, resource: { buffer: flat } }, { binding: 2, resource: { buffer: sFlat } }] });
      const pass = enc.beginComputePass();
      pass.setPipeline(pipes.shrink); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(Math.ceil(tw / 8), Math.ceil(th / 8)); pass.end();
      fromGen = gen;
    }
    return { flat: sFlat, out: sOut, back: sBack, row: sRow, tw, th };
  }

  /** Reads back the tiny thumbnail buffer as ImageData. @param {{ colorSpace: PredefinedColorSpace }} space */
  async function readThumb(space) {
    const b = /** @type {GPUBuffer} */ (sBack);
    await b.mapAsync(GPUMapMode.READ);
    const b8 = new Uint8Array(b.getMappedRange()), px = new Uint8ClampedArray(tw * th * 4);
    for (let y = 0; y < th; y++) px.set(b8.subarray(y * sRow, y * sRow + tw * 4), y * tw * 4);
    b.unmap();
    return new ImageData(px, tw, th, space);
  }

  function destroy() { for (const b of [bins, read, dUni, sFlat, sBack]) b?.destroy(); sOut?.destroy(); sFlat = sBack = null; sOut = null; }
  return { histogram, thumbTarget, readThumb, destroy };
}
