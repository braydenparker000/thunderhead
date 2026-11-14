// @ts-check
// The network measured on this phone, for the engine test page (net-ui.js shows it): how long a window takes, where
// in its passes the time goes, whether the passes written other ways (net-ways.js) are faster here, and whether the
// picture they make is as true as the exported network's. Then the CPU, for the same work (cpu-bench.js).
//
// A way is judged on the whole picture, not pass by pass. The window is made three times: by the exported network
// in half floats (what the phone runs), by the fastest way of each pass, and by the exported network in full
// floats, which is the truth both are held against. The chosen ways are kept only if their picture is as near the
// truth as the exported half-float network's is (16-bit sums round, and two orders of the same sum round apart:
// that is not an error, and the full-float picture says how much of it there is anyway). If it is not, the way
// furthest from its exported pass is dropped and the rest tried again. What is kept is what neural.js compiles
// from then on, in the editor too.
import { CAMERA, known } from './known.js';
import { demosaicer, phaseOf } from './neural.js';
import { WAYS, choose, once, tune } from './net-tune.js';
import { cpuBench } from './cpu-bench.js';
import { both } from './net-both.js';

/** A way must take under this share of the exported pass's time to be worth choosing (less is within what a timing wanders by). */
export const FASTER = 0.92;
/** A way whose result is this far from its exported pass's (as a share of that result's size) is wrong, not rounded. */
export const SANE = 0.25;
/** How much further from the truth than the exported half-float picture a chosen picture may be: the mean and the
 * 999th of a thousand of the differences, in levels of 255 after the screen's curve. */
export const judge = (/** @type {Apart} */ exported, /** @type {Apart} */ set) => set.mean <= 1.15 * exported.mean + 0.02 && set.p999 <= 1.15 * exported.p999 + 0.25;

/** How far apart two pictures are, in levels of 255 after a screen's curve (so a difference in the shadows counts as
 * the eye would have it): the mean, the 999th of a thousand, the largest. @typedef {{ mean: number, p999: number, max: number }} Apart */
const CURVE = Float32Array.from({ length: 65536 }, (_, v) => 255 * (v / 65535) ** (1 / 2.2));
/** @param {Uint32Array} a @param {Uint32Array} b the network's result as place writes it: two words a pixel @returns {Apart} */
export function apart(a, b) {
  const bins = new Uint32Array(4096);   // sixteenths of a level
  let sum = 0, max = 0, n = 0;
  for (let i = 0; i < a.length; i += 2) {
    for (const [x, y] of [[a[i] & 65535, b[i] & 65535], [a[i] >>> 16, b[i] >>> 16], [a[i + 1] & 65535, b[i + 1] & 65535]]) {
      const d = Math.abs(CURVE[x] - CURVE[y]);
      sum += d; n++; if (d > max) max = d; bins[Math.min(4095, Math.floor(d * 16))]++;
    }
  }
  let seen = 0, k = 0;
  while (k < 4095 && seen + bins[k] < 0.999 * n) seen += bins[k++];
  const r = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;
  return { mean: r(sum / Math.max(1, n)), p999: Math.min(r((k + 1) / 16), r(max)), max: r(max) };
}

/** The fastest way of each pass among those that ran, were sane and clearly faster: a number a pass (0: as exported).
 * @param {number[]} ms @param {import('./net-tune.js').Tried[][]} tried @param {Set<string>} [not] ways left out, as "pass:way" */
export function fastest(ms, tried, not = new Set()) {
  return ms.map((own, j) => {
    let best = 0, least = FASTER * own;
    for (const [k, t] of (tried[j] || []).entries()) if (t.ms >= 0 && (t.rms ?? Infinity) <= SANE && t.ms < least && !not.has(`${j}:${k + 1}`)) { best = k + 1; least = t.ms; }
    return best;
  });
}

/** @typedef {{ vendor: string, architecture: string, device: string, description: string, f16: boolean }} Gpu */
/** @typedef {{ v: 1, at: number, build: string, gpu: Gpu, kind: string, side: number, mp: number, reps: number,
 *   cut: number, ms: number[], names: string[], gmac: number[], tried: import('./net-tune.js').Tried[][],
 *   whole: { exported: number, chosen: number | null, full: number | null, after: number },
 *   way: number[], kept: number[], verdict: string, dropped: string[],
 *   picture: { exported: Apart | null, chosen: Apart | null, between: Apart | null },
 *   cpu: Awaited<ReturnType<typeof cpuBench>> | null, both: Awaited<ReturnType<typeof both>> | null, took: number }} NetRun */

