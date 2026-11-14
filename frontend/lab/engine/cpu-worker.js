// @ts-check
// One core's part of the CPU measurement (cpu-bench.js): the network's heavy pass (cpu-conv.js) made again and
// again for as long as asked, on a layer of its own, and how many times it got through.
import { layer } from './cpu-conv.js';

/** @type {ReturnType<typeof layer> | null} */
let made = null;
self.onmessage = (e) => {
  try {
    if (e.data.module) { made = layer(e.data.module, e.data.shape, e.data.seed); made.run(); self.postMessage({ ready: true }); return; }   // one run first: the code is compiled and the memory touched
    if (!made) throw new Error('no layer yet');
    const until = performance.now() + e.data.ms, began = performance.now();
    let runs = 0;
    do { if (made.run() !== 0) throw new Error('the layer was refused'); runs++; } while (performance.now() < until);
    self.postMessage({ runs, ms: performance.now() - began });
  } catch (err) { self.postMessage({ error: String(/** @type {any} */ (err)?.message || err) }); }
};
