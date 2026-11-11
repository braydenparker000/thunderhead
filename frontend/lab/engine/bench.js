// @ts-check
// The test bench on the engine page (engine/raw/ROADMAP.md, stage 1): numbers from the real phone, not from a
// server's software GPU. Two parts, each a tap:
//   Check the pictures  develops a made-up photo whose every colour is known (known.js) on this phone's graphics
//                       chip and compares the result with the truth and with a reference GPU's numbers
//                       (bench-ref.json): a driver that computes a slightly wrong picture is caught here.
//   Time a RAF          opens a RAF of the owner's and times every stage the editor goes through: decode, the
//                       first picture, a slider's frame, a screenful at 100 %, a full-size export; and how much
//                       memory the page held at its fullest.
// Nothing leaves the phone. The result is text to copy; the last runs are kept in this browser to compare.
import { engine } from './gpu.js';
import { demosaicer, phaseOf } from './demosaic.js';
import { denoiser } from './denoise.js';
import { sharpener } from './deconv.js';
import { noiseAt } from './noise.js';
import { full } from './full.js';
import { develop } from './export.js';
import { jpeg } from './files.js';
import { CAMERA, known, score } from './known.js';

const N = 480;
/** How far this GPU's numbers may sit from the reference's and still be the same picture: dB, and a square's mean
 * (of 1). Two correct GPUs round differently in the last place; a wrong one is off by far more. */
export const NEAR = { db: 0.15, grid: 0.006 };
const median = (/** @type {number[]} */ t) => [...t].sort((a, b) => a - b)[t.length >> 1];
const round = (/** @type {number} */ v) => Math.round(v);

/** The known mosaic developed on `device`: demosaic, then noise reduction and sharpening if asked.
 * @param {GPUDevice} device @param {ReturnType<typeof known>} k
 * @param {{ noise?: number, colour?: number, iso?: number, sharp?: number[], quick?: boolean }} [o] the sliders as the plates show them; `quick`: the first look alone */
