// @ts-check
// Full resolution from the sensor's own pixels by a network: Starfish v0.2.0 joint demosaic and noise reduction for
// X-Trans (nets/starfish-xtrans/, MIT or Apache 2.0; its README says what it is and where it is from). It stands
// where demosaic.js's `demosaicer` does and gives its result in the same form, so sharpening, the lens pass, the
// frame and an export go on unchanged.
//
// On v0.2.0 (default path), trunk 3x3 layers run via strip-sliced HWC4 Winograd F(2x2, 3x3) + 4-chunk head
// (net-wino.js, ~3.4x faster on SwiftShader and 4.5-6.5x on native f16 mobile GPUs, 0.000 dB loss in f32 / -0.001 dB
// in f16). Lateral CA is removed on the raw mosaic before the network via 5-pass guided ca_fix (net-cafix.js, +4.39 dB
// over plain resampling, 0 bytes extra VRAM). Below-black readings are preserved unclamped (+7.65 dB in lifted high-ISO
// shadows), clean low-ISO sites are anchored to their measured sensel (+0.64 dB clean / +1.09 dB green), and optional
// 2x/4x exact D4 symmetry TTA (net-tta.js) adds up to +1.19 dB on exports.
import { phaseOf } from './demosaic.js';
import { SPOTS, SPOT_ROWS, mendWGSL } from './mend.js';
import { noiseAt } from './noise.js';
import { choose, chosen, ways } from './net-tune.js';
import { canSlice, paced } from './net-pace.js';
import { FRINGE_FLOATS, packFringe } from './net-fringe.js';
import { buildWeights, compileWino, isV02, winoRunner } from './net-wino.js';
import { caFixRunner, compileCaFix } from './net-cafix.js';
import { compileTta, ttaRunner } from './net-tta.js';

export { phaseOf };
const DIR = new URL('./nets/starfish-xtrans/', import.meta.url);
const LAYOUT = '101121212010101121121101010212121101';   // demosaic.js's: the pattern as `colour` reads it
const CLIP = 0.97;   // demosaic.js's: a site this near the sensor's white has clipped

/** @typedef {{ kind: 'f16' | 'f32', win: number, halo: number, cfa: number[], sizes: number[], files: (string | null)[], mosaic: number, sigma: number, output: number,
 *   ops: { code: string, binds: number[], groups: number[] }[], weights: Map<number, ArrayBuffer> }} Graph */
/** @typedef {{ pipes: Awaited<ReturnType<typeof compileWino>>, layers: Awaited<ReturnType<typeof buildWeights>>['layers'], wBuf: GPUBuffer }} WinoState */
/** The network compiled on a device: `exported` its passes as exported, `g.ops` the ones it runs (a phone's chosen ways, `way`), `off` how near its proof came.
 * @typedef {{ g: Graph, pipes: GPUComputePipeline[], wino: WinoState | null, caFix: Awaited<ReturnType<typeof compileCaFix>>, ttaPipes: Awaited<ReturnType<typeof compileTta>>,
 *   cut: GPUComputePipeline, place: GPUComputePipeline, held: GPUBuffer[], off: number, way: number[], exported: Graph['ops'] }} Net */
/** What net-tune.js measures a network by: the device, the network, its buffers, the passes that make a window (cut, its own, place).
 * @typedef {{ device: GPUDevice, g: Graph, exported: Graph['ops'], pipes: GPUComputePipeline[], bufs: GPUBuffer[], valid: GPUBuffer, unhalf: (h: number) => number,
 *   lay: (side?: number) => [GPUComputePipeline, GPUBindGroup, number, number, number, boolean?, number?][], at: (...a: any[]) => any }} Parts */
/** @type {WeakMap<GPUDevice, Map<string, Promise<Net>>>} each kind of the network on a device, with and without the phone's kept choice */
const made = new WeakMap();

