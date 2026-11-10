// @ts-check
// The engine test page's GPU stage (docs/engineering/ENGINE-RESEARCH.md). The binned proxy goes to the GPU
// once; every change re-runs one compute pass, in the order the DNG specification and Camera Raw use for a
// camera profile: white-balanced camera RGB → linear ProPhoto (ForwardMatrix) → HueSatMap → exposure →
// Highlights and Shadows (by the tone mask, mask.js) → Contrast, Whites and Blacks (one curve) → Saturation and
// Vibrance → LookTable (then a look file's own, e.g. Adobe Color's) → the profile's tone curve (hue-preserving "RGB tone")
// → a look's RGB table (Adobe RGB, γ 2.2) → sRGB on screen, turned upright. Without a profile it falls back to
// the camera matrix and a filmic curve. Before all of it, colours the sensor clipped are rebuilt (wgsl.js), and
// before that the photo is laid out as the picture: the lens's faults undone, cropped, upright (warp.js).
import { N, USIZE, WGSL } from './wgsl.js';
import { fromMask, localRows, through, toMask, toneOf } from './local.js';
import { brushes } from './brush.js';
import { findSource, spotRows } from './heal.js';
import { maskPipes, masks } from './mask.js';
import { airOf } from './haze.js';
import { noiseAt } from './noise.js';
import { PROPHOTO_TO_SRGB, PROPHOTO_TO_ADOBE, cameraToProPhoto, inv, neutralFor, whiteOf } from './dcp.js';
import { neutralAt } from './white.js';
import { autoTone } from './auto.js';
import { geometry, toSensor, warpPipe, warper } from './warp.js';

const rows = (/** @type {number[]} */ m) => [m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0];
/** The profile's tables in one buffer, and what the shader needs to find them. @param {null | { profile?: import('./dcp.js').Profile, table?: any, cube?: import('./cube.js').Cube | null }} pick @param {number} w */
function tables(pick, w) {
  const parts = /** @type {Float32Array[]} */ ([]); let off = 0;
  const add = (/** @type {Float32Array} */ a) => { parts.push(a); const o = off; off += a.length; return o; };
  const p = pick?.profile, u = { hsm: [0, 0, 0, 0], look: [0, 0, 0, 0], look2: [0, 0, 0, 0], tab: [0, 0, 0, 0], cube: 0, flags: 0, offset: p?.expOffset || 0 };
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
  if (pick?.cube) { u.cube = pick.cube.n; u.tab[3] = add(pick.cube.d); u.flags |= 262144; }   // a look's own table, on the finished picture
  const all = new Float32Array(Math.max(4, off)); let o = 0; for (const a of parts) { all.set(a, o); o += a.length; }
  return { all, u };
}

/** @type {null | Promise<{ adapter: GPUAdapter, device: GPUDevice, pipe: GPUComputePipeline, bakePipe: GPUComputePipeline, maskP: Awaited<ReturnType<typeof maskPipes>>, lut: GPUTexture }>} */
let shared = null;
/** The device, its compiled pipelines and the 3D table, made once and kept for every photo (compiling
 * the shader is the slow part on a phone). A lost device is made again on the next photo. */
function gpu() {
  shared ??= (async () => {
    if (!navigator.gpu) throw new Error('This browser has no WebGPU.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No GPU adapter.');
    const device = await adapter.requestDevice();
    device.lost.then((l) => { console.warn('GPU device lost:', l.message); shared = null; });
    const module = device.createShaderModule({ code: WGSL });
    const [pipe, bakePipe, maskP, bendP] = await Promise.all([device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } }),
      device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'bake' } }), maskPipes(device), warpPipe(device)]);
    const lut = device.createTexture({ size: [N, N, N], dimension: '3d', format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    return { adapter, device, pipe, bakePipe, maskP, bendP, lut };
  })();
  shared.catch(() => { shared = null; });
  return shared;
}
/** Starts the GPU early (compiling while the RAF decodes). */
export const warm = () => gpu().then(() => true, () => false);

/** Sets up the device and uploads the proxy; returns setProfile(pick) and render(ev, contrast) → GPU ms.
 * @param {HTMLCanvasElement} canvas @param {{ width: number, height: number, proxy: Uint16Array, meta: any }} img @param {boolean} readback */
