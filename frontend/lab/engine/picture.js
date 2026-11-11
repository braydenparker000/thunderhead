// @ts-check
// A photo that is a finished picture already (a JPEG), where a RAF's sensor data would be. `still` makes of it
// what the decoder makes of a RAF (and runs on the decoder's thread, decode-worker.js): an editing copy a third of
// its size in linear light, and what the engine needs to know of it. The picture's own pixels then stand where the sensor's would (full.js): `copier` gives
// rectangles of them in the form the demosaic gives its own, so noise reduction, sharpening, the lens pass, the
// frame and an export all work on a JPEG as they do on a RAF. Nothing here guesses at a camera: the picture's
// colours are sRGB made linear, its white is the screen's, and its tones are left as they are (gpu.js keeps the
// tone curve straight for `meta.picture`).
import { SPOTS, SPOT_ROWS, mendWGSL } from './mend.js';

/** XYZ (D65) to linear sRGB: for a picture this stands where a camera's matrix does. */
export const XYZ_TO_SRGB = [3.2404542, -1.5371385, -0.4985314, -0.969266, 1.8760108, 0.041556, 0.0556434, -0.2040259, 1.0572252];
/** The longest side kept: what every GPU's textures hold (8192), in whole editing-copy pixels. */
export const MOST = 8190;
const LIN = Uint16Array.from({ length: 256 }, (_, v) => { const c = v / 255; return Math.round(65535 * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); });

/** Reads a picture file. Upright already (the browser applies the file's own orientation), in sRGB (the browser
 * converts a file in another colour space), and no larger than `most` on its longer side.
 * @param {Blob} blob @param {number} [most]
 * @returns {Promise<{ proxy: Uint16Array, width: number, height: number, meta: any, picture: ImageBitmap }>} `picture`: its own pixels, for full.js */
export async function still(blob, most = MOST) {
  let bm = await createImageBitmap(blob);
  const k = Math.min(1, most / Math.max(bm.width, bm.height));
  if (k < 1) {   // larger than a texture holds: reduced once, through a canvas (which averages as it reduces)
    const c = new OffscreenCanvas(Math.floor(bm.width * k), Math.floor(bm.height * k)), g = /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext('2d'));
    g.imageSmoothingQuality = 'high'; g.drawImage(bm, 0, 0, c.width, c.height); bm.close(); bm = c.transferToImageBitmap();
  }
  const w = Math.floor(bm.width / 3), h = Math.floor(bm.height / 3);
  if (w < 16 || h < 16) { bm.close(); throw new Error('The picture is too small to edit.'); }
  // The editing copy: each of its pixels the mean of 3 × 3 of the picture's, taken in linear light as the decoder
  // bins a sensor's (the browser's own reducing was measured: it kept all of a noisy sky's noise). A row or two at
  // the right and bottom are left off, so it is a whole third. Read a strip at a time: the picture is never held twice.
  const ROWS = 64, W = w * 3, g = /** @type {OffscreenCanvasRenderingContext2D} */ (new OffscreenCanvas(W, ROWS * 3).getContext('2d', { willReadFrequently: true })), proxy = new Uint16Array(w * h * 4);
  for (let y0 = 0; y0 < h; y0 += ROWS) {
    const n = Math.min(ROWS, h - y0);
    g.drawImage(bm, 0, y0 * 3, W, n * 3, 0, 0, W, n * 3);
    const px = g.getImageData(0, 0, W, n * 3).data;
    for (let y = 0; y < n; y++) for (let x = 0, o = (y0 + y) * w * 4; x < w; x++, o += 4) {
      let r = 0, gr = 0, b = 0;
      for (let j = 0; j < 3; j++) for (let i = (y * 3 + j) * W * 4 + x * 12, e = i + 12; i < e; i += 4) { r += LIN[px[i]]; gr += LIN[px[i + 1]]; b += LIN[px[i + 2]]; }
      proxy[o] = (r + 4) / 9; proxy[o + 1] = (gr + 4) / 9; proxy[o + 2] = (b + 4) / 9;
    }
  }
  const meta = { make: '', model: '', picture: true, width: w, height: h, proxyWidth: w, proxyHeight: h, fullWidth: w * 3, fullHeight: h * 3, wb: [1, 1, 1, 0], xyzToCamD65: XYZ_TO_SRGB,
    orientation: 'Normal', chroma: [0, 0, 0], black: 0, white: 65535, hot: 0, iso: 0, lens: null };
  return { proxy, width: w, height: h, meta, picture: bm };
}