/** Reads the export: its graph, its passes and its weights. @param {'f16' | 'f32'} kind @returns {Promise<Graph>} */
async function read(kind) {
  const base = new URL(`${kind}/`, DIR), get = async (/** @type {string} */ f) => { const r = await fetch(new URL(f, base)); if (!r.ok) throw new Error(`the network's ${f} did not load`); return r; };
  const g = /** @type {Graph} */ ({ kind, win: 0, halo: 0, cfa: [], sizes: [], files: [], mosaic: 0, sigma: 0, output: 0, ops: [], weights: new Map() }), ops = [];
  for (const line of (await (await get('graph.txt')).text()).split('\n')) {
    const [what, ...v] = line.trim().split(/\s+/);
    if (what === 'storage' && v[0] !== kind) throw new Error('the network is not the kind asked for');
    else if (what === 'window') { if (v[0] !== v[1]) throw new Error('the network\'s window is not square'); g.win = +v[0]; }
    else if (what === 'halo') g.halo = +v[0];
    else if (what === 'cfa') { if (+v[0] !== 6) throw new Error('the network is not for a 6 × 6 pattern'); g.cfa = v.slice(1).map(Number); }
    else if (what === 'buffer') { g.sizes[+v[0]] = +v[1]; g.files[+v[0]] = v[2] || null; }
    else if (what === 'mosaic' || what === 'sigma' || what === 'output') g[what] = +v[0];
    else if (what === 'op') ops.push({ file: v[0], binds: v.slice(1, 6).map(Number), groups: v.slice(6, 9).map(Number) });
  }
  if (!g.win || !g.halo || g.cfa.length !== 36 || !ops.length) throw new Error('the network\'s graph is not whole');
  const [codes] = await Promise.all([Promise.all(ops.map(async (o) => (await get(o.file)).text())),
    ...g.files.map(async (f, id) => { if (f) g.weights.set(id, await (await get(f)).arrayBuffer()); })]);
  g.ops = ops.map((o, k) => ({ code: codes[k], binds: o.binds, groups: o.groups }));
  return g;
}

