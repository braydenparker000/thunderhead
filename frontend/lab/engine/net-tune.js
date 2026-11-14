// @ts-check
// The measuring that says which way this phone should run each of the network's passes (net-ways.js writes the
// ways; neural.js runs what is chosen here). `tune` runs each pass every way on a real window, says how far each
// result is from the exported pass's, and times them. Which ways a phone then uses is decided on the whole picture,
// by the engine test page (net-bench.js), and kept on the phone (`chosen`); neural.js still proves the network with
// that choice before using it. `timed` is the small part an export does: the passes as compiled, timed apart.
import { WAYS, ways } from './net-ways.js';

export { WAYS, ways };
const KEY = 'th.net.tune', V = 2;   // the kept choice; V: raised when `ways` changes, so an old choice is not used for new code

/** Which way this phone runs each pass, as last chosen here for this kind of network: a number a pass, 0 as
 * exported, else one of `ways` (all 0 where none was chosen, or nothing can be kept). @param {string} kind
 * @param {number} count the network's passes @returns {number[]} */
export function chosen(kind, count) {
  const none = new Array(count).fill(0);
  try { const k = JSON.parse(localStorage.getItem(KEY) || 'null'); return k && k.v === V && k.kind === kind && Array.isArray(k.way) && k.way.length === count && k.way.every((/** @type {any} */ w) => Number.isInteger(w) && w >= 0 && w <= WAYS) ? k.way : none; } catch { return none; }
}
/** Keeps the choice (all as exported: forgets it). @param {string} kind @param {number[]} way */
export function choose(kind, way) { try { if (way.some(Boolean)) localStorage.setItem(KEY, JSON.stringify({ v: V, kind, way })); else localStorage.removeItem(KEY); } catch { /* nowhere to keep it: the passes run as exported */ } }

/** @typedef {[GPUComputePipeline, GPUBindGroup, number, number, number]} Pass a pass with its bindings and how many workgroups it is dispatched over */
/** Runs one pass and waits for the GPU to finish it. @param {GPUDevice} device @param {Pass} pass @returns {Promise<number>} ms */
export async function once(device, [pipe, bind, a, b, c]) {
  const enc = device.createCommandEncoder(), pass = enc.beginComputePass(), t = performance.now();
  pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(a, b, c); pass.end();
  device.queue.submit([enc.finish()]); await device.queue.onSubmittedWorkDone();
  return performance.now() - t;
}
/** One window made a pass at a time as the network is compiled here, each waited for: how long each takes on this
 * GPU, in ms (cut, the network's passes in order, place). An export notes them, so the phone says where the time
 * goes in what it really runs. @param {{ parts: import('./neural.js').Parts }} net @param {number} [side] how much of the window is made (all of it; a test asks for less) */
export async function timed(net, side) {
  const p = net.parts, ms = [];
  for (const pass of p.lay(side)) ms.push(await once(p.device, pass));
  return ms;
}

const SPOTS = 24, SPOT = 4096;   // where two results are compared: this many places, this many bytes at each
/** What became of one way of one pass: `ms` the least of its runs (-1: the pass has no such way; -2: it did not
 * compile, `why` says; else it ran), `rms` how far its result is from the exported pass's on the same input, as a
 * share of that result's own size (0: the same), `max` the largest difference, `made` how long it took to compile,
 * `odd` how many of the values compared were not finite in both alike, and in one only (which is wrong).
 * @typedef {{ ms: number, rms?: number, max?: number, made?: number, why?: string, odd?: number[] }} Tried */
/** Runs the network's passes over the window already cut into its buffers, each as exported and each other way there
 * is, on the same input, `reps` times each (the least is kept: the others waited on something). The exported pass
 * runs last, so what follows is made from its result.
 * @param {import('./neural.js').Parts} parts the network as exported (compiled with no choice kept)
 * @param {{ reps?: number, say?: (s: string) => void }} [o]
 * @returns {Promise<{ ms: number[], tried: Tried[][] }>} `ms`: each pass as exported; `tried`: for each pass, each other way */
