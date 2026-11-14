// @ts-check
// Whether this phone's CPU and GPU can work at once, for the engine test page (net-bench.js): the network's heavy
// pass on the GPU, again and again, while some of the CPU's cores make the same kind of layer (cpu-bench.js), and
// how much each gets through then against what it does alone. A phone's two share its memory, its heat and the
// cores the GPU's driver runs on, so the two speeds do not simply add: this says what they do add to, and whether
// that holds for a while. It decides whether making some of a photo's windows on the CPU is worth building.
import { counts, crew } from './cpu-bench.js';
import { once } from './net-tune.js';

/** @typedef {{ cores: number, cpu: number, gpu: number }} Pair the CPU's speed on that many cores and the GPU's, at once (thousand million multiply-adds a second) */
/** @param {GPUDevice} device @param {import('./net-tune.js').Pass} pass the heavy pass as this phone runs it
 * @param {number} gm that pass's work, in thousand million multiply-adds
 * @param {{ ms?: number, held?: number, say?: (s: string) => void }} [o] `ms`: how long each measurement runs; `held`: how many more of them the best is then kept up for
 * @returns {Promise<{ build: string, alone: number, pairs: Pair[], held: Pair[], notes: string[] }>} `alone`: the GPU with the CPU idle */
export async function both(device, pass, gm, o = {}) {
  const ms = o.ms ?? 4000, have = navigator.hardwareConcurrency || 1, notes = /** @type {string[]} */ ([]), pairs = /** @type {Pair[]} */ ([]), held = /** @type {Pair[]} */ ([]);
  const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
  const gpu = async () => { const t = performance.now(); let n = 0; do { await once(device, pass); n++; } while (performance.now() - t < ms); return r2((n * gm) / ((performance.now() - t) / 1000)); };
  o.say?.('The GPU on its heavy pass, alone…');
  const alone = await gpu();
  let c = null, build = '';
  for (const b of /** @type {const} */ (['conv-fused', 'conv'])) {
    try { c = await crew(b); build = b; break; } catch (err) { notes.push(`${b}: ${String(/** @type {any} */ (err)?.message || err).slice(0, 160)}`); }
  }
  if (!c) return { build, alone, pairs, held, notes };
  try {
    const at = async (/** @type {number} */ n) => { const [cpu, g] = await Promise.all([c.run(n, ms), gpu()]); return { cores: n, cpu: cpu.gmacs, gpu: g }; };
    for (const n of counts(have).filter((k) => k > 1 || have === 1)) { o.say?.(`The GPU and ${n} of the CPU's cores at once…`); pairs.push(await at(n)); }
    const best = pairs.reduce((a, b) => (b.cpu + b.gpu > a.cpu + a.gpu ? b : a));
    for (let k = 0; k < (o.held ?? 4); k++) { o.say?.(`The GPU and ${best.cores} cores, kept up (${k + 1} of ${o.held ?? 4})…`); held.push(await at(best.cores)); }
  } catch (err) { notes.push(String(/** @type {any} */ (err)?.message || err).slice(0, 160)); }
  c.end();
  return { build, alone, pairs, held, notes };
}