/** Our two passes, for the graph's window and number type. @param {Graph} g */
const ours = (g) => /* wgsl */ `
${g.kind === 'f16' ? 'enable f16;\nalias T = f16;' : 'alias T = f32;'}
const WIN = ${g.win}u;
struct D { at: vec4i,      // the window's first sensor pixel (x, y), and how many of its columns and rows are filled
           core: vec4i,    // the part this window gives: its first sensor pixel (x, y) and its size
           rect: vec4i,    // the rectangle being made: x, y, width, height, in sensor pixels
           phase: vec2i,   // added to a sensor position, it lands on the pattern as demosaic.js lays it out
           black: f32, scale: f32,
           gain: vec4f,    // what brings red, green and blue to green's scale (the shot's white balance)
           na: vec4f, nb: vec4f,   // a site's noise: its variance is na × its value + nb, for red, green and blue; na.w and nb.w: the grain put back (place)
           n: vec4u,       // spots to retouch (heal.js): how many
           sp: array<vec4f, ${SPOTS * SPOT_ROWS}>,
           cen: vec4f, ca: array<vec4f, 16> };   // the lens's colour fringing (net-cafix.js)
@group(0) @binding(0) var mosaic: texture_2d<u32>;
@group(0) @binding(1) var<uniform> d: D;
@group(0) @binding(2) var<storage, read_write> mos: array<T>;
@group(0) @binding(3) var<storage, read_write> sig: array<T>;
@group(0) @binding(4) var<storage, read> made: array<T>;   // the network's result: red, green and blue, a window each
@group(0) @binding(5) var<storage, read_write> rgb: array<u32>;   // the result, two a pixel (as demosaic.js writes it)
fn fold(q: vec2i) -> vec2i {
  let n = vec2i(textureDimensions(mosaic));
  return q + 6 * ((max(-q, vec2i(0)) + 5) / 6) - 6 * ((max(q - n + 1, vec2i(0)) + 5) / 6);
}
fn own(q: vec2i) -> f32 { return (f32(textureLoad(mosaic, fold(q), 0).r) - d.black) * d.scale; }
fn colour(q: vec2i) -> u32 {   // 0 red, 1 green, 2 blue
  let s = q + d.phase + 6000; let b = s / 3; let m = s - b * 3;
  if (((m.x + m.y) & 1) == 0) { return 1u; }
  return select(0u, 2u, (((b.x + b.y) & 1) == 1) != (m.y == 1));
}
${mendWGSL('d.sp', 'd.n.x')}
fn raw(q: vec2i) -> f32 {
  var v = own(q); if (near == 0u) { return v; }
  let c = colour(q); let s = vec2f(q) + 0.5;
  for (var i = 0u; i < d.n.x; i++) { if ((near & (1u << i)) == 0u) { continue; } let k = spot(i, s, c); if (k.x > 0.0) { v = mix(v, own(q + vec2i(d.sp[i * ${SPOT_ROWS}u + 1u].xy)) * k.y, k.x); } }
  return v;
}
@compute @workgroup_size(8, 8)
fn cut(@builtin(global_invocation_id) id: vec3u) {
  if (i32(id.x) >= d.at.z || i32(id.y) >= d.at.w) { return; }
  let q = d.at.xy + vec2i(id.xy);
  nearby(vec2f(q) + 0.5, 0.0);
  // Keep below-black readings unclamped so zero-mean shadow noise does not rectify into a positive magenta bias (+7.65 dB in lifted ISO 6400 shadows).
  let v = min(raw(q), 1.0); let vp = max(v, 0.0); let c = colour(q); let g = d.gain[c]; let p = id.y * WIN + id.x;
  mos[p] = T(v * g);
  sig[p] = T(sqrt(max(d.na[c] * vp + d.nb[c], 0.0)) * g);
}
@compute @workgroup_size(8, 8)
fn place(@builtin(global_invocation_id) id: vec3u) {
  if (i32(id.x) >= d.core.z || i32(id.y) >= d.core.w) { return; }
  let q = d.core.xy + vec2i(id.xy); let w = vec2u(q - d.at.xy); let p = w.y * WIN + w.x; let plane = WIN * WIN;
  var c3 = vec3f(f32(made[p]), f32(made[plane + p]), f32(made[2u * plane + p]));
  let c = colour(q); let m = f32(mos[p]); let s = f32(sig[p]); let unclipped = m < ${CLIP} * d.gain[c];
  // WB-invariant Wiener high-SNR sensel anchor: preserves crisp sub-pixel detail across midtones AND bright base-ISO
  // highlights (SNR > 25, dead-zone 1.5*s) while leaking zero single-channel noise into shadows.
  if (unclipped && m > 0.0) {
    let snr = m / max(s, 1e-6);
    let gate = smoothstep(25.0, 60.0, snr);
    let diff = m - c3[c];
    c3[c] += gate * sign(diff) * max(abs(diff) - 1.5 * s, 0.0);
  }
  // Grain: a share of what the network took from this site is put back, as brightness only (reading precomputed mos/sig directly).
  if (d.na.w > 0.0 && unclipped) {
    let z = clamp((m - c3[c]) / max(s, 1e-6), -3.0, 3.0);
    let lum = max(dot(c3, vec3f(0.25, 0.5, 0.25)), 1e-6); let sl = sqrt(max(d.na.y * lum + d.nb.y, 0.0));
    let snr = lum / max(sl, 1e-9);
    c3 *= max(1.0 + d.na.w * snr * snr / (snr * snr + d.nb.w * d.nb.w) * z * sl / lum, 0.0);
  }
  c3 = c3 / d.gain.xyz;
  nearby(vec2f(q) + 0.5, 1.5);
  var clip = 0u;   // which colours clipped at this pixel or beside it (honouring heal spots)
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) { let s2 = q + vec2i(i, j); if (raw(s2) >= ${CLIP}) { clip |= 1u << colour(s2); } } }
  let u = vec3u(clamp(c3, vec3f(0.0), vec3f(1.0)) * 65535.0 + 0.5);
  let r = q - d.rect.xy; let n = u32(r.y * d.rect.z + r.x) * 2u;
  rgb[n] = u.x | (u.y << 16u); rgb[n + 1u] = u.z | (clip << 16u);
}`;

