// @ts-check
// The RAW engine in a Web Worker (engine/photos, PHOTOS.md the editor): the original streams from
// Drive (or a picked file) straight into wasm memory, the headers decode at once (the embedded JPEG
// goes back first), then the half-size working copy is built band by band and handed over as one
// transferred buffer of f16 planes; the CPU copy is freed right after, so a 1:1 tile can use its space.
// A body with no matrix in the engine gets one fitted from its camera JPEG (fit.js; kept per model by the
// page and sent back with `fits`), and every such photo its baseline exposure from its own JPEG.
import { baseline, cells, fitMatrix, inverse, mul } from './fit.js';
// The generated glue (scripts/photos-engine.mjs), loaded by address so the type check leaves it be.
const GLUE = '/photos/engine/photos_engine.js';

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
/** The matrix (stored, else fitted now) and this photo's baseline, set in the engine; what was done, for the page.
 * @param {any} meta @param {{ ptr: number, width: number, height: number }} w @param {{ matrix: number[][] } | undefined} known @param {Uint8Array} jpeg */
async function fitted(meta, w, known, jpeg) {
  const engineM = rows(meta.cameraToRec2020), toSrgb = rows(meta.rec2020ToSrgb);
  const planes = new Uint16Array(wasm.memory.buffer, w.ptr, w.width * w.height * 3);
  const got = await cells(planes, w.width, w.height, inverse(engineM), jpeg).catch(() => null);
  if (!got) return { source: 'fallback', why: 'the camera JPEG does not frame the same picture' };
  const fit = known ? null : fitMatrix(got.c, got.l);
  const m = known?.matrix ?? (fit?.ok ? fit.matrix : mul(toSrgb, engineM));
  const ev = baseline(m, got.c, got.l);
  engine.setMatrix(new Float32Array(mul(inverse(toSrgb), m).flat().map((v) => v * 2 ** ev)));
  const source = known || fit?.ok ? 'fitted' : 'fallback';
  return { source, ev, ...(fit ? { fit: { ok: fit.ok, why: fit.why, matrix: fit.matrix, samples: fit.samples, before: fit.before, after: fit.after } } : {}) };
}

self.onmessage = async (/** @type {MessageEvent} */ ev) => {
  const m = ev.data;
  try {
    if (!wasm) {
      const glue = await import(GLUE);
      Engine = glue.Engine;
      wasm = await glue.default({ module_or_path: '/photos/engine/photos_engine_bg.wasm' });
    }
    if (m.type === 'open') {
      engine?.free();
      engine = new Engine();
      const t0 = performance.now();
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
      const w = engine.working(m.scale ?? 2);
      const colour = jpeg ? await fitted(meta, w, m.fits?.[meta.camera], jpeg) : { source: meta.matrixIsFallback ? 'fallback' : 'engine' };
      const data = planes(w);
      engine.freeWorking();
      post({ type: 'working', width: w.width, height: w.height, data, colour, ms: performance.now() - t2, memory: engine.memoryBytes() }, [data.buffer]);
    } else if (m.type === 'tile' && engine) {
      const t = engine.tile(m.x, m.y, m.w, m.h);
      const data = planes(t);
      post({ type: 'tile', id: m.id, x: t.x, y: t.y, width: t.width, height: t.height, data, memory: engine.memoryBytes() }, [data.buffer]);
    }
  } catch (e) {
    post({ type: 'error', id: m.id, message: /** @type {Error} */ (e)?.message ?? String(e) });
  }
};
