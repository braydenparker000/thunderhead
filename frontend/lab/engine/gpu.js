// @ts-check
// The engine test page's GPU stage (docs/engineering/ENGINE-RESEARCH.md). The binned proxy goes to the GPU
// once; every change re-runs one compute pass, in the order the DNG specification and Camera Raw use for a
// camera profile: white-balanced camera RGB → linear ProPhoto (ForwardMatrix) → HueSatMap → exposure →
// LookTable (then a look file's own, e.g. Adobe Color's) → the profile's tone curve (hue-preserving "RGB tone")
// → a look's RGB table (Adobe RGB, γ 2.2) → sRGB on screen, turned upright. Without a profile it falls back to
// the camera matrix and a filmic curve. Before all of it, colours the sensor clipped are rebuilt (wgsl.js).
import { N, WGSL } from './wgsl.js';
import { PROPHOTO_TO_SRGB, PROPHOTO_TO_ADOBE, cameraToProPhoto, inv, neutralFor, whiteOf } from './dcp.js';

const ROT = /** @type {Record<string, number>} */ ({ Rotate90: 1, Rotate180: 2, Rotate270: 3 });
const rows = (/** @type {number[]} */ m) => [m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0];
/** The profile's tables in one buffer, and what the shader needs to find them. @param {null | { profile: import('./dcp.js').Profile, table: any }} pick @param {number} w */
function tables(pick, w) {
  const parts = /** @type {Float32Array[]} */ ([]); let off = 0;
  const add = (/** @type {Float32Array} */ a) => { parts.push(a); const o = off; off += a.length; return o; };
  const p = pick?.profile, u = { hsm: [0, 0, 0, 0], look: [0, 0, 0, 0], look2: [0, 0, 0, 0], tab: [0, 0, 0, 0], flags: 0, offset: p?.expOffset || 0 };
  if (p?.hsm) {
    const d = p.hsm.d2 ? p.hsm.d1.map((x, k) => x * w + /** @type {Float32Array} */ (p.hsm?.d2)[k] * (1 - w)) : p.hsm.d1;
    u.hsm = [p.hsm.dims[0], p.hsm.dims[1], p.hsm.dims[2] || 1, add(d)]; u.flags |= 1 | (p.hsm.srgb ? 16 : 0);
  }
  if (p?.look) { u.look = [p.look.dims[0], p.look.dims[1], p.look.dims[2] || 1, add(p.look.d)]; u.flags |= 2 | (p.look.srgb ? 32 : 0); }
  if (p?.look2) { u.look2 = [p.look2.dims[0], p.look2.dims[1], p.look2.dims[2] || 1, add(p.look2.d)]; u.flags |= 128 | (p.look2.srgb ? 256 : 0); }
  if (p?.tone) {
    const pts = p.tone, n = pts.length / 2, out = new Float32Array(1024);
    for (let k = 0, j = 0; k < 1024; k++) { const x = k / 1023; while (j < n - 2 && pts[(j + 1) * 2] < x) j++; const x0 = pts[j * 2], x1 = pts[j * 2 + 2]; out[k] = pts[j * 2 + 1] + (pts[j * 2 + 3] - pts[j * 2 + 1]) * Math.min(1, Math.max(0, (x - x0) / (x1 - x0 || 1))); }
    u.tab[0] = add(out); u.flags |= 4;
  }
  if (pick?.table) { u.tab[1] = pick.table.n; u.tab[2] = add(pick.table.d); u.flags |= 8; }
  const all = new Float32Array(Math.max(4, off)); let o = 0; for (const a of parts) { all.set(a, o); o += a.length; }
  return { all, u };
}

/** @type {null | Promise<{ adapter: GPUAdapter, device: GPUDevice, pipe: GPUComputePipeline, bakePipe: GPUComputePipeline, lut: GPUTexture }>} */
let shared = null;
/** The device, its two compiled pipelines and the 3D table, made once and kept for every photo (compiling
 * the shader is the slow part on a phone). A lost device is made again on the next photo. */