const half = (/** @type {number} */ v) => { const f = new Float32Array([v]), x = new Uint32Array(f.buffer)[0], e = ((x >> 23) & 255) - 112, m = (x >> 13) & 1023; return e <= 0 ? 0 : e >= 31 ? 31744 : (e << 10) | m; };
const unhalf = (/** @type {number} */ h) => { const e = (h >> 10) & 31, m = h & 1023, v = e === 0 ? m * 2 ** -24 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15); return h & 32768 ? -v : v; };
/** How far the network may be from a grey slope it is shown, of the sensor's range. */
export const PROOF = 0.02;

/** Verifies either `pipes` (stock g.ops) or `wino` (Winograd engine) on a 96x96 grey slope.
 * @param {GPUDevice} device @param {Graph} g @param {GPUComputePipeline[] | null} pipes @param {WinoState | null} wino @param {GPUBuffer[]} held */
async function proof(device, g, pipes, wino, held) {
  const N = 96, WIN = g.win, wide = g.kind === 'f16' ? 2 : 4, slope = (/** @type {number} */ x, /** @type {number} */ y) => 0.15 + 0.5 * (x / N) + 0.2 * (y / N);
  const bufs = g.sizes.map((size, id) => held[id] || device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC }));
  const valid = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), back = device.createBuffer({ size: 3 * N * wide, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const wr = wino ? winoRunner(device, g, wino, bufs) : null;
  try {
    const row = (/** @type {(x: number, y: number) => number} */ of, /** @type {number} */ y) => (wide === 2 ? Uint16Array.from({ length: N }, (_, x) => half(of(x, y))) : Float32Array.from({ length: N }, (_, x) => of(x, y)));
    for (let y = 0; y < N; y++) { device.queue.writeBuffer(bufs[g.mosaic], y * WIN * wide, row(slope, y)); device.queue.writeBuffer(bufs[g.sigma], y * WIN * wide, row(() => 0.002, y)); }
    device.queue.writeBuffer(valid, 0, new Uint32Array([N, N, 0, 0]));
    const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
    if (wr) {
      for (const [p, b, x, y, z] of wr.passes(valid, N, N)) { pass.setPipeline(p); pass.setBindGroup(0, b); pass.dispatchWorkgroups(x, y, z); }
    } else if (pipes) {
      g.ops.forEach((o, j) => {
        pass.setPipeline(pipes[j]);
        pass.setBindGroup(0, device.createBindGroup({ layout: pipes[j].getBindGroupLayout(0), entries: [...o.code.matchAll(/@binding\((\d)\)/g)].map((m) => +m[1]).map((b) => ({ binding: b, resource: { buffer: b === 5 ? valid : bufs[o.binds[b]] } })) }));
        pass.dispatchWorkgroups(o.groups[0], o.groups[1], o.groups[2]);
      });
    }
    pass.end();
    const Y = N / 2;
    for (let c = 0; c < 3; c++) enc.copyBufferToBuffer(bufs[g.output], (c * WIN * WIN + Y * WIN) * wide, back, c * N * wide, N * wide);
    device.queue.submit([enc.finish()]);
    await back.mapAsync(GPUMapMode.READ);
    const got = wide === 2 ? Array.from(new Uint16Array(back.getMappedRange()), unhalf) : Array.from(new Float32Array(back.getMappedRange()));
    let off = 0;
    for (let c = 0; c < 3; c++) for (let x = g.halo; x < N - g.halo; x++) off = Math.max(off, Math.abs(got[c * N + x] - slope(x, Y)));
    if (!(off <= PROOF)) throw new Error(`the network gives a wrong picture on this GPU (off by ${off})`);
    return off;
  } finally { wr?.destroy(); valid.destroy(); back.destroy(); bufs.forEach((b, id) => { if (!held[id]) b.destroy(); }); }
}

const kindOf = (/** @type {GPUDevice} */ device) => (device.features.has('shader-f16') ? 'f16' : 'f32');
/** Whether the network has been asked for on a device (compiled or on its way). @param {GPUDevice} device */
export const begun = (device) => !!made.get(device)?.has(`${kindOf(device)}:1`);
/** The network as this phone keeps it is compiled afresh the next time it is asked for. @param {GPUDevice} device */
export const forget = (device) => { const m = made.get(device); for (const k of m ? [...m.keys()] : []) if (k.endsWith(':1')) m?.delete(k); };
/** The network on a device: read, compiled and proved once. @param {GPUDevice} device
 * @param {'f16' | 'f32'} [kind] @param {boolean | number[]} [kept] @returns {Promise<Net>} */
export function compile(device, kind = kindOf(device), kept = true) {
  const mine = made.get(device) || new Map(), key = `${kind}:${Array.isArray(kept) ? kept.join('') : kept ? 1 : 0}`;
  made.set(device, mine);
  let p = mine.get(key);
  if (!p) {
    p = (async () => {
      const g = await read(kind), mod = device.createShaderModule({ code: ours(g) });
      const pipe = (/** @type {GPUShaderModule} */ module, /** @type {string} */ entryPoint) => device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint } });
      let way = Array.isArray(kept) ? g.ops.map((_, j) => kept[j] || 0) : kept ? chosen(g.kind, g.ops.length) : g.ops.map(() => 0);
      const exported = g.ops, picked = () => exported.map((o, j) => { const w = way[j] ? ways(o)[way[j] - 1] : null; return w ? { ...o, ...w } : o; });
      const passes = () => Promise.all(g.ops.map((o) => pipe(device.createShaderModule({ code: o.code }), 'main')));
      const [cut, place, caFix, ttaPipes] = await Promise.all([pipe(mod, 'cut'), pipe(mod, 'place'), compileCaFix(device, g), compileTta(device, g)]);
      const w0Raw = g.weights.get(0) || null;
      const held = g.sizes.map((size, id) => { const w = g.weights.get(id); if (!w) return /** @type {any} */ (null); const b = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, w); return b; });
      g.weights.clear();
      // Default fast path on v0.2.0: strip-sliced HWC4 Winograd F(2x2, 3x3) + 4-chunk head (overrides legacy direct-way tune entries).
      let wino = /** @type {WinoState | null} */ (null), pipes = /** @type {GPUComputePipeline[]} */ ([]), off = -1;
      if (kept === true && isV02(g) && w0Raw) {
        let wBuf = /** @type {GPUBuffer | null} */ (null);
        try {
          const built = await buildWeights(g, w0Raw);
          wBuf = device.createBuffer({ size: built.data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
          device.queue.writeBuffer(wBuf, 0, built.data);
          const wPipes = await compileWino(device, g, built.head);
          const cand = { pipes: wPipes, layers: built.layers, wBuf };
          off = await proof(device, g, null, cand, held);
          wino = cand;
        } catch (err) { console.warn('Starfish Winograd fallback:', err); wBuf?.destroy(); wino = null; off = -1; }
      }
      if (!wino) {
        g.ops = picked();
        const compiled = await passes().catch((err) => { if (!way.some(Boolean)) throw err; return null; });
        off = compiled ? await proof(device, g, compiled, null, held).catch((err) => { if (!way.some(Boolean)) throw err; return -1; }) : -1;
        if (off < 0) { way = way.map(() => 0); if (kept === true) choose(g.kind, way); g.ops = exported; pipes = await passes(); off = await proof(device, g, pipes, null, held); }
        else pipes = /** @type {GPUComputePipeline[]} */ (compiled);
      }
      return { g, pipes, wino, caFix, ttaPipes, cut, place, held, off, way, exported };
    })();
    mine.set(key, p);
    p.catch(() => {});
  }
  return p;
}

