// @ts-check
// The pipeline on WebGPU (Chrome on Android, Safari from iOS 26): the same passes as gl.js in WGSL
// (shaders/), the source as r16float planes or an rgba8 bitmap, the proxy and blur levels in
// rgba16float, the develop pass to the canvas or, for the histogram and the pickers, to a small
// rgba8 target read back.
import { DEVELOP_WGSL } from './shaders/develop.wgsl.js';
import { BLUR_WGSL, PREP_WGSL } from './shaders/prep.wgsl.js';

/** @typedef {import('./renderer.js').Source} Source */

/** @param {HTMLCanvasElement} canvas @param {{ offscreen?: boolean }} [o] offscreen: read only, never presented */
export async function webgpu(canvas, o = {}) {
  const gpu = /** @type {any} */ (navigator).gpu;
  const adapter = await gpu?.requestAdapter();
  if (!adapter) throw new Error('WebGPU is not available');
  const device = await adapter.requestDevice();
  device.addEventListener('uncapturederror', (/** @type {any} */ e) => console.error(`WebGPU: ${e.error?.message}`));
  device.lost.then((/** @type {any} */ i) => console.warn(`WebGPU lost: ${i.message}`));
  const ctx = /** @type {any} */ (canvas.getContext('webgpu'));
  if (!ctx) throw new Error('no WebGPU canvas');
  const format = gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });
  // One cleared frame first: a device the page cannot present with ends here (seen with software
  // adapters), and the editor takes WebGL2 instead.
  let lost = false;
  device.lost.then(() => { lost = true; });
  if (!o.offscreen) {
  const enc0 = device.createCommandEncoder();
  enc0.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] }).end();
  device.queue.submit([enc0.finish()]);
  await device.queue.onSubmittedWorkDone();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (lost) throw new Error('WebGPU cannot present here');
  }
  const T = /** @type {any} */ (globalThis).GPUTextureUsage, B = /** @type {any} */ (globalThis).GPUBufferUsage;
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const pipe = (/** @type {string} */ code, /** @type {string} */ fmt) => {
    const module = device.createShaderModule({ code });
    return device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: fmt }] }, primitive: { topology: 'triangle-list' } });
  };
  device.pushErrorScope('validation');
  const P = { prep: pipe(PREP_WGSL, 'rgba16float'), blur: pipe(BLUR_WGSL, 'rgba16float'), screen: pipe(DEVELOP_WGSL, format), bytes: pipe(DEVELOP_WGSL, 'rgba8unorm') };
  const bad = await device.popErrorScope();
  if (bad) { console.warn(`WebGPU shaders: ${bad.message}`); device.destroy(); throw new Error(`WebGPU shaders: ${bad.message}`); }
  const tex = (/** @type {number} */ w, /** @type {number} */ h, /** @type {string} */ fmt, extra = 0) =>
    device.createTexture({ size: [w, h], format: fmt, usage: T.TEXTURE_BINDING | T.COPY_DST | T.RENDER_ATTACHMENT | extra });
  const uniform = (/** @type {Float32Array} */ data) => {
    const b = device.createBuffer({ size: data.byteLength, usage: B.UNIFORM | B.COPY_DST });
    device.queue.writeBuffer(b, 0, data);
    return b;
  };
  /** @param {any} enc @param {any} pipeline @param {any} view @param {any[]} entries */
  const run = (enc, pipeline, view, entries) => {
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: entries.map((resource, binding) => ({ binding, resource })) });
    const pass = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
  };
  const taps = (/** @type {number} */ from, /** @type {number} */ to) => Math.min(4, Math.max(1, Math.ceil(from / to)));
  /** @param {Source} s */
  const upload = (s) => {
    if (s.kind === 'planar') return [0, 1, 2].map((c) => {
      const t = tex(s.width, s.height, 'r16float');
      device.queue.writeTexture({ texture: t }, s.data.subarray(c * s.width * s.height, (c + 1) * s.width * s.height), { bytesPerRow: s.width * 2 }, [s.width, s.height]);
      return t;
    });
    const t = tex(s.width, s.height, 'rgba8unorm');
    device.queue.copyExternalImageToTexture({ source: s.bitmap }, { texture: t }, [s.width, s.height]);
    return [t];
  };
  /** @param {any} enc @param {any} dst @param {any[]} src @param {number} mode @param {number[]} region @param {number} n */
  const prep = (enc, dst, src, mode, region, n, keep = /** @type {any[]} */ ([])) => {
    const u = uniform(new Float32Array([...region, dst.width, dst.height, mode, n]));
    keep.push(u);
    run(enc, P.prep, dst.createView(), [{ buffer: u }, sampler, src[0].createView(), (src[1] ?? src[0]).createView(), (src[2] ?? src[0]).createView()]);
  };
  const lut = tex(1024, 1, 'rgba16float');

  /** @type {{ src: any[], mode: number, w: number, h: number, p0: any, levels: any[] } | null} */
  let base = null;
  /** @type {any} */
  let p1 = null;
  const develop = (/** @type {any} */ view, /** @type {any} */ pipeline, /** @type {Float32Array} */ u, /** @type {Uint16Array} */ table, /** @type {any} */ enc) => {
    if (!base) return null;
    device.queue.writeTexture({ texture: lut }, table, { bytesPerRow: 1024 * 8 }, [1024, 1]);
    const b = uniform(u);
    run(enc, pipeline, view, [{ buffer: b }, sampler, base.p0.createView(), (p1 ?? base.p0).createView(), base.levels[0].createView(), base.levels[1].createView(), lut.createView()]);
    return b;
  };

  return {
    kind: /** @type {const} */ ('webgpu'),
    // Held for the renderer's life: Chromium ends the device when its adapter is collected.
    adapter,
    device,
    maxSize: /** @type {number} */ (device.limits.maxTextureDimension2D),
    /** @param {Source} s @param {number} pw @param {number} ph */
    source(s, pw, ph) {
      if (base) { base.src.forEach((t) => t.destroy()); base.p0.destroy(); base.levels.forEach((t) => t.destroy()); }
      p1?.destroy();
      p1 = null;
      const src = upload(s), mode = s.kind === 'planar' ? 0 : 1, p0 = tex(pw, ph, 'rgba16float');
      const enc = device.createCommandEncoder(), keep = /** @type {any[]} */ ([]);
      prep(enc, p0, src, mode, [0, 0, 1, 1], taps(s.width, pw), keep);
      const levels = [], temps = [];
      let from = p0;
      for (const m of [2, 3]) {
        const w = Math.max(1, Math.ceil(from.width / 4)), h = Math.max(1, Math.ceil(from.height / 4));
        const r = tex(w, h, 'rgba16float'), tmp = tex(w, h, 'rgba16float'), out = tex(w, h, 'rgba16float');
        prep(enc, r, [from], m, [0, 0, 1, 1], 4, keep);
        for (const [dst, s2, dx, dy] of [[tmp, r, 1, 0], [out, tmp, 0, 1]]) {
          const u = uniform(new Float32Array([dx / s2.width, dy / s2.height, w, h, 0, 0, 0, 0]));
          keep.push(u);
          run(enc, P.blur, dst.createView(), [{ buffer: u }, sampler, s2.createView()]);
        }
        temps.push(r, tmp);
        levels.push(out);
        from = out;
      }
      device.queue.submit([enc.finish()]);
      temps.forEach((t) => t.destroy());
      keep.forEach((b) => b.destroy());
      base = { src, mode, w: s.width, h: s.height, p0, levels };
    },
    /** @param {Source | null} tile @param {number[]} region @param {number} w @param {number} h */
    detail(tile, region, w, h) {
      if (!base) return;
      p1?.destroy();
      p1 = tex(w, h, 'rgba16float');
      const enc = device.createCommandEncoder(), keep = /** @type {any[]} */ ([]);
      const t = tile ? upload(tile) : null;
      if (tile && t) prep(enc, p1, t, tile.kind === 'planar' ? 0 : 1, [0, 0, 1, 1], taps(tile.width, w), keep);
      else prep(enc, p1, base.src, base.mode, region, taps((region[2] - region[0]) * base.w, w), keep);
      device.queue.submit([enc.finish()]);
      t?.forEach((x) => x.destroy());
      keep.forEach((b) => b.destroy());
    },
    clearDetail() { p1?.destroy(); p1 = null; },
    /** @param {Float32Array} u @param {Uint16Array} table */
    draw(u, table) {
      const enc = device.createCommandEncoder();
      const b = develop(ctx.getCurrentTexture().createView(), P.screen, u, table, enc);
      device.queue.submit([enc.finish()]);
      b?.destroy();
    },
    /** @param {Float32Array} u @param {Uint16Array} table @param {number} w @param {number} h */
    async read(u, table, w, h) {
      const t = tex(w, h, 'rgba8unorm', T.COPY_SRC);
      const row = Math.ceil((w * 4) / 256) * 256;
      const out = device.createBuffer({ size: row * h, usage: B.COPY_DST | B.MAP_READ });
      const enc = device.createCommandEncoder();
      const b = develop(t.createView(), P.bytes, u, table, enc);
      enc.copyTextureToBuffer({ texture: t }, { buffer: out, bytesPerRow: row }, [w, h]);
      device.queue.submit([enc.finish()]);
      await out.mapAsync(/** @type {any} */ (globalThis).GPUMapMode.READ);
      const src = new Uint8Array(out.getMappedRange());
      const px = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) px.set(src.subarray(y * row, y * row + w * 4), y * w * 4);
      out.unmap();
      [out, t, b].forEach((x) => x?.destroy());
      return px;
    },
  };
}