async function developed(device, k, o = {}) {
  const n = k.n, make = device.createBuffer.bind(device);
  device.createBuffer = (d) => make({ ...d, usage: d.usage & GPUBufferUsage.MAP_READ ? d.usage : d.usage | GPUBufferUsage.COPY_SRC });   // so the result can be read back
  try {
    const tex = device.createTexture({ size: [n, n], format: 'r16uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: tex }, k.mosaic, { bytesPerRow: n * 2 }, [n, n]);
    const phase = phaseOf(k.meta);
    if (!phase) throw new Error('the pattern was not recognised');
    const dm = await demosaicer(device, tex, { phase, black: CAMERA.black, white: CAMERA.white, wb: CAMERA.wb, quick: o.quick }, n, n), enc = device.createCommandEncoder(), made = [dm];
    dm.run(enc, 0, 0, n, n, null);
    if (o.noise || o.colour) { const dn = await denoiser(device, dm.out); made.push(dn); dn.run(enc, n, n, noiseAt(o.iso || 160), (2.5 * (o.noise || 0)) / 100, (4 * (o.colour || 0)) / 100); }
    if (o.sharp) { const sh = await sharpener(device, dm.out); made.push(sh); sh.run(enc, n, n, CAMERA.wb, o.sharp[0] / 40, o.sharp[1], o.sharp[2] / 100); }
    const read = make({ size: n * n * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc.copyBufferToBuffer(dm.out, 0, read, 0, n * n * 8); device.queue.submit([enc.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const u = new Uint32Array(read.getMappedRange().slice(0)), f = new Float32Array(n * n * 3);
    for (let i = 0; i < n * n; i++) { f[i * 3] = (u[i * 2] & 65535) / 65535; f[i * 3 + 1] = (u[i * 2] >>> 16) / 65535; f[i * 3 + 2] = (u[i * 2 + 1] & 65535) / 65535; }
    read.destroy(); tex.destroy(); for (const m of made) m.destroy();
    return f;
  } finally { device.createBuffer = make; }
}
/** A shown frame as the mean of each colour in each of 8 × 8 squares (of 1). @param {ImageData} im */
function squares(im) {
  const G = 8, g = new Float64Array(G * G * 3), pw = im.width / G, ph = im.height / G;
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) for (let c = 0; c < 3; c++) g[(Math.floor(y / ph) * G + Math.floor(x / pw)) * 3 + c] += im.data[(y * im.width + x) * 4 + c] / 255 / (pw * ph);
  return Array.from(g, (v) => Math.round(v * 1e4) / 1e4);
}
/** @typedef {{ psnr?: number, green?: number, colour?: number, grid: number[] }} Shot */
/** Develops the known photo every way the editor does and returns each result's numbers.
 * @returns {Promise<{ gpu: string, shots: Record<string, Shot> }>} */
export async function pictures() {
  const clean = known(N), noisy = known(N, 6400), eng = await engine(document.createElement('canvas'), clean, true), device = eng.gpu.device;
  /** @type {Record<string, Shot>} */
  const shots = {};
  try {
    shots.demosaic = score(await developed(device, clean), clean.truth, N);
    shots.faster = score(await developed(device, clean, { quick: true }), clean.truth, N);   // Full-size detail: Faster
    shots.sharpened = score(await developed(device, clean, { sharp: [40, 1, 25] }), clean.crisp, N);   // against the scene before the lens
    shots.denoised = score(await developed(device, noisy, { iso: 6400, noise: 50, colour: 25 }), clean.truth, N);
    eng.setProfile(null);
    await eng.render(0.25, 1);
    shots.frame = { grid: squares(await eng.snapshot()) };
    await eng.render(0.25, 1.2, { highlights: -0.5, shadows: 0.5, whites: 0.1, blacks: -0.1, saturation: 0.3, vibrance: 0.2, clarity: 0.4, texture: 0.3, dehaze: 0.2 });
    shots.edited = { grid: squares(await eng.snapshot()) };
  } finally { eng.dispose(); }
  return { gpu: eng.adapter, shots };
}
/** Each shot against the reference: whether it is the same picture, and by how much it is off at most.
 * @param {Record<string, Shot>} shots @param {Record<string, Shot>} ref */
export function judge(shots, ref) {
  return Object.fromEntries(Object.entries(shots).map(([name, s]) => {
    const r = ref[name];
    if (!r) return [name, { same: false, why: 'no reference' }];
    const db = Math.max(...(/** @type {const} */ (['psnr', 'green', 'colour'])).map((k) => Math.abs((s[k] ?? 0) - (r[k] ?? 0)))), grid = Math.max(...s.grid.map((v, i) => Math.abs(v - r.grid[i])));
    return [name, { same: db <= NEAR.db && grid <= NEAR.grid, db: Math.round(db * 100) / 100, grid: Math.round(grid * 1e4) / 1e4 }];
  }));
}

/** Times every stage on a RAF. @param {ArrayBuffer} buf @param {{ exportToo: boolean, canvas: HTMLCanvasElement, readback: boolean, say: (s: string) => void }} o */
export async function timings(buf, o) {
  /** @type {Record<string, number | string>} */
  const t = {}, heap = () => /** @type {any} */ (performance).memory?.usedJSHeapSize || 0;
  let peak = heap();
  const watch = setInterval(() => { peak = Math.max(peak, heap()); }, 200), worker = new Worker(new URL('./decode-worker.js', import.meta.url), { type: 'module' });
  const heard = /** @type {Map<string, (d: any) => void>} */ (new Map());
  worker.onmessage = (m) => { if (!m.data.preview) heard.get(m.data.mosaic ? 'mosaic' : m.data.tag)?.(m.data); };
  const wait = (/** @type {string} */ tag) => new Promise((res) => heard.set(tag, res));
  let asked = 0, eng = null, big = null;
  const band = (/** @type {Uint8Array} */ rgb, /** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ q, /** @type {boolean} */ fine) => { const tag = `j${++asked}`, got = wait(tag).then((d) => { heard.delete(tag); if (!d.jpeg) throw new Error(d.error); return d.jpeg; }); worker.postMessage({ jpeg: [rgb, w, h, q, fine], tag }, [rgb.buffer]); return got; };
  try {
    o.say('Decoding…');
    let t0 = performance.now();
    const first = wait('raf'), sensor = wait('mosaic');
    worker.postMessage({ buf, full: true, tag: 'raf' }, [buf]);
    const r = /** @type {any} */ (await first);
    if (r.error) throw new Error(r.error);
    t.decode_ms = round(r.decodeMs); t.decode_threads = r.threads; t.editing_copy_ms = round(performance.now() - t0);
    const mosaic = /** @type {any} */ (await sensor).mosaic;
    t.sensor_pixels_ms = round(performance.now() - t0); t.camera = `${r.meta.model} ${r.meta.fullWidth}x${r.meta.fullHeight}`; t.hot_pixels = r.meta.hot || 0;
    o.say('The first picture…');
    t0 = performance.now();
    eng = await engine(o.canvas, r, o.readback);
    eng.setProfile(null);
    await eng.render(0.25, 1);
    t.first_picture_ms = round(performance.now() - t0); t.gpu = eng.adapter;
    const frames = [], baked = [];
    for (let i = 0; i < 24; i++) frames.push(await eng.render(0.25 + (i % 8) * 0.05, 1));
    for (let i = 0; i < 6; i++) baked.push(await eng.render(0.25, 1 + (i + 1) * 0.01));
    t.slider_frame_ms = round(median(frames)); t.slider_frame_worst_ms = round(Math.max(...frames)); t.contrast_frame_ms = round(median(baked));
    o.say('A screenful at 100 %…');
    t0 = performance.now();
    big = await full(eng, r, mosaic);
    if (!big) throw new Error('this RAF has no full-size data the engine reads');
    t.sensor_to_gpu_ms = round(performance.now() - t0);
    const vw = Math.min(1080, big.width), vh = Math.min(1440, big.height), v = await big.view(vw, vh, null, false, false), [rw, rh] = v.room();
    await eng.render(0.25, 1, { sharpen: 0.4, colorNoise: 0.25, fit: false });   // as a photo opens: Sharpening 40, Color noise 25
    t0 = performance.now(); await v.region(big.width / 2, big.height / 2, rw, rh); t.full_view_first_ms = round(performance.now() - t0);
    const again = [];
    for (let i = 0; i < 3; i++) { t0 = performance.now(); await v.region((big.width / 5) * (i + 1), (big.height / 5) * (i + 1), rw, rh); again.push(performance.now() - t0); }
    t.full_view_ms = round(median(again)); t.full_view_pixels = `${rw}x${rh}`;
    await eng.render(0.25, 1, { sharpen: 0.4, colorNoise: 0.25, noise: 0.5, fit: false });
    t0 = performance.now(); await v.region(big.width / 3, big.height / 2, rw, rh); t.full_view_noise50_ms = round(performance.now() - t0);
    v.dispose();
    if (o.exportToo) {
      t0 = performance.now();
      const [out] = await develop(big, [{ long: Math.max(big.width, big.height), open: (w, h) => jpeg(w, h, 90, band, null) }], (p) => o.say(`Exporting at full size… ${Math.round(p * 100)} %`));
      t.export_full_jpeg_ms = round(performance.now() - t0); t.export_megabytes = Math.round(out.blob.size / 1e5) / 10; t.export_pixels = `${out.width}x${out.height}`;
    }
    peak = Math.max(peak, heap());
    t.js_heap_peak_mb = round(peak / 1e6);
    const whole = /** @type {any} */ (performance).measureUserAgentSpecificMemory;
    if (whole && crossOriginIsolated) { o.say('Measuring memory…'); const m = await Promise.race([whole.call(performance), new Promise((res) => setTimeout(() => res(null), 12_000))]).catch(() => null); if (m) t.page_memory_mb = round(/** @type {any} */ (m).bytes / 1e6); }
    return t;
  } finally { clearInterval(watch); big?.dispose(); eng?.dispose(); worker.terminate(); }
}

/** This phone, as far as a page can tell. */
export const phone = async () => ({
  cores: navigator.hardwareConcurrency || 0, memory_gb: /** @type {any} */ (navigator).deviceMemory || 0, screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
  isolated: crossOriginIsolated, storage_kept: (await navigator.storage?.persisted?.().catch(() => false)) || false,
  browser: /Chrome\/(\d+)/.exec(navigator.userAgent)?.[0] || 'unknown', android: /Android [\d.]+/.exec(navigator.userAgent)?.[0] || '',
});