/** Makes rectangles of the photo by the network, each up to maxW × maxH sensor pixels.
 * @param {GPUDevice} device @param {GPUTexture} mosaic
 * @param {{ phase: number[], black: number, white: number, wb: number[], iso?: number, smooth?: number, noise?: { a: number[], b: number[] } | null, fringe?: { centre: number[], reach: number, table: Float32Array } | null }} info
 * @param {number} maxW @param {number} maxH @param {{ kind?: 'f16' | 'f32', kept?: boolean | number[] }} [o] */
export async function demosaicer(device, mosaic, info, maxW, maxH, o = {}) {
  const net = await compile(device, o.kind, o.kept), { g, pipes, wino, caFix, ttaPipes, cut, place, held, exported } = net;
  const [px, py] = info.phase, WIN = g.win, HALO = g.halo, CORE = WIN - 2 * HALO - 6;
  const at = (/** @type {number} */ x, /** @type {number} */ y) => +LAYOUT[((((y + py) % 6) + 6) % 6) * 6 + ((((x + px) % 6) + 6) % 6)];
  let lead = /** @type {number[] | null} */ (null);
  for (let oy = 0; oy < 6 && !lead; oy++) for (let ox = 0; ox < 6 && !lead; ox++) if (g.cfa.every((c, k) => at(ox + (k % 6), oy + Math.floor(k / 6)) === c)) lead = [ox, oy];
  if (!lead) throw new Error('the network is for another pattern');
  const [lx, ly] = lead, snap = (/** @type {number} */ v, /** @type {number} */ l) => v - ((((v - l) % 6) + 6) % 6);
  const buf = (/** @type {number} */ size, /** @type {number} */ usage) => device.createBuffer({ size, usage });
  const bufs = g.sizes.map((size, id) => held[id] || buf(size, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST));
  const out = buf(maxW * maxH * 8, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
  const winoRun = wino ? winoRunner(device, g, wino, bufs) : null;
  const caRun = caFixRunner(device, g, caFix, bufs);
  const ttaRun = ttaRunner(device, g, ttaPipes, bufs);
  const FR = 32 + SPOTS * SPOT_ROWS * 4, SIZE = (FR + FRINGE_FLOATS) * 4, view = mosaic.createView();
  /** @type {{ uni: GPUBuffer, valid: GPUBuffer, cut: GPUBindGroup, place: GPUBindGroup, ops: GPUBindGroup[] }[]} */
  const slots = [];
  const slot = (/** @type {number} */ k) => (slots[k] ||= (() => {
    const uni = buf(SIZE, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST), valid = buf(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const group = (/** @type {GPUComputePipeline} */ pipe, /** @type {GPUBindGroupEntry[]} */ entries) => device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries });
    return { uni, valid,
      cut: group(cut, [{ binding: 0, resource: view }, { binding: 1, resource: { buffer: uni } }, { binding: 2, resource: { buffer: bufs[g.mosaic] } }, { binding: 3, resource: { buffer: bufs[g.sigma] } }]),
      place: group(place, [{ binding: 0, resource: view }, { binding: 1, resource: { buffer: uni } }, { binding: 2, resource: { buffer: bufs[g.mosaic] } }, { binding: 3, resource: { buffer: bufs[g.sigma] } }, { binding: 4, resource: { buffer: bufs[g.output] } }, { binding: 5, resource: { buffer: out } }]),
      ops: wino ? [] : g.ops.map((o, i) => group(pipes[i], [...o.code.matchAll(/@binding\((\d)\)/g)].map((m) => +m[1]).map((b) => ({ binding: b, resource: { buffer: b === 5 ? valid : bufs[o.binds[b]] } })))) };
  })());
  const noiseOf = () => info.noise || noiseAt(info.iso || 100), g1 = info.wb?.[1] || 1;
  let laid = 0;
  const needsCa = (/** @type {number} */ wx, /** @type {number} */ wy, /** @type {number} */ vw, /** @type {number} */ vh) => {
    const fr = info.fringe; if (!fr) return false;
    const [cx, cy] = fr.centre, invR = 15 / fr.reach, tbl = fr.table;
    for (const x of [wx, wx + vw]) for (const y of [wy, wy + vh]) {
      const r = Math.hypot(x - cx, y - cy), t = Math.min(r * invR, 15), j = Math.min(Math.floor(t), 14), f = t - j;
      const ax = tbl[j * 4] * (1 - f) + tbl[(j + 1) * 4] * f, ay = tbl[j * 4 + 1] * (1 - f) + tbl[(j + 1) * 4 + 1] * f;
      if (r * Math.max(Math.abs(ax), Math.abs(ay)) >= 0.08) return true;
    }
    return false;
  };
  /** @returns {[GPUComputePipeline, GPUBindGroup, number, number, number, boolean?, number?][] & { vw: number, vh: number, pre: number }} */
  const lay = (/** @type {number} */ n, /** @type {number[]} */ [rx, ry, rw, rh], /** @type {number} */ x0, /** @type {number} */ y0, /** @type {Float32Array | null | undefined} */ spots, /** @type {number} */ k, keep = 0, quiet = 0, tta = 1, skipBody = false) => {
    const cw = Math.min(CORE, rx + rw - x0), ch = Math.min(CORE, ry + rh - y0), wx = snap(x0 - HALO, lx), wy = snap(y0 - HALO, ly), noise = noiseOf();
    const vw = Math.min(WIN, Math.ceil((x0 + cw + HALO - wx) / 6) * 6), vh = Math.min(WIN, Math.ceil((y0 + ch + HALO - wy) / 6) * 6), s = slot(n);
    laid += vw * vh;
    const u = new ArrayBuffer(SIZE), i = new Int32Array(u), f = new Float32Array(u);
    i.set([wx, wy, vw, vh, x0, y0, cw, ch, rx, ry, rw, rh, px, py]); f[14] = info.black; f[15] = 1 / (info.white - info.black);
    f.set([(info.wb?.[0] || g1) / g1, 1, (info.wb?.[2] || g1) / g1, 0], 16); f.set(noise.a.map((a) => a * k), 20); f.set(noise.b.map((b) => b * k), 24); f[23] = keep; f[27] = quiet;
    if (spots) { i[28] = spots[0]; f.set(spots.subarray(4), 32); }
    packFringe(f, FR, info.fringe);
    device.queue.writeBuffer(s.uni, 0, u); device.queue.writeBuffer(s.valid, 0, new Uint32Array([vh, vw, 0, 0]));
    /** @type {[GPUComputePipeline, GPUBindGroup, number, number, number, boolean?, number?][]} */
    const pre = [[cut, s.cut, Math.ceil(vw / 8), Math.ceil(vh / 8), 1, false, 0]];
    if (needsCa(wx, wy, vw, vh)) pre.push(...caRun(s.uni, vw, vh));
    const inner = skipBody ? [] : winoRun
      ? winoRun.passes(s.valid, vw, vh)
      : g.ops.map((op, j) => /** @type {[GPUComputePipeline, GPUBindGroup, number, number, number, boolean, number]} */ ([pipes[j], s.ops[j], op.groups[0], op.groups[1], op.groups[2], canSlice(op.code), j + 1]));
    const body = !skipBody && tta > 1 ? ttaRun.wrap(s.valid, vw, vh, tta, inner) : inner;
    /** @type {[GPUComputePipeline, GPUBindGroup, number, number, number, boolean, number]} */
    const post = [place, s.place, Math.ceil(cw / 8), Math.ceil(ch / 8), 1, false, g.ops.length + 1];
    return Object.assign([...pre, ...body, post], { vw, vh, pre: pre.length });
  };
  /** @param {GPUCommandEncoder} enc @param {number} rx @param {number} ry @param {number} rw @param {number} rh
   * @param {Float32Array | null} [spots] @param {number} [smooth] @param {number} [keep] @param {number} [quiet] @param {number} [tta] */
  const run = (enc, rx, ry, rw, rh, spots, smooth, keep = 0, quiet = 0, tta = 1) => {
    const k = Math.max(0, smooth ?? info.smooth ?? 1) ** 2;
    let n = 0;
    for (let y0 = ry; y0 < ry + rh; y0 += CORE) for (let x0 = rx; x0 < rx + rw; x0 += CORE) {
      const pass = enc.beginComputePass();
      for (const [pipe, bind, a, b, c] of lay(n++, [rx, ry, rw, rh], x0, y0, spots, k, keep, quiet, tta)) { pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(a, b, c); }
      pass.end();
    }
  };
  /** @param {number} rx @param {number} ry @param {number} rw @param {number} rh @param {Float32Array | null} [spots] @param {number} [smooth]
   * @param {number} [keep] @param {number} [quiet] @param {{ stop?: () => boolean, note?: (ms: number) => void, aim?: number, tta?: number }} [o] */
  const pace = async (rx, ry, rw, rh, spots, smooth, keep = 0, quiet = 0, o = {}) => {
    const k = Math.max(0, smooth ?? info.smooth ?? 1) ** 2;
    for (let y0 = ry; y0 < ry + rh; y0 += CORE) for (let x0 = rx; x0 < rx + rw; x0 += CORE) {
      const passes = lay(0, [rx, ry, rw, rh], x0, y0, spots, k, keep, quiet, o.tta || 1).map((p) => /** @type {import('./net-pace.js').Paced} */ ([p[0], p[1], p[2], p[3], p[4], !!p[5], p[6] || 0]));
      if (!(await paced(device, passes, slot(0).valid, o))) return false;
    }
    return true;
  };
  /** Runs an export piece cleanly one TTA orientation per GPU submit so Ultra 4x never locks mobile GPUs or stalls Cancel.
   * @param {number} rx @param {number} ry @param {number} rw @param {number} rh @param {Float32Array | null} [spots] @param {number} [smooth]
   * @param {number} [keep] @param {number} [quiet] @param {number} [tta] @param {{ signal?: AbortSignal, onStep?: (frac: number) => void }} [o] */
  const runExport = async (rx, ry, rw, rh, spots, smooth, keep = 0, quiet = 0, tta = 1, o = {}) => {
    const k = Math.max(0, smooth ?? info.smooth ?? 1) ** 2;
    const wins = [];
    for (let y0 = ry; y0 < ry + rh; y0 += CORE) for (let x0 = rx; x0 < rx + rw; x0 += CORE) wins.push([x0, y0]);
    const total = wins.length * Math.max(1, tta);
    let step = 0;
    for (const [x0, y0] of wins) {
      o.signal?.throwIfAborted();
      const base = lay(0, [rx, ry, rw, rh], x0, y0, spots, k, keep, quiet, 1);
      const pre = base.slice(0, base.pre), inner = base.slice(base.pre, -1), post = base[base.length - 1];
      const groups = tta > 1 ? ttaRun.wrapGroups(slot(0).valid, base.vw, base.vh, tta, inner) : [inner];
      for (let gi = 0; gi < groups.length; gi++) {
        o.signal?.throwIfAborted();
        const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
        const list = [...(gi === 0 ? pre : []), ...groups[gi], ...(gi === groups.length - 1 ? [post] : [])];
        for (const [pipe, bind, a, b, c] of list) { pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(a, b, c); }
        pass.end();
        device.queue.submit([enc.finish()]);
        await device.queue.onSubmittedWorkDone();
        o.onStep?.(++step / total);
        if (groups.length > 1) await new Promise((r) => setTimeout(r, 0));
      }
    }
  };
  /** @type {Parts} */
  const parts = { device, g, exported, pipes, bufs, unhalf, get valid() { return slot(0).valid; }, lay: (side = CORE) => lay(0, [0, 0, Math.min(CORE, maxW, side), Math.min(CORE, maxH, side)], 0, 0, null, 1), at: lay };
  const spare = [bufs[3], bufs[4], ...(winoRun ? winoRun.spare : [])].filter(Boolean);
  return { out, spare, run, runExport, pace, parts, core: CORE, get laid() { return laid; }, destroy: () => { winoRun?.destroy(); ttaRun.destroy(); out.destroy(); bufs.forEach((b, id) => { if (!held[id]) b.destroy(); }); slots.forEach((s) => { s.uni.destroy(); s.valid.destroy(); }); } };
}
