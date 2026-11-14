// @ts-check
// How fast this phone's CPU makes the network's heaviest pass (engine/netcpu), on one core and on several at once:
// thousands of millions of multiply-adds a second, to set beside the GPU's for the same pass (net-bench.js). Each
// core has a worker with its own copy of the layer (cpu-worker.js); they all run for the same stretch of time and
// what they got through is added up. Two builds are tried: one that multiplies and adds, and one with a fused
// multiply-add, which a browser may not have.
import { macs } from './cpu-conv.js';

/** The layer timed: the heavy pass's channels on a smaller picture (each run is 3.4 thousand million multiply-adds,
 * and a core's copy 13 MB, so eight of them fit a small phone). */
export const SHAPE = { cin: 288, cout: 144, h: 96, w: 96 };

/** Workers that each make the layer again and again, as many as are asked for (a core each): `run` sets `n` of them
 * at it for `ms` and gives how many times they got through and their speed together. Throws where the browser will
 * not compile the build. @param {'conv' | 'conv-fused'} build @param {typeof SHAPE} [shape] */
export async function crew(build, shape = SHAPE) {
  const module = await WebAssembly.compileStreaming(fetch(new URL(`./cpu/${build}.wasm`, import.meta.url))), pool = /** @type {Worker[]} */ ([]);
  const ask = (/** @type {Worker} */ w, /** @type {any} */ msg) => new Promise((res, rej) => { w.onmessage = (e) => (e.data.error ? rej(new Error(e.data.error)) : res(e.data)); w.onerror = (e) => rej(new Error(e.message || 'the worker failed')); w.postMessage(msg); });
  return {
    /** @param {number} n @param {number} ms @returns {Promise<{ runs: number, gmacs: number }>} */
    async run(n, ms) {
      while (pool.length < n) { const w = new Worker(new URL('./cpu-worker.js', import.meta.url), { type: 'module' }); pool.push(w); await ask(w, { module, shape, seed: 7 + pool.length }); }
      const began = performance.now(), got = /** @type {{ runs: number, ms: number }[]} */ (await Promise.all(pool.slice(0, n).map((w) => ask(w, { ms })))), wall = performance.now() - began;
      const runs = got.reduce((s, g) => s + g.runs, 0);
      return { runs, gmacs: Math.round(((runs * macs(shape)) / 1e9 / (wall / 1000)) * 100) / 100 };
    },
    end() { for (const w of pool) w.terminate(); },
  };
}

/** How many cores the measurements try on a phone with `have`: one, half, all but two (a GPU's driver wants a core or two), all. @param {number} have */
export const counts = (have) => [...new Set([1, have >> 1, have - 2, have].filter((n) => n >= 1))].sort((a, b) => a - b);

/** @typedef {{ build: string, cores: number, gmacs: number, runs: number }} Row how many thousand million multiply-adds a second, on how many cores */
/** Times the CPU pass. `ms`: how long each measurement runs; `counts`: how many cores to try (those the phone has).
 * A build the browser will not compile is left out and said in `notes`.
 * @param {{ ms?: number, counts?: number[], shape?: typeof SHAPE, say?: (s: string) => void }} [o]
 * @returns {Promise<{ rows: Row[], notes: string[], cores: number }>} */
export async function cpuBench(o = {}) {
  const shape = o.shape || SHAPE, ms = o.ms ?? 2000, have = navigator.hardwareConcurrency || 1, notes = /** @type {string[]} */ ([]), rows = /** @type {Row[]} */ ([]);
  const tries = [...new Set((o.counts || counts(have)).map((n) => Math.min(n, have)))].sort((a, b) => a - b);
  for (const build of /** @type {const} */ (['conv', 'conv-fused'])) {
    let c = null;
    try {
      c = await crew(build, shape);
      for (const n of tries) {
        o.say?.(`The CPU: ${build === 'conv' ? 'multiply and add' : 'fused multiply-add'}, ${n} core${n === 1 ? '' : 's'}…`);
        rows.push({ build, cores: n, ...(await c.run(n, ms)) });
      }
    } catch (err) { notes.push(`${build}: ${String(/** @type {any} */ (err)?.message || err).slice(0, 160)}`); }
    c?.end();
  }
  return { rows, notes, cores: have };
}