export async function engine(canvas, img, readback = false) {
  const { adapter, device, pipe, bakePipe, maskP, bendP, lut } = await gpu();
  const { width: w, height: h } = img, cell = (img.meta.fullWidth ??= w * 3) / w;
  img.meta.fullHeight ??= h * 3; img.meta.width = w;
  const ctx = readback ? null : /** @type {GPUCanvasContext} */ (canvas.getContext('webgpu'));
  ctx?.configure({ device, format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT, alphaMode: 'opaque' });
  const t0 = performance.now();
  const src = device.createBuffer({ size: img.proxy.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(src, 0, img.proxy.buffer, img.proxy.byteOffset, img.proxy.byteLength);
  const uni = device.createBuffer({ size: USIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  // The photo laid out as the picture (warp.js) is what the tone mask and every frame read. It, the frame's
  // output, the canvas and the mask are the picture's size, so a crop makes them anew (`lay`).
  let geo = geometry(img.meta), bent = false, fine = true, ow = 0, oh = 0, row = 0;
  const none = /** @type {any} */ (null);
  let out = /** @type {GPUTexture} */ (none), flat = /** @type {GPUBuffer} */ (none), bend = /** @type {ReturnType<typeof warper>} */ (none), mask = /** @type {ReturnType<typeof masks>} */ (none), back = /** @type {GPUBuffer | null} */ (null);
  const lay = () => {
    const nw = Math.round(geo.ow / cell), nh = Math.round(geo.oh / cell);
    if (nw === ow && nh === oh) return false;
    for (const b of [flat, back]) b?.destroy(); out?.destroy(); mask?.destroy(); bend?.destroy();
    ow = nw; oh = nh; row = Math.ceil((ow * 4) / 256) * 256;
    out = device.createTexture({ size: [ow, oh], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
    flat = device.createBuffer({ size: ow * oh * 8, usage: GPUBufferUsage.STORAGE }); bend = warper(device, bendP, src, flat);
    mask = masks(device, maskP, flat, uni, ow, oh);
    back = readback ? device.createBuffer({ size: row * oh, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) : null;
    return true;
  };
  lay(); canvas.width = ow; canvas.height = oh;
  await device.queue.onSubmittedWorkDone();
  const uploadMs = performance.now() - t0;
  const asShot = img.meta.wb[1] ? [1 / img.meta.wb[0], 1, 1 / img.meta.wb[2]] : [0.5, 1, 0.6];
  let neutral = asShot, white = /** @type {null | { kelvin: number, tint: number }} */ (null), picked = /** @type {null | { profile: import('./dcp.js').Profile, table: any }} */ (null);
  const fallback = { cm1: img.meta.xyzToCamD65, cm2: null, fm1: null, fm2: null, t1: 6504, t2: 6504, hsm: null, look: null, tone: null, expOffset: 0, name: 'Camera matrix', model: '' };
  let tab = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE }), bind = /** @type {GPUBindGroup | null} */ (null), bakeBind = /** @type {GPUBindGroup | null} */ (null), baked = '', masked = '', fined = '', hazed = '', air = [1, 1, 1], airFor = /** @type {number[] | null} */ (null), state = { m: /** @type {number[]} */ ([]), u: tables(null, 1).u, kelvin: 0, wb: [1, 1, 1], chroma: [0, 0, 0] };
  /** Full-resolution views (full.js): each adds its own frame pass to a render. @type {{ bind: (tab: GPUBuffer) => void, bent: () => void, frame: (enc: GPUCommandEncoder, u: ArrayBuffer) => void, after: () => Promise<void> }[]} */
  const views = [];
  let lastU = new ArrayBuffer(USIZE);   // the last shown frame's settings
  const last = { baked: false, masked: false };   // whether the last render re-made the colour table, and the tone mask (the test page's timing lines)
  const painted = brushes(device, geo.rot % 2 ? geo.H : geo.W, geo.rot % 2 ? geo.W : geo.H);   // the brush masks' layers (brush.js)
  /** @param {null | { profile?: import('./dcp.js').Profile, table?: any, cube?: import('./cube.js').Cube | null }} pick */
  const setProfile = (pick) => {
    picked = pick;
    const prof = /** @type {any} */ (pick?.profile || fallback);
    neutral = white ? neutralFor(prof, white.kelvin, white.tint) : asShot;
    const conv = cameraToProPhoto(/** @type {any} */ (pick?.profile || fallback), neutral), t = tables(pick, conv.weight);
    tab.destroy();
    tab = device.createBuffer({ size: t.all.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(tab, 0, t.all);
    bind = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: flat } }, { binding: 1, resource: { buffer: uni } }, { binding: 2, resource: out.createView() }, { binding: 3, resource: { buffer: tab } }, { binding: 5, resource: lut.createView() }, { binding: 6, resource: mask.tone.view }, { binding: 7, resource: mask.fine.view }, { binding: 8, resource: mask.haze.view }, { binding: 9, resource: painted.view() }] });
    bakeBind = device.createBindGroup({ layout: bakePipe.getBindGroupLayout(0), entries: [{ binding: 1, resource: { buffer: uni } }, { binding: 3, resource: { buffer: tab } }, { binding: 4, resource: lut.createView() }] });
    for (const v of views) v.bind(tab);
    baked = ''; masked = fined = hazed = '';
    const wb = [neutral[1] / neutral[0], 1, neutral[1] / neutral[2]];
    state = { m: conv.matrix, u: t.u, kelvin: Math.round(conv.kelvin), wb, chroma: (img.meta.chroma ?? [0, 0, 0]).map((/** @type {number} */ c, /** @type {number} */ k) => c * wb[k]) };
    return state.kelvin;
  };
  setProfile(null);
  /** White balance: null for as shot, else a Temp (K) and Tint; returns the white now in use. @param {null | { kelvin: number, tint: number }} wb */
  const setWhite = (wb) => { white = wb; setProfile(picked); return whiteOf(/** @type {any} */ (picked?.profile || fallback), neutral); };
  /** The shot's own white as Temp and Tint, under the current profile. */
  const shotWhite = () => whiteOf(/** @type {any} */ (picked?.profile || fallback), asShot);
  /** The white that makes a point of the shown photo neutral (the eyedropper): `u` across and `v` down it,
   * 0..1. Null where the sensor clipped. @param {number} u @param {number} v */
  const whiteAt = (u, v) => {
    const X = Math.min(ow - 1, Math.max(0, Math.floor(u * ow))), Y = Math.min(oh - 1, Math.max(0, Math.floor(v * oh)));
    const [sx, sy] = toSensor(geo, (X + 0.5) * cell, (Y + 0.5) * cell), x = Math.min(w - 1, Math.max(0, Math.floor(sx / cell))), y = Math.min(h - 1, Math.max(0, Math.floor(sy / cell)));
    const n = neutralAt(img, x, y);
    return n && whiteOf(/** @type {any} */ (picked?.profile || fallback), n);
  };
  /** Masks (local.js): a place in the picture as shown (0..1 across and down) in mask units, and back; and what a
   * range mask picks up there (lightness, then colour), read at `base` stops. @param {number} u @param {number} v */
  const maskPoint = (u, v) => through(toMask(geo), u, v);
  const shownPoint = (/** @type {number} */ x, /** @type {number} */ y) => through(fromMask(geo), x, y);
  const toneAt = (/** @type {number} */ u, /** @type {number} */ v, /** @type {number} */ base) => {
    const [sx, sy] = toSensor(geo, u * ow * cell, v * oh * cell), x0 = Math.round(sx / cell), y0 = Math.round(sy / cell), s = [0, 0, 0], d = img.proxy; let got = 0;
    for (let y = Math.max(0, y0 - 5); y <= Math.min(h - 1, y0 + 5); y++) for (let x = Math.max(0, x0 - 5); x <= Math.min(w - 1, x0 + 5); x++) { const i = (y * w + x) * 4; s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; got++; }
    if (!got) return null;
    const k = 2 ** (base + state.u.offset) / 65535 / got, m = state.m;
    return toneOf([0, 3, 6].map((o) => Math.max(0, m[o] * s[0] + m[o + 1] * s[1] + m[o + 2] * s[2]) * k));
  };
  /** @param {number} ev @param {number} contrast
   * @param {{ highlights?: number, shadows?: number, whites?: number, blacks?: number, saturation?: number, vibrance?: number, clarity?: number, texture?: number, dehaze?: number, sharpen?: number, radius?: number, detail?: number, noise?: number, colorNoise?: number, vignette?: number, grain?: number, cube?: number, defringe?: number, masks?: import('./local.js').Mask[] | null, showMaskNo?: number, baseEv?: number, mixer?: Float32Array | null, grade?: Float32Array | null, curve?: Float32Array | null, amount?: number, screen?: boolean, fit?: boolean, exact?: boolean, rebuild?: boolean, dither?: boolean, mask?: boolean, showMask?: boolean, time?: 'bare' | 'nearest' }} [more]
   * each −1..1; amount: the look table's strength (1 = as made); screen: false renders without showing it; fit: false leaves the
   * fitted photo as it is and re-makes only the full-resolution views (100 %); exact: every
   * pixel through the full maths, not the table (slow: the table's accuracy check); rebuild: false leaves clipped
   * highlights as the sensor gave them; dither: false leaves the banding guard off; mask: false sets Highlights and
   * Shadows by each pixel's own brightness, not its area's; showMask draws the tone mask (all four for comparing);
   * time, for the stage timer: 'bare' does no colour work at all, 'nearest' reads the table without mixing its entries */
  const render = async (ev, contrast, more = {}) => {
    if (painted.sync(more.masks)) setProfile(picked);   // a first brush mask made the layers' texture: everything that binds it binds again
    const t = performance.now(), u = new ArrayBuffer(USIZE), f = new Float32Array(u), n = new Uint32Array(u);
    const g = [more.highlights || 0, more.shadows || 0, more.whites || 0, more.blacks || 0, more.saturation || 0, more.vibrance || 0, 0, 0];
    f.set([...rows(state.m), ...rows(PROPHOTO_TO_SRGB), ...rows(PROPHOTO_TO_ADOBE), ...rows(inv(PROPHOTO_TO_ADOBE)), ev + state.u.offset, contrast, more.amount ?? 1, 1]);
    n.set([ow, oh, state.u.cube, state.u.flags | (more.exact ? 64 : 0) | (more.rebuild === false ? 512 : 0) | (more.dither === false ? 1024 : 0) | (more.mask === false ? 2048 : 0) | (more.showMask ? 4096 : 0) | (more.time === 'nearest' ? 8192 : more.time === 'bare' ? 16384 : 0), ...state.u.hsm, ...state.u.look, ...state.u.tab], 52);
    f.set(g, 68); n.set(state.u.look2, 76); f.set([...state.wb, geo.head, ...state.chroma, 0], 80);
    if (more.dehaze && airFor !== state.m) { air = airOf(img, state.m); airFor = state.m; }   // the haze's colour, once for each profile and white balance
    f.set([more.clarity || 0, more.texture || 0, more.dehaze || 0, more.vignette || 0, ...air, more.cube ?? 1, more.sharpen || 0, more.radius || 1, more.detail ?? 0.25, more.grain || 0, 2.5 * (more.noise || 0), 4 * (more.colorNoise || 0), ow, oh], 88);
    // the tools inside the colour table (grade.js): each is switched on by its rows being there
    if (more.mixer) { f.set(more.mixer, 104); n[55] |= 32768; }
    if (more.grade) { f.set(more.grade, 136); n[55] |= 65536; }
    if (more.curve) { f.set(more.curve, 156); n[55] |= 131072; }
    const lo = localRows(more.masks, geo, more.showMaskNo ?? -1, (more.baseEv ?? ev) + state.u.offset);   // the masks: laid on in the frame pass, not the table
    if (lo) f.set(lo, 668);
    f[683] = more.defringe || 0;   // for the full-size views' last pass (finish.js)
    const key = [contrast, more.amount ?? 1, ...g.slice(2), more.cube ?? 1, more.mixer?.join(), more.grade?.join(), more.curve?.join()].join(), lit = more.rebuild === false ? 'clipped' : 'rebuilt';
    device.queue.writeBuffer(uni, 0, u);
    const enc = device.createCommandEncoder();
    if (!bent) { bend.run(enc, geo, { x: 0, y: 0, scale: cell, w: ow, h: oh }, { x: 0, y: 0, scale: cell, w, h }, fine, true); bent = true; masked = fined = hazed = ''; }
    last.baked = baked !== key;
    if (last.baked) {   // re-bake only when the profile or a control inside the table changed: a frame is then one table lookup
      const bp = enc.beginComputePass(); bp.setPipeline(bakePipe); bp.setBindGroup(0, bakeBind); bp.dispatchWorkgroups(Math.ceil(N / 4), Math.ceil(N / 4), Math.ceil(N / 4)); bp.end(); baked = key;
    }
    // the tone mask: made when Highlights or Shadows first need it, and again only after the profile, the white balance or the rebuild changes
    last.masked = Boolean(g[0] || g[1] || more.clarity || more.showMask) && more.mask !== false && masked !== lit;
    if (last.masked) { mask.tone.run(enc); masked = lit; }
    if (more.texture && fined !== lit) { mask.fine.run(enc); fined = lit; }   // the finer mask and the haze mask, likewise made when first needed
    if ((more.dehaze || 0) > 0 && hazed !== lit) { mask.haze.run(enc); hazed = lit; }
    const shown = more.screen !== false, fit = more.fit !== false;
    if (shown && fit && (canvas.width !== ow || canvas.height !== oh)) { canvas.width = ow; canvas.height = oh; }   // the canvas takes a crop's size when it is first shown
    if (fit) {
      const pass = enc.beginComputePass();
      pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(Math.ceil(ow / 8), Math.ceil(oh / 8)); pass.end();
      if (ctx && shown) enc.copyTextureToTexture({ texture: out }, { texture: ctx.getCurrentTexture() }, [ow, oh]);
      if (back && shown) enc.copyTextureToBuffer({ texture: out }, { buffer: back, bytesPerRow: row }, [ow, oh]);
    }
    if (shown) { for (const v of views) v.frame(enc, u); lastU = u; }
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
    const gpuMs = performance.now() - t;
    if (shown) for (const v of views) await v.after();
    if (back && shown && fit) {
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
  const dispose = () => { for (const b of [src, flat, uni, tab, back]) b?.destroy(); out.destroy(); mask.destroy(); bend.destroy(); painted.destroy(); };
  /** The lens corrections added by hand (each −1..1): the picture is laid out again at the next render.
   * and the crop (crop.js). A crop that changes the picture's size makes its surfaces anew. `draft` lays it out
   * the quick way (two taps, no fringing pass), for while a control moves.
   * @param {{ distortion?: number, vignetting?: number, crop?: import('./crop.js').Crop | null, draft?: boolean, spots?: import('./heal.js').Spot[] | null }} o */
  const setGeometry = (o) => { geo = geometry(img.meta, o); geo.spots = spotRows(o.spots, geo, img); fine = !o.draft; bent = false; if (lay()) setProfile(picked); for (const v of views) v.bent(); };
  /** Auto's values for the Light controls (auto.js). @param {number} ev the exposure the photo shows at with Exposure at 0 */
  const auto = (ev) => autoTone(img, state.m, ev + state.u.offset);
  /** What full.js builds on. */
  const base = { device, pipe, bendP, lut, get mask() { return mask.tone.view; }, get fine() { return mask.fine.view; }, get brushed() { return painted.view(); }, get haze() { return mask.haze.view; }, views, tab: () => tab, settings: () => lastU, geo: () => geo, noise: noiseAt(img.meta.iso || 200) };
  /** Retouching (heal.js): where a spot's replacement is best taken from. @param {{ x: number, y: number, r: number }} s @param {boolean} [wide] */
  const healSource = (s, wide) => findSource(s, geo, img, wide);
  return { render, setProfile, setWhite, setGeometry, shotWhite, whiteAt, maskPoint, shownPoint, toneAt, healSource, auto, snapshot, dispose, last, gpu: base, uploadMs, adapter: adapter.info?.description || adapter.info?.architecture || adapter.info?.vendor || 'GPU', keep: [adapter, device] };
}
