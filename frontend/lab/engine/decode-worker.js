// @ts-nocheck
// The engine test page's decoder thread (docs/engineering/ENGINE-RESEARCH.md): rawler in wasm opens the
// RAF and bins the X-Trans mosaic into the editing proxy, off the page's thread so the UI never stalls.
import init, { decode } from './pkg/th_raw.js';

const ready = init({ module_or_path: new URL('./pkg/th_raw_bg.wasm', import.meta.url) });
self.onmessage = async (e) => {
  try {
    await ready;
    const t0 = performance.now();
    const d = decode(new Uint8Array(e.data));
    const t1 = performance.now();
    const proxy = d.proxy();
    const msg = { meta: JSON.parse(d.meta()), width: d.width(), height: d.height(), proxy, decodeMs: t1 - t0 };
    d.free();
    self.postMessage(msg, [proxy.buffer]);
  } catch (err) { self.postMessage({ error: String(err?.message || err) }); }
};