const WGSL = /* wgsl */ `
struct P { at: vec4i,   // the rectangle being made: x, y, width, height, in the picture's pixels
           n: vec4u,    // spots to retouch (heal.js): how many
           sp: array<vec4f, ${SPOTS * SPOT_ROWS}> };
@group(0) @binding(0) var pic: texture_2d<f32>;
@group(0) @binding(1) var<uniform> d: P;
@group(0) @binding(2) var<storage, read_write> rgb: array<u32>;   // the result, two a pixel (as demosaic.js writes it)
${mendWGSL('d.sp', 'd.n.x')}
fn own(q: vec2i) -> vec3f {
  let c = textureLoad(pic, clamp(q, vec2i(0), vec2i(textureDimensions(pic)) - 1), 0).rgb;
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}
@compute @workgroup_size(8, 8)
fn copy(@builtin(global_invocation_id) id: vec3u) {
  if (i32(id.x) >= d.at.z || i32(id.y) >= d.at.w) { return; }
  let q = d.at.xy + vec2i(id.xy); let s = vec2f(q) + 0.5;
  var v = own(q);
  nearby(s, 0.0);
  // near a retouched spot: what the spot puts there (the picture at the spot's source, brought to its surroundings)
  for (var i = 0u; i < d.n.x; i++) {
    if ((near & (1u << i)) == 0u) { continue; }
    let got = own(q + vec2i(d.sp[i * ${SPOT_ROWS}u + 1u].xy));
    for (var c = 0u; c < 3u; c++) { let k = spot(i, s, c); if (k.x > 0.0) { v[c] = mix(v[c], got[c] * k.y, k.x); } }
  }
  let u = vec3u(clamp(v, vec3f(0.0), vec3f(1.0)) * 65535.0 + 0.5); let n = (id.y * u32(d.at.z) + id.x) * 2u;
  rgb[n] = u.x | (u.y << 16u); rgb[n + 1u] = u.z;   // no colour of a picture is marked as clipped: there is nothing behind it to rebuild from
}`;

/** @type {WeakMap<GPUDevice, Promise<GPUComputePipeline>>} */
const made = new WeakMap();
/** The pass, compiled once for a device. @param {GPUDevice} device */
export function compile(device) {
  const p = made.get(device) || device.createComputePipelineAsync({ layout: 'auto', compute: { module: device.createShaderModule({ code: WGSL }), entryPoint: 'copy' } });
  made.set(device, p);
  return p;
}

/** The picture's pixels on the GPU: a texture the size of the picture's whole thirds.
 * @param {GPUDevice} device @param {ImageBitmap} picture @param {number} W @param {number} H */
export function upload(device, picture, W, H) {
  const tex = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  device.queue.copyExternalImageToTexture({ source: picture }, { texture: tex }, [W, H]);
  return tex;
}

/** Makes rectangles of a picture, each up to maxW × maxH pixels, as demosaic.js's `demosaicer` makes a sensor's:
 * `run` adds the pass to a frame's commands and the result is in `out`, rw pixels a row.
 * @param {GPUDevice} device @param {GPUTexture} tex the picture (`upload`) @param {number} maxW @param {number} maxH */
export async function copier(device, tex, maxW, maxH) {
  const pipe = await compile(device), SIZE = 32 + SPOTS * SPOT_ROWS * 16;
  const uni = device.createBuffer({ size: SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), out = device.createBuffer({ size: maxW * maxH * 8, usage: GPUBufferUsage.STORAGE });
  const bind = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: tex.createView() }, { binding: 1, resource: { buffer: uni } }, { binding: 2, resource: { buffer: out } }] });
  /** @param {GPUCommandEncoder} enc @param {number} rx @param {number} ry @param {number} rw @param {number} rh
   * @param {Float32Array | null} [spots] retouching, as heal.js's `spotRows` gives it */
  const run = (enc, rx, ry, rw, rh, spots) => {
    const u = new ArrayBuffer(SIZE), n = new Int32Array(u);
    n.set([rx, ry, rw, rh]);
    if (spots) { n[4] = spots[0]; new Float32Array(u).set(spots.subarray(4), 8); }
    device.queue.writeBuffer(uni, 0, u);
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(Math.ceil(rw / 8), Math.ceil(rh / 8)); pass.end();
  };
  return { out, run, destroy: () => { uni.destroy(); out.destroy(); } };
}