function gpu() {
  shared ??= (async () => {
    if (!navigator.gpu) throw new Error('This browser has no WebGPU.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No GPU adapter.');
    const device = await adapter.requestDevice();
    device.lost.then((l) => { console.warn('GPU device lost:', l.message); shared = null; });
    const module = device.createShaderModule({ code: WGSL });
    const [pipe, bakePipe] = await Promise.all([device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } }),
      device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'bake' } })]);
    const lut = device.createTexture({ size: [N, N, N], dimension: '3d', format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    return { adapter, device, pipe, bakePipe, lut };
  })();
  shared.catch(() => { shared = null; });
  return shared;
}
/** Starts the GPU early (compiling while the RAF decodes). */
export const warm = () => gpu().then(() => true, () => false);

/** Sets up the device and uploads the proxy; returns setProfile(pick) and render(ev, contrast) → GPU ms.
 * @param {HTMLCanvasElement} canvas @param {{ width: number, height: number, proxy: Uint16Array, meta: any }} img @param {boolean} readback */
export async function engine(canvas, img, readback = false) {
  const { adapter, device, pipe, bakePipe, lut } = await gpu();
  const { width: w, height: h } = img, rot = ROT[img.meta.orientation] || 0, [ow, oh] = rot % 2 ? [h, w] : [w, h];
  canvas.width = ow; canvas.height = oh;
  const ctx = readback ? null : /** @type {GPUCanvasContext} */ (canvas.getContext('webgpu'));
  ctx?.configure({ device, format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT, alphaMode: 'opaque' });
  const t0 = performance.now();
  const src = device.createBuffer({ size: img.proxy.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(src, 0, img.proxy.buffer, img.proxy.byteOffset, img.proxy.byteLength);
  const uni = device.createBuffer({ size: 352, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const out = device.createTexture({ size: [ow, oh], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
  const row = Math.ceil((ow * 4) / 256) * 256;
  const back = readback ? device.createBuffer({ size: row * oh, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) : null;
  await device.queue.onSubmittedWorkDone();
  const uploadMs = performance.now() - t0;
  const asShot = img.meta.wb[1] ? [1 / img.meta.wb[0], 1, 1 / img.meta.wb[2]] : [0.5, 1, 0.6];
  let neutral = asShot, white = /** @type {null | { kelvin: number, tint: number }} */ (null), picked = /** @type {null | { profile: import('./dcp.js').Profile, table: any }} */ (null);
  const fallback = { cm1: img.meta.xyzToCamD65, cm2: null, fm1: null, fm2: null, t1: 6504, t2: 6504, hsm: null, look: null, tone: null, expOffset: 0, name: 'Camera matrix', model: '' };
  let tab = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE }), bind = /** @type {GPUBindGroup | null} */ (null), bakeBind = /** @type {GPUBindGroup | null} */ (null), baked = '', state = { m: /** @type {number[]} */ ([]), u: tables(null, 1).u, kelvin: 0, wb: [1, 1, 1], chroma: [0, 0, 0] };
  const last = { baked: false };   // whether the last render re-made the colour table (the test page's timing line)
  /** @param {null | { profile: import('./dcp.js').Profile, table: any }} pick */
  const setProfile = (pick) => {
    picked = pick;
    const prof = /** @type {any} */ (pick?.profile || fallback);
    neutral = white ? neutralFor(prof, white.kelvin, white.tint) : asShot;
    const conv = cameraToProPhoto(/** @type {any} */ (pick?.profile || fallback), neutral), t = tables(pick, conv.weight);
    tab.destroy();
    tab = device.createBuffer({ size: t.all.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(tab, 0, t.all);
    bind = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: src } }, { binding: 1, resource: { buffer: uni } }, { binding: 2, resource: out.createView() }, { binding: 3, resource: { buffer: tab } }, { binding: 5, resource: lut.createView() }] });
    bakeBind = device.createBindGroup({ layout: bakePipe.getBindGroupLayout(0), entries: [{ binding: 1, resource: { buffer: uni } }, { binding: 3, resource: { buffer: tab } }, { binding: 4, resource: lut.createView() }] });
    baked = '';
    const wb = [neutral[1] / neutral[0], 1, neutral[1] / neutral[2]];
    state = { m: conv.matrix, u: t.u, kelvin: Math.round(conv.kelvin), wb, chroma: (img.meta.chroma ?? [0, 0, 0]).map((/** @type {number} */ c, /** @type {number} */ k) => c * wb[k]) };
    return state.kelvin;
  };
  setProfile(null);
  /** White balance: null for as shot, else a Temp (K) and Tint; returns the white now in use. @param {null | { kelvin: number, tint: number }} wb */
  const setWhite = (wb) => { white = wb; setProfile(picked); return whiteOf(/** @type {any} */ (picked?.profile || fallback), neutral); };
  /** The shot's own white as Temp and Tint, under the current profile. */
  const shotWhite = () => whiteOf(/** @type {any} */ (picked?.profile || fallback), asShot);
  /** @param {number} ev @param {number} contrast
   * @param {{ highlights?: number, shadows?: number, whites?: number, blacks?: number, saturation?: number, vibrance?: number, amount?: number, screen?: boolean, exact?: boolean, rebuild?: boolean, dither?: boolean }} [more]
   * each −1..1; amount: the look table's strength (1 = as made); screen: false renders without showing it; exact: every
   * pixel through the full maths, not the table (slow: the table's accuracy check); rebuild: false leaves clipped
   * highlights as the sensor gave them; dither: false leaves the banding guard off (both for comparing) */
  const render = async (ev, contrast, more = {}) => {
    const t = performance.now(), u = new ArrayBuffer(352), f = new Float32Array(u), n = new Uint32Array(u);
    const g = [more.highlights || 0, more.shadows || 0, more.whites || 0, more.blacks || 0, more.saturation || 0, more.vibrance || 0, 0, 0];
    f.set([...rows(state.m), ...rows(PROPHOTO_TO_SRGB), ...rows(PROPHOTO_TO_ADOBE), ...rows(inv(PROPHOTO_TO_ADOBE)), ev + state.u.offset, contrast, more.amount ?? 1, 0]);
    n.set([w, h, rot, state.u.flags | (more.exact ? 64 : 0) | (more.rebuild === false ? 512 : 0) | (more.dither === false ? 1024 : 0), ...state.u.hsm, ...state.u.look, ...state.u.tab], 52);
    f.set(g, 68); n.set(state.u.look2, 76); f.set([...state.wb, 0, ...state.chroma, 0], 80);
    const key = [contrast, more.amount ?? 1, ...g].join();
    device.queue.writeBuffer(uni, 0, u);
    const enc = device.createCommandEncoder();
    last.baked = baked !== key;
    if (last.baked) {   // re-bake only when the profile or a tone or colour control changed: a frame is then one table lookup
      const bp = enc.beginComputePass(); bp.setPipeline(bakePipe); bp.setBindGroup(0, bakeBind); bp.dispatchWorkgroups(Math.ceil(N / 4), Math.ceil(N / 4), Math.ceil(N / 4)); bp.end(); baked = key;
    }
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8)); pass.end();
    if (ctx && more.screen !== false) enc.copyTextureToTexture({ texture: out }, { texture: ctx.getCurrentTexture() }, [ow, oh]);
    if (back && more.screen !== false) enc.copyTextureToBuffer({ texture: out }, { buffer: back, bytesPerRow: row }, [ow, oh]);
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
    const gpuMs = performance.now() - t;
    if (back && more.screen !== false) {
      await back.mapAsync(GPUMapMode.READ);
      const b8 = new Uint8Array(back.getMappedRange()), px = new Uint8ClampedArray(ow * oh * 4);
      for (let y = 0; y < oh; y++) px.set(b8.subarray(y * row, y * row + ow * 4), y * ow * 4);
      back.unmap();
      /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')).putImageData(new ImageData(px, ow, oh), 0, 0);
    }
    return gpuMs;
  };
  /** The last render's pixels, for the colour check. */
  const snapshot = async () => {
    const b = device.createBuffer({ size: row * oh, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: out }, { buffer: b, bytesPerRow: row }, [ow, oh]); device.queue.submit([enc.finish()]);
    await b.mapAsync(GPUMapMode.READ);
    const b8 = new Uint8Array(b.getMappedRange()), px = new Uint8ClampedArray(ow * oh * 4);
    for (let y = 0; y < oh; y++) px.set(b8.subarray(y * row, y * row + ow * 4), y * ow * 4);
    b.unmap(); b.destroy();
    return new ImageData(px, ow, oh);
  };
  /** Frees this photo's GPU memory (the device and pipelines stay for the next). */
  const dispose = () => { for (const b of [src, uni, tab, back]) b?.destroy(); out.destroy(); };
  return { render, setProfile, setWhite, shotWhite, snapshot, dispose, last, uploadMs, adapter: adapter.info?.description || adapter.info?.architecture || adapter.info?.vendor || 'GPU', keep: [adapter, device] };
}
