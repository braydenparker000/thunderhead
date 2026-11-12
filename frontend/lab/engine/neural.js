// @ts-check
// Full resolution from the sensor's own pixels by a network: Starfish's joint demosaic and noise reduction for
// X-Trans (nets/starfish-xtrans/, MIT or Apache 2.0; its README says what it is and where it is from). It stands
// where demosaic.js's `demosaicer` does and gives its result in the same form, so sharpening, the lens pass, the
// frame and an export go on unchanged. Measured on known pictures it is about 1.2 dB truer than demosaic.js on
// clean pictures and 1.1 to 1.4 dB truer than demosaic.js with noise reduction at high ISO, at many times the
// work: it is for an export and for looking closer than 100 %, not for the dial.
//
// The network is the project's own export, run as exported: graph.txt lists the buffers and the passes, each
// pass is one of its .wgsl files, and its weights are one file. It was built for a window of 1056 × 1056 sensor
// pixels, of which the outer 30 are context; a rectangle is made a window at a time. Ours are the pass before
// (`cut`: a window of the sensor, each site brought to green's scale, and each site's noise as noise.js has it
// at the photo's ISO, which is how the network is told how much to smooth) and the pass after (`place`: the
// window's middle back to the sensor's scale, in the editing copy's form, the clipped colours flagged).
import { phaseOf } from './demosaic.js';
import { SPOTS, SPOT_ROWS, mendWGSL } from './mend.js';
import { noiseAt } from './noise.js';

export { phaseOf };
const DIR = new URL('./nets/starfish-xtrans/', import.meta.url);
const LAYOUT = '101121212010101121121101010212121101';   // demosaic.js's: the pattern as `colour` reads it
const CLIP = 0.97;   // demosaic.js's: a site this near the sensor's white has clipped

/** @typedef {{ kind: 'f16' | 'f32', win: number, halo: number, cfa: number[], sizes: number[], files: (string | null)[], mosaic: number, sigma: number, output: number,
 *   ops: { code: string, binds: number[], groups: number[] }[], weights: Map<number, ArrayBuffer> }} Graph */
/** @type {WeakMap<GPUDevice, Promise<{ g: Graph, pipes: GPUComputePipeline[], cut: GPUComputePipeline, place: GPUComputePipeline, held: GPUBuffer[], off: number }>>} */
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
           na: vec4f, nb: vec4f,   // a site's noise: its variance is na × its value + nb, for red, green and blue
           n: vec4u,       // spots to retouch (heal.js): how many
           sp: array<vec4f, ${SPOTS * SPOT_ROWS}> };