/** Measures the network on this phone and keeps the ways it should run. `side`: how much of a window is made (all of
 * it; a test asks for less); `reps`: how often each timing is taken (the least is kept); `cpu`: false leaves the CPU
 * out, `both`: false the two at once (net-both.js); `keep`: false measures and judges but leaves the phone's kept choice as it was.
 * @param {{ say?: (s: string) => void, side?: number, reps?: number, cpu?: boolean | Parameters<typeof cpuBench>[0], both?: boolean | Parameters<typeof both>[3], keep?: boolean }} [o] @returns {Promise<NetRun>} */
export async function netBench(o = {}) {
  const say = o.say || (() => {}), began = performance.now(), reps = o.reps || 2;
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('this browser has no WebGPU adapter');
  const f16 = adapter.features.has('shader-f16'), device = await adapter.requestDevice({ requiredFeatures: f16 ? ['shader-f16'] : [] }), i = /** @type {any} */ (adapter).info || {};
  const gpu = { vendor: String(i.vendor || ''), architecture: String(i.architecture || ''), device: String(i.device || ''), description: String(i.description || ''), f16 };
  const kind = f16 ? 'f16' : 'f32', made = /** @type {{ destroy: () => void }[]} */ ([]);
  try {
    say('Making the known photo…');
    const N = 1056, k = known(N, 3200), tex = device.createTexture({ size: [N, N], format: 'r16uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    made.push(tex);
    device.queue.writeTexture({ texture: tex }, k.mosaic, { bytesPerRow: N * 2 }, [N, N]);
    const info = { phase: /** @type {number[]} */ (phaseOf(k.meta)), black: CAMERA.black, white: CAMERA.white, wb: CAMERA.wb, noise: k.meta.noise };
    const net = async (/** @type {'f16' | 'f32'} */ kd, /** @type {boolean | number[]} */ kept, /** @type {number} */ side) => { const n = await demosaicer(device, tex, info, side, side, { kind: kd, kept }); made.push(n); return n; };
    say('Compiling the network…');
    const core = Math.max(96, Math.min(o.side || 984, 984));   // a window's own part is 984 pixels a side: one window, whole
    /** The whole window by a network, in one go: how long, and the picture. */
    const whole = async (/** @type {Awaited<ReturnType<typeof net>>} */ n) => {
      const enc = device.createCommandEncoder(), read = device.createBuffer({ size: core * core * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      n.run(enc, 0, 0, core, core, null, 1, 0, 0); enc.copyBufferToBuffer(n.out, 0, read, 0, core * core * 8);
      const t = performance.now();
      device.queue.submit([enc.finish()]); await device.queue.onSubmittedWorkDone();
      const ms = performance.now() - t;
      await read.mapAsync(GPUMapMode.READ);
      const px = new Uint32Array(read.getMappedRange().slice(0));
      read.destroy();
      return { ms, px };
    };
    const least = async (/** @type {Awaited<ReturnType<typeof net>>} */ n) => { let best = await whole(n); for (let r = 1; r < reps; r++) { const w = await whole(n); if (w.ms < best.ms) best = w; } return best; };
    const small = await net(kind, false, core);
    say('The whole window, as exported…');
    await whole(small);   // once unmeasured: the GPU's own compiling of each pass is behind it
    const first = await least(small);
    // each pass, every way
    const cut = await once(device, small.parts.lay(core)[0]), t = await tune(small.parts, { reps, say });
    // the fastest ways, judged on the picture against full floats
    let full = /** @type {Awaited<ReturnType<typeof whole>> | null} */ (null);
    if (kind === 'f16') { say('The whole window in full floats (the truth the pictures are held against)…'); const ref = await net('f32', false, core); await whole(ref); full = await least(ref); ref.destroy(); made.splice(made.indexOf(ref), 1); }
    const truth = full ? full.px : first.px, exported = full ? apart(first.px, truth) : null, dropped = /** @type {string[]} */ ([]), not = /** @type {Set<string>} */ (new Set());
    let way = fastest(t.ms, t.tried), chosen = /** @type {Awaited<ReturnType<typeof whole>> | null} */ (null), verdict = 'no way was clearly faster: the passes stay as exported', picture = /** @type {Apart | null} */ (null);
    for (let turn = 0; turn < 4 && way.some(Boolean); turn++) {
      say(`The whole window by the fastest ways (${way.join('')})…`);
      const set = await net(kind, way, core);
      // (neural.js goes back to the exported passes when a choice will not compile or prove: then they are the same list)
      if (set.parts.g.ops === set.parts.exported) { set.destroy(); made.splice(made.indexOf(set), 1); verdict = 'the chosen ways would not compile or prove together: the passes stay as exported'; way = way.map(() => 0); break; }
      await whole(set); chosen = await least(set); picture = apart(chosen.px, truth);
      const good = exported ? judge(exported, picture) : picture.mean <= 0.05 && picture.p999 <= 0.5;
      set.destroy(); made.splice(made.indexOf(set), 1);
      if (good) { verdict = chosen.ms < FASTER * first.ms ? 'kept: these ways make as true a picture, faster' : 'as true a picture, but the whole window is not clearly faster: the passes stay as exported'; if (chosen.ms >= FASTER * first.ms) way = way.map(() => 0); break; }
      // not as true: the way furthest from its exported pass goes, and the rest are tried again
      let worst = '', far = -1;
      for (const [j, w] of way.entries()) if (w && (t.tried[j][w - 1].rms ?? 0) > far) { far = t.tried[j][w - 1].rms ?? 0; worst = `${j}:${w}`; }
      not.add(worst); dropped.push(`pass ${Number(worst.split(':')[0]) + 1} way ${worst.split(':')[1]} (the picture was ${picture.mean} mean, ${picture.p999} at the 999th, against ${exported?.mean} and ${exported?.p999})`);
      way = fastest(t.ms, t.tried, not); chosen = null;
      verdict = 'no set of ways made as true a picture: the passes stay as exported';
      if (!way.some(Boolean)) picture = null;
    }
    const after = (await whole(small)).ms;
    if (o.keep !== false) choose(kind, way);
    let cpu = null;
    if (o.cpu !== false) cpu = await cpuBench({ say, ...(typeof o.cpu === 'object' ? o.cpu : {}) });
    const r1 = (/** @type {number} */ v) => Math.round(v * 10) / 10, of = (/** @type {string} */ code, /** @type {string} */ name) => Number(new RegExp(`const ${name}: u32 = (\\d+)u`).exec(code)?.[1]) || 0;
    // what each pass is, and its work on a whole window in thousand millions of multiply-adds (its middle passes: a 3 x 3 or a 1 x 1 over the cells that are made)
    const ops = small.parts.exported, names = ops.map((op, j) => (of(op.code, 'CIN') && of(op.code, 'COUT') ? `${/const KK\b/.test(op.code) ? '3x3' : '1x1'} ${of(op.code, 'CIN')}>${of(op.code, 'COUT')}` : j === 0 ? 'first' : 'last'));
    const cells = Math.min(176, Math.ceil((core + 66) / 6)) ** 2;   // the part of the window's 176 x 176 that is made (its own part and the context round it)
    const gmac = ops.map((op) => Math.round((of(op.code, 'CIN') * of(op.code, 'COUT') * (/const KK\b/.test(op.code) ? 9 : 1) * cells) / 1e7) / 100);
    // the CPU and the GPU at once: the heavy pass as this phone will run it from now on (the ways just kept)
    let two = null;
    if (o.both !== false && o.cpu !== false) {
      const heavy = gmac.indexOf(Math.max(...gmac)), fast = way.some(Boolean) ? await net(kind, way, core) : small;
      await whole(fast);
      two = await both(device, fast.parts.lay(core)[heavy + 1], gmac[heavy], { say, ...(typeof o.both === 'object' ? o.both : {}) });
    }
    return { v: 1, at: Date.now(), build: 'dev', gpu, kind, side: core, mp: Math.round((core * core) / 1e4) / 100, reps, cut: r1(cut), ms: t.ms.map(r1), names, gmac,
      tried: t.tried.map((row) => row.map((w) => ({ ...w, ms: w.ms < 0 ? w.ms : r1(w.ms), ...(w.made === undefined ? {} : { made: Math.round(w.made) }), ...(w.rms === undefined ? {} : { rms: Number.isFinite(w.rms) ? Math.round(w.rms * 1e5) / 1e5 : -1, max: Math.round((w.max || 0) * 1e4) / 1e4 }) }))),
      whole: { exported: r1(first.ms), chosen: chosen ? r1(chosen.ms) : null, full: full ? r1(full.ms) : null, after: r1(after) },
      way, kept: o.keep === false ? [] : way, verdict, dropped, picture: { exported, chosen: picture, between: chosen ? apart(chosen.px, first.px) : null }, cpu, both: two, took: Math.round(performance.now() - began) };
  } finally { for (const m of made) m.destroy(); device.destroy(); }
}
export { WAYS };
