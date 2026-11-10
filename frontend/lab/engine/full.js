// @ts-check
// Full resolution, for 100 % and export: the sensor's own pixels on the GPU, and views of them. A view is a
// rectangle of the upright photo at one sensor pixel a pixel. demosaic.js makes its colours; the frame pass
// that develops the editing copy (wgsl.js) then develops them, with the same colour table and tone mask, so a
// view matches the fitted photo and follows every control. Between the two the rectangle is laid out as the
// picture (warp.js): demosaic.js makes the part of the sensor it draws on, which is a little more than itself. Only what is looked at is ever made: a screenful at
// 100 %, or one band of an export.
import { demosaicer, phaseOf } from './demosaic.js';
import { WGSL } from './wgsl.js';
import { reach, warper } from './warp.js';
import { finishPipe } from './finish.js';
import { denoiser } from './denoise.js';

// the frame pass writing 16-bit floats, which every view uses (its last pass, finish.js, sharpens them): compiled
// at the first view, kept with its device
const deeps = /** @type {WeakMap<GPUDevice, Promise<GPUComputePipeline>>} */ (new WeakMap());
const deepPipe = (/** @type {GPUDevice} */ device) => {
  const made = deeps.get(device) || device.createComputePipelineAsync({ layout: 'auto', compute: { module: device.createShaderModule({ code: WGSL.replace('texture_storage_2d<rgba8unorm, write>', 'texture_storage_2d<rgba16float, write>') }), entryPoint: 'main' } });
  deeps.set(device, made);
  return made;
};

/** Puts a photo's sensor pixels on the GPU. Null where full resolution is not offered (a sensor that is not
 * X-Trans, or one wider than the GPU's textures).
 * @param {Awaited<ReturnType<typeof import('./gpu.js').engine>>} e the photo's engine @param {{ meta: any }} img
 * @param {Uint16Array} mosaic the decoder's mosaic(): the GPU keeps its own copy, so let go of this one after */
