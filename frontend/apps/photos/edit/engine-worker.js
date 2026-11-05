// @ts-check
// The RAW engine in a Web Worker (engine/photos, PHOTOS.md the editor): the original streams from
// Drive (or a picked file) straight into wasm memory, the headers decode at once (the embedded JPEG
// goes back first), then the working copy in two stages (PHOTOS.md, the two-stage decode): a RAF's
// half-size copy binned from the mosaic with no demosaic (`half`, the editor's first frame), then the
// same size demosaiced at full resolution (`full`), each out of wasm in bands (planes.js) and handed
// over as one transferred buffer of f16 planes. On a cross-origin isolated page the threaded build runs
// rayon on min(4, cores) workers; anywhere else the plain build runs on this one.
// A body with no matrix in the engine gets one fitted from its camera JPEG (fit.js; kept per model by the
// page and sent back with `fits`), and every such photo its baseline exposure from its own JPEG.
import { baseline, cells, fitMatrix, inverse, mul } from './fit.js';
import { gather, remap } from './planes.js';
// The generated glue (scripts/photos-engine.mjs), loaded by address so the type check leaves it be.
const ENGINE = '/photos/engine/';
const THREADS = Math.min(4, navigator.hardwareConcurrency || 1);
/** A pool whose workers never report ready (a worker script refused) is given up for the one-thread build. */
const POOL_START_MS = 10_000;

/** @type {any} */
let wasm = null;
/** The worker's own postMessage (the DOM typings see a window's). */
const post = /** @type {(m: unknown, t?: Transferable[]) => void} */ (/** @type {any} */ (self).postMessage.bind(self));
/** @type {any} */
let engine = null;
/** @type {any} */
let Engine = null;

const planes = (/** @type {{ ptr: number, width: number, height: number }} */ b) => {
  const n = b.width * b.height * 3;
  const out = new Uint16Array(n);
  out.set(new Uint16Array(wasm.memory.buffer, b.ptr, n));
  return out;
};

const rows = (/** @type {number[]} */ m) => [0, 1, 2].map((r) => m.slice(r * 3, r * 3 + 3));
/** The matrix (stored, else fitted now) and this photo's baseline, set in the engine (and in `own`, a copy already
 * out of wasm); what was done, for the page.
 * @param {any} meta @param {{ ptr: number, width: number, height: number }} w @param {{ matrix: number[][] } | undefined} known @param {Uint8Array} jpeg @param {Uint16Array} [own] */
async function fitted(meta, w, known, jpeg, own) {
  const engineM = rows(meta.cameraToRec2020), toSrgb = rows(meta.rec2020ToSrgb);
  const planes = own ?? new Uint16Array(wasm.memory.buffer, w.ptr, w.width * w.height * 3);
  const got = await cells(planes, w.width, w.height, inverse(engineM), jpeg).catch(() => null);
  if (!got) return { source: 'fallback', why: 'the camera JPEG does not frame the same picture' };
  const fit = known ? null : fitMatrix(got.c, got.l);
  const m = known?.matrix ?? (fit?.ok ? fit.matrix : mul(toSrgb, engineM));
  const ev = baseline(m, got.c, got.l);
  const set = mul(inverse(toSrgb), m).map((r) => r.map((v) => v * 2 ** ev));
  engine.setMatrix(new Float32Array(set.flat()));
  if (own) remap(own, mul(set, inverse(engineM)));
  const source = known || fit?.ok ? 'fitted' : 'fallback';
  return { source, ev, ...(fit ? { fit: { ok: fit.ok, why: fit.why, matrix: fit.matrix, samples: fit.samples, before: fit.before, after: fit.after } } : {}) };
}

/** The engine's glue and module: `threads/` (shared memory, a rayon pool) or the plain build. @param {boolean} threads */
async function load(threads) {
  const dir = `${ENGINE}${threads ? 'threads/' : ''}`;
  const glue = await import(`${dir}photos_engine.js`);
  wasm = await glue.default({ module_or_path: `${dir}photos_engine_bg.wasm` });
  if (threads) await Promise.race([glue.initThreadPool(THREADS), new Promise((_, no) => setTimeout(() => no(new Error('the engine threads did not start')), POOL_START_MS))]);
  Engine = glue.Engine;
}

