// @ts-check
// An export's own thread (export-thread.js starts one for each export): the bands the GPU developed come here and
// are brought to each file's size, sharpened and written (reduce.js, files.js), so the page stays free to draw.
// A JPEG's bands go back to the page to be encoded on the decoder's thread, where the encoder already is
// (app/decoder.js): one copy of it in memory, not two.
// Messages in: { start: [sw, sh, outs] }, then { band, n, k } for each band (given, not copied), then { finish }.
// Messages out: { ready } once loaded, { took: k, ms } as each band is done with, { files } at the end, or { error }.
// { jpeg: [rgb, w, h, quality, fine], id } asks the page to encode, and its answer comes back as { id, jpeg } or { id, error }.
import { sink } from './reduce.js';

const post = /** @type {(msg: any, give?: Transferable[]) => void} */ ((m, give = []) => self.postMessage(m, { transfer: give }));
const asked = /** @type {Map<number, { res: (j: Uint8Array) => void, rej: (e: Error) => void }>} */ (new Map());
let ids = 0, work = /** @type {ReturnType<typeof sink> | null} */ (null), line = Promise.resolve();
/** @type {import('./files.js').Band} */
const band = (rgb, w, h, quality, fine) => new Promise((res, rej) => { const id = ++ids; asked.set(id, { res, rej }); post({ jpeg: [rgb, w, h, quality, fine], id }, [rgb.buffer]); });

/** @param {any} d */
async function one(d) {
  if (d.start) { const [sw, sh, outs] = d.start; work = sink(sw, sh, outs, band); return; }
  if (!work) throw new Error('the export did not start');
  if (d.band) { const t = performance.now(); await work.push(d.band, d.n); post({ took: d.k, ms: performance.now() - t }); return; }
  if (d.finish) post({ files: await work.done() });
}
let failed = false;
self.onmessage = (e) => {
  const d = e.data;
  if (d.id) { const q = asked.get(d.id); asked.delete(d.id); if (d.jpeg) q?.res(d.jpeg); else q?.rej(new Error(d.error)); return; }
  // one message at a time, in order: a band waits for the one before it (a JPEG's encoding is awaited in between)
  line = line.then(() => (failed ? undefined : one(d))).catch((err) => { failed = true; post({ error: String(err?.message || err) }); });
};
post({ ready: true });