@group(0) @binding(0) var mosaic: texture_2d<u32>;
@group(0) @binding(1) var<uniform> d: D;
@group(0) @binding(2) var<storage, read_write> mos: array<T>;
@group(0) @binding(3) var<storage, read_write> sig: array<T>;
@group(0) @binding(4) var<storage, read> made: array<T>;   // the network's result: red, green and blue, a window each
@group(0) @binding(5) var<storage, read_write> rgb: array<u32>;   // the result, two a pixel (as demosaic.js writes it)
// a position off the frame reads the same colour's site, whole patterns (6 pixels) in
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
// a site's value: its own, or near a retouched spot what the spot puts there (demosaic.js's raw)
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
  let v = clamp(raw(q), 0.0, 1.0); let c = colour(q); let g = d.gain[c]; let p = id.y * WIN + id.x;
  mos[p] = T(v * g);
  sig[p] = T(sqrt(max(d.na[c] * v + d.nb[c], 0.0)) * g);
}
@compute @workgroup_size(8, 8)
fn place(@builtin(global_invocation_id) id: vec3u) {
  if (i32(id.x) >= d.core.z || i32(id.y) >= d.core.w) { return; }
  let q = d.core.xy + vec2i(id.xy); let w = vec2u(q - d.at.xy); let p = w.y * WIN + w.x; let plane = WIN * WIN;
  let c3 = vec3f(f32(made[p]), f32(made[plane + p]), f32(made[2u * plane + p])) / d.gain.xyz;
  var clip = 0u;   // which colours clipped at this pixel or beside it, as demosaic.js flags them
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) { let s = q + vec2i(i, j); if (own(s) >= ${CLIP}) { clip |= 1u << colour(s); } } }
  let u = vec3u(clamp(c3, vec3f(0.0), vec3f(1.0)) * 65535.0 + 0.5);
  let r = q - d.rect.xy; let n = u32(r.y * d.rect.z + r.x) * 2u;
  rgb[n] = u.x | (u.y << 16u); rgb[n + 1u] = u.z | (clip << 16u);
}`;

const half = (/** @type {number} */ v) => { const f = new Float32Array([v]), x = new Uint32Array(f.buffer)[0], e = ((x >> 23) & 255) - 112, m = (x >> 13) & 1023; return e <= 0 ? 0 : e >= 31 ? 31744 : (e << 10) | m; };   // a float as a half float's bits (0 to 65504, truncated)
const unhalf = (/** @type {number} */ h) => { const e = (h >> 10) & 31, m = h & 1023, v = e === 0 ? m * 2 ** -24 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15); return h & 32768 ? -v : v; };
/** How far the network may be from a grey slope it is shown, of the sensor's range: on the software GPU it is
 * within 0.003; a GPU whose driver gets the network wrong is nowhere near. */
export const PROOF = 0.02;
/** The network is shown a small grey picture with a slope across it, and must give that picture back: grey has
 * the same value at every site, so the right answer is known without keeping one. A GPU that gives anything
 * else (a driver's fault in the half floats, a pass it compiles wrongly) is not used: this throws, and the
 * views are made the usual way. It costs one small window, once a device.
 * @param {GPUDevice} device @param {Graph} g @param {GPUComputePipeline[]} pipes @param {GPUBuffer[]} held */
async function proof(device, g, pipes, held) {
  const N = 96, WIN = g.win, wide = g.kind === 'f16' ? 2 : 4, slope = (/** @type {number} */ x, /** @type {number} */ y) => 0.15 + 0.5 * (x / N) + 0.2 * (y / N);
  const bufs = g.sizes.map((size, id) => held[id] || device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC }));
  const valid = device.createBuffer({ size: 8, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), back = device.createBuffer({ size: 3 * N * wide, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    const row = (/** @type {(x: number, y: number) => number} */ of, /** @type {number} */ y) => (wide === 2 ? Uint16Array.from({ length: N }, (_, x) => half(of(x, y))) : Float32Array.from({ length: N }, (_, x) => of(x, y)));
    for (let y = 0; y < N; y++) { device.queue.writeBuffer(bufs[g.mosaic], y * WIN * wide, row(slope, y)); device.queue.writeBuffer(bufs[g.sigma], y * WIN * wide, row(() => 0.002, y)); }
    device.queue.writeBuffer(valid, 0, new Uint32Array([N, N]));
    const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
    g.ops.forEach((o, j) => {
      pass.setPipeline(pipes[j]);
      pass.setBindGroup(0, device.createBindGroup({ layout: pipes[j].getBindGroupLayout(0), entries: [...o.code.matchAll(/@binding\((\d)\)/g)].map((m) => +m[1]).map((b) => ({ binding: b, resource: { buffer: b === 5 ? valid : bufs[o.binds[b]] } })) }));
      pass.dispatchWorkgroups(o.groups[0], o.groups[1], o.groups[2]);
    });
    pass.end();
    const Y = N / 2;   // the middle row of each colour's plane
    for (let c = 0; c < 3; c++) enc.copyBufferToBuffer(bufs[g.output], (c * WIN * WIN + Y * WIN) * wide, back, c * N * wide, N * wide);
    device.queue.submit([enc.finish()]);
    await back.mapAsync(GPUMapMode.READ);
    const got = wide === 2 ? Array.from(new Uint16Array(back.getMappedRange()), unhalf) : Array.from(new Float32Array(back.getMappedRange()));
    let off = 0;
    for (let c = 0; c < 3; c++) for (let x = g.halo; x < N - g.halo; x++) off = Math.max(off, Math.abs(got[c * N + x] - slope(x, Y)));
    if (!(off <= PROOF)) throw new Error(`the network gives a wrong picture on this GPU (off by ${off})`);
    return off;
  } finally { valid.destroy(); back.destroy(); bufs.forEach((b, id) => { if (!held[id]) b.destroy(); }); }
}

/** The network on a device: read, compiled and proved once. @param {GPUDevice} device */
export function compile(device) {
  let p = made.get(device);
  if (!p) {
    p = (async () => {
      const g = await read(device.features.has('shader-f16') ? 'f16' : 'f32'), mod = device.createShaderModule({ code: ours(g) });
      const pipe = (/** @type {GPUShaderModule} */ module, /** @type {string} */ entryPoint) => device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint } });
      const [cut, place, ...pipes] = await Promise.all([pipe(mod, 'cut'), pipe(mod, 'place'), ...g.ops.map((o) => pipe(device.createShaderModule({ code: o.code }), 'main'))]);
      // the weights, held once for every view of every photo
      const held = g.sizes.map((size, id) => { const w = g.weights.get(id); if (!w) return /** @type {any} */ (null); const b = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, w); return b; });
      g.weights.clear();
      const off = await proof(device, g, pipes, held);
      return { g, pipes, cut, place, held, off };
    })();
    made.set(device, p);
    p.catch(() => {});   // a GPU that fails keeps failing: it is not tried again on this device
  }
  return p;
}

/** Makes rectangles of the photo by the network, each up to maxW × maxH sensor pixels, as demosaic.js's
 * `demosaicer` does: `run` adds the passes to a frame's commands and the result is in `out`, rw pixels a row.
 * @param {GPUDevice} device @param {GPUTexture} mosaic the sensor's pixels, r16uint
 * @param {{ phase: number[], black: number, white: number, wb: number[], iso?: number, smooth?: number }} info `iso`: the photo's, for its noise;
 *   `smooth`: how much of that noise the network is told of (1: all of it; less keeps more grain, more smooths further)
 * @param {number} maxW @param {number} maxH */
export async function demosaicer(device, mosaic, info, maxW, maxH) {
  const { g, pipes, cut, place, held } = await compile(device), [px, py] = info.phase, WIN = g.win, HALO = g.halo, CORE = WIN - 2 * HALO - 6;
  // where the network's pattern sits on this sensor: a window starts on a sensor pixel that is its pattern's first
  const at = (/** @type {number} */ x, /** @type {number} */ y) => +LAYOUT[((((y + py) % 6) + 6) % 6) * 6 + ((((x + px) % 6) + 6) % 6)];
  let lead = /** @type {number[] | null} */ (null);
  for (let oy = 0; oy < 6 && !lead; oy++) for (let ox = 0; ox < 6 && !lead; ox++) if (g.cfa.every((c, k) => at(ox + (k % 6), oy + Math.floor(k / 6)) === c)) lead = [ox, oy];
  if (!lead) throw new Error('the network is for another pattern');
  const [lx, ly] = lead, snap = (/** @type {number} */ v, /** @type {number} */ l) => v - ((((v - l) % 6) + 6) % 6);
  const buf = (/** @type {number} */ size, /** @type {number} */ usage) => device.createBuffer({ size, usage });
  const bufs = g.sizes.map((size, id) => held[id] || buf(size, GPUBufferUsage.STORAGE)), out = buf(maxW * maxH * 8, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
  const SIZE = 128 + SPOTS * SPOT_ROWS * 16, view = mosaic.createView();
  /** A window's own settings and bindings: several windows are laid in one frame's commands, each read when it runs.
   * @type {{ uni: GPUBuffer, valid: GPUBuffer, cut: GPUBindGroup, place: GPUBindGroup, ops: GPUBindGroup[] }[]} */
  const slots = [];
  const slot = (/** @type {number} */ k) => (slots[k] ||= (() => {
    const uni = buf(SIZE, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST), valid = buf(8, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const group = (/** @type {GPUComputePipeline} */ pipe, /** @type {GPUBindGroupEntry[]} */ entries) => device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries });
    return { uni, valid,
      cut: group(cut, [{ binding: 0, resource: view }, { binding: 1, resource: { buffer: uni } }, { binding: 2, resource: { buffer: bufs[g.mosaic] } }, { binding: 3, resource: { buffer: bufs[g.sigma] } }]),
      place: group(place, [{ binding: 0, resource: view }, { binding: 1, resource: { buffer: uni } }, { binding: 4, resource: { buffer: bufs[g.output] } }, { binding: 5, resource: { buffer: out } }]),
      // each pass is given the bindings its own code names: 0 to 3 read, 4 written, 5 how much of the window is filled
      ops: g.ops.map((o, i) => group(pipes[i], [...o.code.matchAll(/@binding\((\d)\)/g)].map((m) => +m[1]).map((b) => ({ binding: b, resource: { buffer: b === 5 ? valid : bufs[o.binds[b]] } })))) };
  })());
  /** @param {GPUCommandEncoder} enc @param {number} rx @param {number} ry @param {number} rw @param {number} rh
   * @param {Float32Array | null} [spots] retouching, as heal.js's `spotRows` gives it @param {number} [smooth] this once, in place of `info.smooth` */
  const run = (enc, rx, ry, rw, rh, spots, smooth) => {
    const noise = noiseAt(info.iso || 100), k = Math.max(0, smooth ?? info.smooth ?? 1) ** 2, g1 = info.wb?.[1] || 1;
    let n = 0;
    for (let y0 = ry; y0 < ry + rh; y0 += CORE) for (let x0 = rx; x0 < rx + rw; x0 += CORE) {
      const cw = Math.min(CORE, rx + rw - x0), ch = Math.min(CORE, ry + rh - y0), wx = snap(x0 - HALO, lx), wy = snap(y0 - HALO, ly);
      const vw = Math.min(WIN, Math.ceil((x0 + cw + HALO - wx) / 6) * 6), vh = Math.min(WIN, Math.ceil((y0 + ch + HALO - wy) / 6) * 6), s = slot(n++);
      const u = new ArrayBuffer(SIZE), i = new Int32Array(u), f = new Float32Array(u);
      i.set([wx, wy, vw, vh, x0, y0, cw, ch, rx, ry, rw, rh, px, py]); f[14] = info.black; f[15] = 1 / (info.white - info.black);
      f.set([(info.wb?.[0] || g1) / g1, 1, (info.wb?.[2] || g1) / g1, 0], 16); f.set(noise.a.map((a) => a * k), 20); f.set(noise.b.map((b) => b * k), 24);
      if (spots) { i[28] = spots[0]; f.set(spots.subarray(4), 32); }
      device.queue.writeBuffer(s.uni, 0, u); device.queue.writeBuffer(s.valid, 0, new Uint32Array([vh, vw]));
      const pass = enc.beginComputePass();
      pass.setPipeline(cut); pass.setBindGroup(0, s.cut); pass.dispatchWorkgroups(Math.ceil(vw / 8), Math.ceil(vh / 8));
      g.ops.forEach((o, j) => { pass.setPipeline(pipes[j]); pass.setBindGroup(0, s.ops[j]); pass.dispatchWorkgroups(o.groups[0], o.groups[1], o.groups[2]); });
      pass.setPipeline(place); pass.setBindGroup(0, s.place); pass.dispatchWorkgroups(Math.ceil(cw / 8), Math.ceil(ch / 8));
      pass.end();
    }
  };
  return { out, run, destroy: () => { out.destroy(); bufs.forEach((b, id) => { if (!held[id]) b.destroy(); }); for (const s of slots) { s.uni.destroy(); s.valid.destroy(); } } };
}