self.onmessage = async (/** @type {MessageEvent} */ ev) => {
  const m = ev.data;
  try {
    const tl = performance.now();
    if (!wasm) {
      const threads = self.crossOriginIsolated && THREADS > 1 && m.threads !== false;
      // a phone that will not give the shared memory (or the workers) gets the one-thread build
      await load(threads).catch((e) => (threads ? load(false) : Promise.reject(e)));
    }
    if (m.type === 'open') {
      engine?.free();
      engine = new Engine();
      const t0 = performance.now(), load = t0 - tl;
      const res = m.blob ? null : await fetch(m.url, { headers: { Authorization: m.auth } });
      if (res && !res.ok) throw new Error(`the original did not load (${res.status})`);
      const size = m.blob ? m.blob.size : Number(res?.headers.get('Content-Length')) || m.size;
      const ptr = engine.inputPtr(size, m.reserve ?? 0);
      const reader = (m.blob ? m.blob.stream() : /** @type {ReadableStream} */ (res?.body)).getReader();
      let at = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const n = Math.min(value.length, size - at);
        new Uint8Array(wasm.memory.buffer, ptr + at, n).set(value.subarray(0, n));
        at += n;
      }
      if (at !== size) throw new Error('the original arrived short');
      const t1 = performance.now();
      const meta = engine.decodeInput(true);
      const preview = meta.previewJpeg;
      meta.previewJpeg = null;
      const jpeg = meta.matrixIsFallback && preview ? preview.slice() : null; // the page gets the original
      post({ type: 'meta', meta, preview, ms: { fetch: t1 - t0, decode: performance.now() - t1 } }, preview ? [preview.buffer] : []);
      const t2 = performance.now();
      if (meta.streaming) {
        const half = gather(wasm, Math.floor(meta.width / 2), Math.floor(meta.height / 2));
        const w = engine.binned(half.sink);
        const tb = performance.now();
        const colour = jpeg ? await fitted(meta, w, m.fits?.[meta.camera], jpeg, half.planes) : { source: meta.matrixIsFallback ? 'fallback' : 'engine' };
        const memory = engine.memoryBytes();
        const stages = { load, fetch: t1 - t0, headers: t2 - t1, binned: tb - t2, fit: performance.now() - tb };
        post({ type: 'working', stage: 'half', width: w.width, height: w.height, data: half.planes, colour, ms: performance.now() - t2, memory, threads: engine.threads(), stages }, [half.planes.buffer]);
        const t3 = performance.now();
        const full = gather(wasm, w.width, w.height);
        engine.working(m.scale ?? 2, full.sink);
        post({ type: 'full', width: w.width, height: w.height, data: full.planes, ms: performance.now() - t3, memory: engine.memoryBytes(), halfMemory: memory }, [full.planes.buffer]);
        return;
      }
      const w = engine.working(m.scale ?? 2);
      const colour = jpeg ? await fitted(meta, w, m.fits?.[meta.camera], jpeg) : { source: meta.matrixIsFallback ? 'fallback' : 'engine' };
      const data = planes(w);
      engine.freeWorking();
      post({ type: 'working', stage: 'one', width: w.width, height: w.height, data, colour, ms: performance.now() - t2, memory: engine.memoryBytes(), threads: engine.threads() }, [data.buffer]);
    } else if (m.type === 'tile' && engine) {
      const t = engine.tile(m.x, m.y, m.w, m.h);
      const data = planes(t);
      post({ type: 'tile', id: m.id, x: t.x, y: t.y, width: t.width, height: t.height, data, memory: engine.memoryBytes() }, [data.buffer]);
    }
  } catch (e) {
    post({ type: 'error', id: m.id, message: /** @type {Error} */ (e)?.message ?? String(e) });
  }
};