export async function tune(parts, o = {}) {
  const { device, g, bufs, valid, unhalf } = parts, reps = Math.max(1, o.reps || 1), wide = g.kind === 'f16' ? 2 : 4, ms = /** @type {number[]} */ ([]), tried = /** @type {Tried[][]} */ ([]);
  const back = device.createBuffer({ size: 2 * SPOTS * SPOT, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const run = async (/** @type {GPUComputePipeline} */ pipe, /** @type {typeof g.ops[number]} */ op, /** @type {number[]} */ groups, /** @type {number} */ half, /** @type {number} */ bytes) => {
    const enc = device.createCommandEncoder(), pass = enc.beginComputePass(), t = performance.now();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [...op.code.matchAll(/@binding\((\d)\)/g)].map((m) => +m[1]).map((b) => ({ binding: b, resource: { buffer: b === 5 ? valid : bufs[op.binds[b]] } })) }));
    pass.dispatchWorkgroups(groups[0], groups[1], groups[2]); pass.end();
    // a little of the result from places spread over it, to compare the ways by
    if (half >= 0) for (let k = 0; k < SPOTS; k++) enc.copyBufferToBuffer(bufs[op.binds[4]], Math.floor(((bytes - SPOT) * k) / (SPOTS - 1) / 4) * 4, back, (half * SPOTS + k) * SPOT, SPOT);
    device.queue.submit([enc.finish()]); await device.queue.onSubmittedWorkDone();
    return performance.now() - t;
  };
  const least = async (/** @type {() => Promise<number>} */ f) => { let best = Infinity; for (let r = 0; r < reps; r++) best = Math.min(best, await f()); return best; };
  try {
    for (const [j, op] of parts.exported.entries()) {
      const others = ways(op), out = Number(/const COUT: u32 = (\d+)u/.exec(op.code)?.[1]) * 176 * 176 * wide, bytes = Math.min(g.sizes[op.binds[4]], out || Infinity), can = others.some(Boolean) && bytes > SPOT;
      o.say?.(`The network's pass ${j + 1} of ${parts.exported.length}…`);
      const row = /** @type {Tried[]} */ ([]), kept = /** @type {GPUComputePipeline[]} */ ([]);
      for (let k = 0; k < WAYS; k++) {
        const w = can ? others[k] : null;
        if (!w) { row.push({ ms: -1 }); continue; }
        // compiled here, with whatever the GPU's compiler says of it kept
        const t0 = performance.now(), module = device.createShaderModule({ code: w.code }), info = await module.getCompilationInfo(), bad = info.messages.filter((m) => m.type === 'error').map((m) => `line ${m.lineNum}: ${m.message}`);
        device.pushErrorScope('validation');
        const pipe = bad.length ? null : await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } }).catch((err) => { bad.push(String(err?.message || err)); return null; });
        const fault = await device.popErrorScope();
        if (fault) bad.push(fault.message);
        if (!pipe || bad.length) { row.push({ ms: -2, why: bad.join(' | ').slice(0, 400) || 'no pipeline' }); continue; }
        const made = performance.now() - t0, took = await least(() => run(pipe, op, w.groups, 1, bytes));
        row.push({ ms: took, made }); kept[k] = pipe;
      }
      // the exported pass last (its result is what the next pass is given), and each way's result against it
      ms.push(await least(() => run(parts.pipes[j], op, op.groups, can ? 0 : -1, bytes)));
      for (const [k, t] of row.entries()) {
        if (t.ms < 0) continue;
        // (each way's samples were overwritten by the next way's: it is run once more, to be read against the exported pass's)
        await run(kept[k], op, /** @type {import('./net-ways.js').Way} */ (others[k]).groups, 1, bytes);
        await back.mapAsync(GPUMapMode.READ);
        const raw = back.getMappedRange(), n = (SPOTS * SPOT) / wide, a = wide === 2 ? new Uint16Array(raw, 0, n) : new Float32Array(raw, 0, n), b = wide === 2 ? new Uint16Array(raw, SPOTS * SPOT, n) : new Float32Array(raw, SPOTS * SPOT, n);
        // (a value past what a half float holds is infinite in both, and that is the same; only where one is and the other is not is it wrong)
        let sum = 0, off = 0, max = 0, wrong = 0, odd = 0;
        for (let i = 0; i < n; i++) {
          const p = wide === 2 ? unhalf(a[i]) : a[i], q = wide === 2 ? unhalf(b[i]) : b[i];
          if (!Number.isFinite(p) || !Number.isFinite(q)) { if (Object.is(p, q)) odd++; else wrong++; continue; }
          sum += p * p; off += (q - p) * (q - p); max = Math.max(max, Math.abs(q - p));
        }
        back.unmap();
        t.rms = wrong || !(sum > 0) ? Infinity : Math.sqrt(off / sum); t.max = max; if (odd || wrong) t.odd = [odd, wrong];
        await run(parts.pipes[j], op, op.groups, 0, bytes);   // and the exported pass's result put back
      }
      tried.push(row);
    }
  } finally { back.destroy(); }
  return { ms, tried };
}
