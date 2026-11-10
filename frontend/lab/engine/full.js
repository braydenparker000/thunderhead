// @ts-check
// Full resolution, for 100 % and export: the sensor's own pixels on the GPU, and views of them. A view is a
// rectangle of the upright photo at one sensor pixel a pixel. demosaic.js makes its colours; the frame pass
// that develops the editing copy (wgsl.js) then develops them, with the same colour table and tone mask, so a
// view matches the fitted photo and follows every control. Only what is looked at is ever made: a screenful at
// 100 %, or one band of an export.
import { demosaicer, phaseOf } from './demosaic.js';
import { WGSL } from './wgsl.js';

// the frame pass writing 16-bit floats, for export: compiled at the first export, kept with its device
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
  const { device, lut, rot, views } = e.gpu, W = /** @type {number} */ (img.meta.fullWidth), H = /** @type {number} */ (img.meta.fullHeight), phase = phaseOf(img.meta);
  if (!phase || mosaic.length !== W * H || Math.max(W, H) > device.limits.maxTextureDimension2D) return null;
  const tex = device.createTexture({ size: [W, H], format: 'r16uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const BAND = 1024;   // rows a step: 80 MB goes over without holding the page still
  for (let y = 0; y < H; y += BAND) {
    device.queue.writeTexture({ texture: tex, origin: [0, y] }, mosaic, { offset: y * W * 2, bytesPerRow: W * 2 }, [W, Math.min(BAND, H - y)]);
    await new Promise((r) => setTimeout(r));
  }
  const [fw, fh] = rot % 2 ? [H, W] : [W, H], info = { phase, black: /** @type {number} */ (img.meta.black), white: /** @type {number} */ (img.meta.white) };
  const open = /** @type {Set<() => void>} */ (new Set());
  /** A view of up to maxW × maxH pixels, shown on `canvas` if one is given. Once it has a place it follows the
   * engine's renders: `onframe` is called, in the task that draws it, with the rectangle each one shows.
   * @param {number} maxW @param {number} maxH @param {HTMLCanvasElement | null} [canvas]
   * @param {boolean} [readback] show through a 2D canvas (headless Chromium can't present a WebGPU one)
   * @param {boolean} [deep] for export: 16-bit floats and no dither, read with `read()` as half floats */
  const view = async (maxW, maxH, canvas = null, readback = false, deep = false) => {
    [maxW, maxH] = [Math.min(maxW, fw), Math.min(maxH, fh)];
    const pipe = deep ? await deepPipe(device) : e.gpu.pipe, size = deep ? 8 : 4;
    const dm = await demosaicer(device, tex, info, rot % 2 ? maxH : maxW, rot % 2 ? maxW : maxH);
    const uni = device.createBuffer({ size: 352, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const out = device.createTexture({ size: [maxW, maxH], format: deep ? 'rgba16float' : 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
    const ctx = canvas && !readback ? /** @type {GPUCanvasContext} */ (canvas.getContext('webgpu')) : null;
    ctx?.configure({ device, format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT, alphaMode: 'opaque' });
    /** @typedef {{ X: number, Y: number, cw: number, ch: number, rx: number, ry: number, rw: number, rh: number }} Rect */
    let bind = /** @type {GPUBindGroup | null} */ (null);
    let at = /** @type {Rect | null} */ (null), made = at, fresh = false;   // asked for; drawn; its colours are made
    const self = { place, rest: () => { at = null; }, region, read, halves, dispose, at: () => at, onframe: /** @type {null | ((at: Rect) => void)} */ (null) };
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
      /** @param {GPUBuffer} tab the profile's tables, re-made with each profile */
      bind: (tab) => { bind = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: dm.out } }, { binding: 1, resource: { buffer: uni } }, { binding: 2, resource: out.createView() }, { binding: 3, resource: { buffer: tab } }, { binding: 5, resource: lut.createView() }, { binding: 6, resource: e.gpu.mask }] }); },
      /** The view's part of a render: the rectangle's colours if it moved, then the frame pass over it with the
       * frame's settings, its own size, and where it sits in the tone mask. @param {GPUCommandEncoder} enc @param {ArrayBuffer} u */
      frame: (enc, u) => {
        if (!at || !bind) return;
        if (!fresh) { dm.run(enc, at.rx, at.ry, at.rw, at.rh); fresh = true; }
        const c = u.slice(0), n = new Uint32Array(c), f = new Float32Array(c);
        n[52] = at.rw; n[53] = at.rh; if (deep) n[55] |= 1024; f[51] = 1 / 3; f[74] = at.rx / 3; f[75] = at.ry / 3;
        device.queue.writeBuffer(uni, 0, c);
        const pass = enc.beginComputePass();
        pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(Math.ceil(at.rw / 8), Math.ceil(at.rh / 8)); pass.end();
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
    /** Aims the view at the rectangle whose top left is (X, Y) in the upright photo, cw × ch pixels (kept inside
     * the photo and the view's size). The engine's next render draws it. Returns where it ended up.
     * @param {number} X @param {number} Y @param {number} cw @param {number} ch */
    function place(X, Y, cw, ch) {
      cw = Math.max(8, Math.min(Math.round(cw), maxW)); ch = Math.max(8, Math.min(Math.round(ch), maxH));
      X = Math.max(0, Math.min(Math.round(X), fw - cw)); Y = Math.max(0, Math.min(Math.round(Y), fh - ch));
      if (at && at.X === X && at.Y === Y && at.cw === cw && at.ch === ch) return at;
      const [rx, ry, rw, rh] = [[X, Y, cw, ch], [Y, H - X - cw, ch, cw], [W - X - cw, H - Y - ch, cw, ch], [W - Y - ch, X, ch, cw]][rot];
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
    function dispose() { if (!open.delete(dispose)) return; views.splice(views.indexOf(hook), 1); dm.destroy(); uni.destroy(); out.destroy(); }
    hook.bind(e.gpu.tab()); views.push(hook); open.add(dispose);
    return self;
  };
  return { width: fw, height: fh, view, dispose: () => { for (const d of [...open]) d(); tex.destroy(); } };
}