export async function full(e, img, mosaic) {
  const { device, lut, views, bendP } = e.gpu, W = /** @type {number} */ (img.meta.fullWidth), H = /** @type {number} */ (img.meta.fullHeight), phase = phaseOf(img.meta);
  if (!phase || mosaic.length !== W * H || Math.max(W, H) > device.limits.maxTextureDimension2D) return null;
  const tex = device.createTexture({ size: [W, H], format: 'r16uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const BAND = 1024;   // rows a step: 80 MB goes over without holding the page still
  for (let y = 0; y < H; y += BAND) {
    device.queue.writeTexture({ texture: tex, origin: [0, y] }, mosaic, { offset: y * W * 2, bytesPerRow: W * 2 }, [W, Math.min(BAND, H - y)]);
    await new Promise((r) => setTimeout(r));
  }
  const pic = () => { const g = e.gpu.geo(); return [g.ow, g.oh]; }, info = { phase, black: /** @type {number} */ (img.meta.black), white: /** @type {number} */ (img.meta.white) };
  const open = /** @type {Set<() => void>} */ (new Set());
  /** A view of up to maxW × maxH pixels, shown on `canvas` if one is given. Once it has a place it follows the
   * engine's renders: `onframe` is called, in the task that draws it, with the rectangle each one shows.
   * @param {number} maxW @param {number} maxH @param {HTMLCanvasElement | null} [canvas]
   * @param {boolean} [readback] show through a 2D canvas (headless Chromium can't present a WebGPU one)
   * @param {boolean} [deep] for export: 16-bit floats and no dither, read with `read()` as half floats */
  const view = async (maxW, maxH, canvas = null, readback = false, deep = false) => {
    const format = deep ? 'rgba16float' : 'rgba8unorm', [pipe, last] = await Promise.all([deepPipe(device), finishPipe(device, format)]), size = deep ? 8 : 4;
    // The sensor rectangle a view draws on is larger than the view: by the lens's stretch, the resampling's
    // margin and, most, a straighten angle. The demosaic's buffers hold 1.6 times the view's pixels in any
    // shape; `room` is the largest rectangle of the picture, in the view's proportions, that never needs more.
    const side = Math.ceil(Math.sqrt(maxW * maxH * 1.6)) + 32, dm = await demosaicer(device, tex, info, side, side);
    const room = () => {
      const [pw, ph] = pic(), g = e.gpu.geo();
      for (let s = 1; s > 0.2; s *= 0.9) {
        const w = Math.max(8, Math.min(pw, Math.floor(maxW * s))), h = Math.max(8, Math.min(ph, Math.floor(maxH * s)));
        if ([0, 0.5, 1].every((u) => [0, 0.5, 1].every((v) => { const r = reach(g, (pw - w) * u, (ph - h) * v, w, h); return (r[2] + 8) * (r[3] + 8) <= side * side; }))) return [w, h];
      }
      return [8, 8];
    };
    let fit = room(), cleaned = '';
    const dn = await denoiser(device, dm.out);
    const flat = device.createBuffer({ size: maxW * maxH * 8, usage: GPUBufferUsage.STORAGE }), bend = warper(device, bendP, dm.out, flat);
    const uni = device.createBuffer({ size: 416, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), funi = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    // the frame pass writes `mid`; the last pass sharpens that into `out`
    const mid = device.createTexture({ size: [maxW, maxH], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    const out = device.createTexture({ size: [maxW, maxH], format, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
    const lastBind = device.createBindGroup({ layout: last.getBindGroupLayout(0), entries: [{ binding: 0, resource: mid.createView() }, { binding: 1, resource: { buffer: funi } }, { binding: 2, resource: out.createView() }] });
    const ctx = canvas && !readback ? /** @type {GPUCanvasContext} */ (canvas.getContext('webgpu')) : null;
    ctx?.configure({ device, format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT, alphaMode: 'opaque' });
    /** @typedef {{ X: number, Y: number, cw: number, ch: number, rx: number, ry: number, rw: number, rh: number }} Rect */
    let bind = /** @type {GPUBindGroup | null} */ (null);
    let at = /** @type {Rect | null} */ (null), made = at, fresh = false;   // asked for; drawn; its colours are made
    const self = { place, rest: () => { at = null; }, region, read, halves, dispose, room: () => fit, at: () => at, onframe: /** @type {null | ((at: Rect) => void)} */ (null) };
    /** The view's pixels as last drawn, four values each: bytes, or a deep view's half floats. */
    async function bytes() {
      if (!made) throw new Error('no region yet');
      const { cw, ch } = made, row = Math.ceil((cw * size) / 256) * 256, enc = device.createCommandEncoder();
      const b = device.createBuffer({ size: row * ch, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      enc.copyTextureToBuffer({ texture: out }, { buffer: b, bytesPerRow: row }, [cw, ch]); device.queue.submit([enc.finish()]);
      await b.mapAsync(GPUMapMode.READ);
      const b8 = new Uint8Array(b.getMappedRange()), px = new Uint8ClampedArray(cw * ch * size);
      for (let y = 0; y < ch; y++) px.set(b8.subarray(y * row, y * row + cw * size), y * cw * size);
      b.unmap(); b.destroy();
      return px;
    }
    async function read() { return new ImageData(await bytes(), /** @type {Rect} */ (made).cw); }
    async function halves() { return new Uint16Array((await bytes()).buffer); }
    const hook = {
      /** The geometry changed: the same rectangle of the picture now draws on another part of the sensor. */
      bent: () => { fit = room(); const a = at; if (a) { at = null; place(a.X, a.Y, a.cw, a.ch); } },
      /** @param {GPUBuffer} tab the profile's tables, re-made with each profile */
      bind: (tab) => { bind = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: flat } }, { binding: 1, resource: { buffer: uni } }, { binding: 2, resource: mid.createView() }, { binding: 3, resource: { buffer: tab } }, { binding: 5, resource: lut.createView() }, { binding: 6, resource: e.gpu.mask }, { binding: 7, resource: e.gpu.fine }, { binding: 8, resource: e.gpu.haze }] }); },
      /** The view's part of a render: the rectangle's colours if it moved, then the frame pass over it with the
       * frame's settings, its own size, and where it sits in the tone mask. @param {GPUCommandEncoder} enc @param {ArrayBuffer} u */
      frame: (enc, u) => {
        if (!at || !bind) return;
        const c = u.slice(0), n = new Uint32Array(c), f = new Float32Array(c);
        if (cleaned !== `${f[100]},${f[101]}`) { cleaned = `${f[100]},${f[101]}`; fresh = false; }   // noise reduction is part of the rectangle's colours
        if (!fresh) {
          dm.run(enc, at.rx, at.ry, at.rw, at.rh);
          if (f[100] > 0 || f[101] > 0) dn.run(enc, at.rw, at.rh, e.gpu.noise, f[100], f[101]);
          bend.run(enc, e.gpu.geo(), { x: at.X, y: at.Y, scale: 1, w: at.cw, h: at.ch }, { x: at.rx, y: at.ry, scale: 1, w: at.rw, h: at.rh });
          fresh = true;
        }
        n[52] = at.cw; n[53] = at.ch; n[55] |= 1024; f[51] = 1 / 3; f[74] = at.X / 3; f[75] = at.Y / 3;   // no dither yet: the last pass does it
        device.queue.writeBuffer(uni, 0, c);
        const fu = new ArrayBuffer(32); new Uint32Array(fu).set([at.cw, at.ch, deep ? 0 : 1, 0]); new Float32Array(fu).set([f[96], f[97], f[98], 0], 4);
        device.queue.writeBuffer(funi, 0, fu);
        const pass = enc.beginComputePass();
        pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(Math.ceil(at.cw / 8), Math.ceil(at.ch / 8));
        pass.setPipeline(last); pass.setBindGroup(0, lastBind); pass.dispatchWorkgroups(Math.ceil(at.cw / 8), Math.ceil(at.ch / 8)); pass.end();
        made = at;
        if (canvas && (canvas.width !== at.cw || canvas.height !== at.ch)) { canvas.width = at.cw; canvas.height = at.ch; }
        if (ctx) enc.copyTextureToTexture({ texture: out }, { texture: ctx.getCurrentTexture() }, [at.cw, at.ch]);
        if (!readback) self.onframe?.(at);
      },
      after: async () => {
        if (!readback || !canvas || !made) return;
        const was = made, px = await read();
        /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')).putImageData(px, 0, 0); self.onframe?.(was);
      },
    };
    /** Aims the view at the rectangle whose top left is (X, Y) in the picture, cw × ch pixels (kept inside the
     * picture and the view's room). The engine's next render draws it. Returns where it ended up.
     * @param {number} X @param {number} Y @param {number} cw @param {number} ch */
    function place(X, Y, cw, ch) {
      const [fw, fh] = pic();
      cw = Math.max(8, Math.min(Math.round(cw), fit[0])); ch = Math.max(8, Math.min(Math.round(ch), fit[1]));
      X = Math.max(0, Math.min(Math.round(X), fw - cw)); Y = Math.max(0, Math.min(Math.round(Y), fh - ch));
      if (at && at.X === X && at.Y === Y && at.cw === cw && at.ch === ch) return at;
      const [rx, ry, rw, rh] = reach(e.gpu.geo(), X, Y, cw, ch);
      fresh = false;
      return (at = { X, Y, cw, ch, rx, ry, rw, rh });
    }
    /** place(), drawn now with the last shown frame's settings (a test, or one band of an export).
     * @param {number} X @param {number} Y @param {number} cw @param {number} ch */
    async function region(X, Y, cw, ch) {
      const r = place(X, Y, cw, ch), enc = device.createCommandEncoder();
      hook.frame(enc, e.gpu.settings());
      device.queue.submit([enc.finish()]);
      await device.queue.onSubmittedWorkDone();
      await hook.after();
      return r;
    }
    function dispose() { if (!open.delete(dispose)) return; views.splice(views.indexOf(hook), 1); dm.destroy(); dn.destroy(); bend.destroy(); flat.destroy(); uni.destroy(); funi.destroy(); mid.destroy(); out.destroy(); }
    hook.bind(e.gpu.tab()); views.push(hook); open.add(dispose);
    return self;
  };
  return { get width() { return pic()[0]; }, get height() { return pic()[1]; }, view, dispose: () => { for (const d of [...open]) d(); tex.destroy(); } };
}
