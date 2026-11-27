// @ts-check
// The editing copy made again from the photo's full resolution, once its pixels are on the GPU (full.js). The decoder
// makes the copy the photo opens with by taking each 3 x 3 cell's mean of each colour (engine/raw/src/lib.rs): quick,
// but a box is a soft filter, and on an X-Trans sensor a cell's reds, greens and blues sit in different places, so a
// line thinner than the cell comes out coloured (AUDIT.md 8.5). Every fitted view and every edit at fit shows the
// copy, so its softness is what a photo looks like zoomed out (the owner, 2026-11-16: "kinda low quality" beside
// the camera's own JPEG). Here, as Lightroom makes its smart previews, the sensor is demosaiced at full resolution
// (demosaic.js, as 100 % and exports are; its fringing left to the copy's own lens pass) a tile at a time, and each
// tile is shrunk to the copy's size by Lanczos-3 in linear light, each result held between the least and the most of
// the 3 x 3 pixels it stands for, so no edge rings. That is the copy's brightness; its colour is taken, as a camera's
// own JPEG takes it, from a smoother estimate: each colour's own sites round the cell's middle (a Gaussian as wide as
// the decoder's box, the same for all three), which keeps the full demosaic's little moire on the finest patterns
// out of the copy. A picture (a JPEG) is shrunk from its own pixels alone (picture.js `copier`). The clipped flags are
// any of the cell's, as the decoder's are (the highlight rebuild reads them).

import { doing, mark, turn } from './work.js';

export const TILE = 228;   // copy pixels a tile's side: 684 sensor pixels, about half a megapixel of the demosaic's buffers at a time (2026-11-16: 342 asked twice the memory)
const REACH = 8;    // Lanczos-3 at a third: sensor pixels each side of a copy pixel's middle that weigh in
const BUDGET = 30_000;   // ms of the GPU's own time the whole copy may take: a GPU slower than that (a software one) keeps the decoder's copy
const CHUNK = 4 << 20;   // bytes read back at a time: the new copy comes back to the page a piece at a time, not all at once
/** The largest rectangle a tile asks of the demosaic (or the copier), each way: what to make it with. */
export const SIDE = 3 * TILE + 2 * REACH + 1;
const sinc = (/** @type {number} */ x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const WEIGHTS = Array.from({ length: 2 * REACH + 1 }, (_, i) => sinc((i - REACH) / 3) * sinc((i - REACH) / 9));
const SUM = WEIGHTS.reduce((s, w) => s + w, 0);
/** The GPU memory making the copy again asks, its maker's included (a demosaic's buffers are about 52 bytes a pixel of `SIDE` squared), for a copy w x h. @param {number} w @param {number} h */
export const need = (w, h) => w * h * 8 + SIDE * TILE * 48 + CHUNK + SIDE * SIDE * 52;

// The shader is written plainly for the phones' graphics drivers (2026-11-17: the A35's chip reset half a second into
// the first copy, at 254 of its 720 MB): no array or vector indexed by a number known only as it runs (the 17 taps each
// way are written out with their weights; a site's colour picks its sum by a mask), and the colour from each colour's
// own sites is its own pass (`tint`), so no one pass holds much at once.
const tap = (/** @type {(d: number) => string} */ f) => WEIGHTS.map((_, i) => f(i - REACH)).join('\n    ');
const w = (/** @type {number} */ d) => (WEIGHTS[d + REACH] / SUM).toFixed(8);
const SHADER = /* wgsl */ `
struct P { rect: vec4i, tile: vec4i, copy: vec2u, phase: vec2i, black: f32, scale: f32, sensor: u32, pad: u32, wb: vec4f }   // the demosaiced rectangle (sensor); the tile (copy pixels); the copy's size; the mosaic's own
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> src: array<u32>;          // the rectangle, in the editing copy's form (two u32 a pixel)
@group(0) @binding(2) var<storage, read_write> mid: array<vec4f>;  // across done, down to do: the sum and its flags, the least, the most
@group(0) @binding(3) var<storage, read_write> outp: array<u32>;   // the new copy
@group(0) @binding(4) var mos: texture_2d<u32>;                     // the sensor's pixels (a picture's copy: unused)
fn at(x: i32, y: i32) -> vec4f {
  let n = u32(y * p.rect.z + clamp(x, 0, p.rect.z - 1)) * 2u; let a = src[n]; let b = src[n + 1u];
  return vec4f(f32(a & 0xffffu), f32(a >> 16u), f32(b & 0xffffu), f32(b >> 16u));
}
@compute @workgroup_size(8, 8)
fn across(@builtin(global_invocation_id) id: vec3u) {
  if (i32(id.x) >= p.tile.z || i32(id.y) >= p.rect.w) { return; }
  let c = 3 * (p.tile.x + i32(id.x)) + 1 - p.rect.x; let y = i32(id.y);
  var s = vec3f(0.0);
  ${tap((d) => `s += ${w(d)} * at(c + ${d}, y).rgb;`)}
  let l = at(c - 1, y); let m0 = at(c, y); let r = at(c + 1, y);
  let lo = min(min(l.rgb, m0.rgb), r.rgb); let hi = max(max(l.rgb, m0.rgb), r.rgb); let flags = u32(l.a) | u32(m0.a) | u32(r.a);
  let m = (id.y * u32(p.tile.z) + id.x) * 3u;
  mid[m] = vec4f(s, f32(flags)); mid[m + 1u] = vec4f(lo, 0.0); mid[m + 2u] = vec4f(hi, 0.0);
}
fn row(y: i32, x: u32) -> u32 { return (u32(clamp(y, 0, p.rect.w - 1)) * u32(p.tile.z) + x) * 3u; }
@compute @workgroup_size(8, 8)
fn down(@builtin(global_invocation_id) id: vec3u) {
  if (i32(id.x) >= p.tile.z || i32(id.y) >= p.tile.w) { return; }
  let c = 3 * (p.tile.y + i32(id.y)) + 1 - p.rect.y;
  var s = vec3f(0.0);
  ${tap((d) => `s += ${w(d)} * mid[row(c + ${d}, id.x)].rgb;`)}
  let u0 = row(c - 1, id.x); let u1 = row(c, id.x); let u2 = row(c + 1, id.x);
  let lo = min(min(mid[u0 + 1u].rgb, mid[u1 + 1u].rgb), mid[u2 + 1u].rgb); let hi = max(max(mid[u0 + 2u].rgb, mid[u1 + 2u].rgb), mid[u2 + 2u].rgb);
  let flags = u32(mid[u0].a) | u32(mid[u1].a) | u32(mid[u2].a);
  let u = vec3u(clamp(clamp(s, lo, hi), vec3f(0.0), vec3f(65535.0)) + 0.5);
  let n = (u32(p.tile.y + i32(id.y)) * p.copy.x + u32(p.tile.x + i32(id.x))) * 2u;
  outp[n] = u.x | (u.y << 16u); outp[n + 1u] = u.z | ((flags & 0xffffu) << 16u);
}
fn colour(q: vec2i) -> vec3f {   // a site's colour as a mask: red, green or blue (demosaic.js's layout)
  let s = q + p.phase + 6000; let b = s / 3; let m = s - b * 3;
  if (((m.x + m.y) & 1) == 0) { return vec3f(0.0, 1.0, 0.0); }
  return select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), (((b.x + b.y) & 1) == 1) != (m.y == 1));
}
/** the sensor's: the demosaic's brightness, the colour of each colour's own sites round the copy pixel's middle, weighted
 * alike (sigma 0.82 sites, the decoder's box's spread; 7x7 reaches >3.6 sigma) */
@compute @workgroup_size(8, 8)
fn tint(@builtin(global_invocation_id) id: vec3u) {
  if (i32(id.x) >= p.tile.z || i32(id.y) >= p.tile.w) { return; }
  let n = (u32(p.tile.y + i32(id.y)) * p.copy.x + u32(p.tile.x + i32(id.x))) * 2u; let a = outp[n]; let b = outp[n + 1u];
  let v = vec3f(f32(a & 0xffffu), f32(a >> 16u), f32(b & 0xffffu));
  let c = vec2i(3 * (p.tile.x + i32(id.x)) + 1, 3 * (p.tile.y + i32(id.y)) + 1); let e = vec2i(textureDimensions(mos)) - 1;
  var s = vec3f(0.0); var w = vec3f(0.0);
  for (var dy = -3; dy <= 3; dy++) { for (var dx = -3; dx <= 3; dx++) {
    let q = clamp(c + vec2i(dx, dy), vec2i(0), e); let k = colour(q) * exp(-f32(dx * dx + dy * dy) / ${2 * 0.82 * 0.82});
    s += k * f32(textureLoad(mos, q, 0).r); w += k;
  } }
  let g = max(s / max(w, vec3f(1e-9)) - p.black, vec3f(0.0)) * p.scale; let yv = dot(v, p.wb.xyz); let yg = dot(g, p.wb.xyz);
  if (yg <= 1.0) { return; }
  let u = vec3u(clamp(g * (yv / yg), vec3f(0.0), vec3f(65535.0)) + 0.5);
  outp[n] = u.x | (u.y << 16u); outp[n + 1u] = u.z | (b & 0xffff0000u);
}`;

/** @type {WeakMap<GPUDevice, Promise<GPUComputePipeline[]>>} */
const compiled = new WeakMap();
const pipes = (/** @type {GPUDevice} */ device) => {
  let p = compiled.get(device);
  if (!p) {
    const module = device.createShaderModule({ code: SHADER });
    p = Promise.all(['across', 'down', 'tint'].map((entryPoint) => device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint } })));
    compiled.set(device, p);
  }
  return p;
};

/** Makes the editing copy (w x h, four 16-bit values a pixel) again into `dst`, from the photo's full resolution (W x H)
 * as `maker` makes it a rectangle at a time (demosaic.js `demosaicer` or picture.js `copier`, made for `SIDE` x `SIDE`),
 * and gives the new copy read back for the page's own uses (the eyedropper, Auto, the heal's search); null where the
 * photo closed first (`alive`), or where this GPU would take longer than `BUDGET` (timed on the first two tiles: a phone's
 * makes a 40 MP photo in seconds, a software GPU in minutes). A tile a submit, each when nothing in front holds the GPU
 * (work.js `turn`), so the photo's own frames go first; the badge says "Building a sharper copy" meanwhile.
 * @param {GPUDevice} device @param {GPUBuffer} dst @param {number} w @param {number} h
 * @param {{ out: GPUBuffer, run: (enc: GPUCommandEncoder, rx: number, ry: number, rw: number, rh: number, spots?: Float32Array | null) => void }} maker
 * @param {number} W @param {number} H @param {() => boolean} [alive]
 * @param {{ mos: GPUTexture, phase: number[], black: number, white: number, wb: number[] } | null} [sensor] the sensor's pixels, for the copy's colour (a picture: none)
 * @param {number} [tile] copy pixels a tile's side, at most TILE (smaller on a phone whose chip reset making it: gentle.js) */
export async function remake(device, dst, w, h, maker, W, H, alive = () => true, sensor = null, tile = TILE) {
  const done = doing('Building a sharper copy');
  let ended = mark('copy-compile');   // (each step marked as it begins and ends: the editor's reports say which one a reset came in)
  const [across, down, tint] = await pipes(device);
  ended();
  const bytes = w * h * 8, uni = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const none = sensor ? null : device.createTexture({ size: [1, 1], format: 'r16uint', usage: GPUTextureUsage.TEXTURE_BINDING });
  const mid = device.createBuffer({ size: SIDE * TILE * 48, usage: GPUBufferUsage.STORAGE });
  const made = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const back = device.createBuffer({ size: CHUNK, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const entries = [...[uni, maker.out, mid, made].map((buffer, binding) => ({ binding, resource: /** @type {GPUBindingResource} */ ({ buffer }) })), { binding: 4, resource: (sensor?.mos || /** @type {GPUTexture} */ (none)).createView() }];
  const binds = [[across, [0, 1, 2]], [down, [0, 2, 3]], [tint, [0, 3, 4]]].map(([pipe, uses]) => device.createBindGroup({ layout: /** @type {GPUComputePipeline} */ (pipe).getBindGroupLayout(0), entries: entries.filter((e) => /** @type {number[]} */ (uses).includes(e.binding)) }));
  const g1 = sensor?.wb?.[1] || 1, wb = sensor ? [(sensor.wb?.[0] || g1) / g1, 1, (sensor.wb?.[2] || g1) / g1] : [1, 1, 1];   // the light's balance, so brightness is read as a grey would be
  const T = Math.max(8, Math.min(TILE, Math.round(tile))), tiles = Math.ceil(w / T) * Math.ceil(h / T);
  let spent = 0;   // the GPU's own time on the tiles, waits for the photo's frames left out
  try {
    for (let cy = 0, k = 0; cy < h; cy += T) for (let cx = 0; cx < w; cx += T, k++) {
      await turn(); if (!alive()) return null;
      const t = performance.now(), tw = Math.min(T, w - cx), th = Math.min(T, h - cy);
      const rx = Math.max(0, 3 * cx + 1 - REACH), ry = Math.max(0, 3 * cy + 1 - REACH);
      const rw = Math.min(W, 3 * (cx + tw - 1) + 2 + REACH) - rx, rh = Math.min(H, 3 * (cy + th - 1) + 2 + REACH) - ry;
      const u = new ArrayBuffer(80); new Int32Array(u).set([rx, ry, rw, rh, cx, cy, tw, th]); new Uint32Array(u).set([w, h], 8); new Int32Array(u).set(sensor?.phase || [0, 0], 10);
      new Float32Array(u).set([sensor?.black ?? 0, sensor ? 65535 / Math.max(1, sensor.white - sensor.black) : 1], 12); new Uint32Array(u).set([sensor ? 1 : 0], 14); new Float32Array(u).set([...wb, 0], 16);
      device.queue.writeBuffer(uni, 0, u); performance.mark('th:copy');   // (the editor's gesture log says what ran in its worst gap: app/moved.js)
      const enc = device.createCommandEncoder();
      maker.run(enc, rx, ry, rw, rh, null);
      const pass = enc.beginComputePass();
      pass.setPipeline(across); pass.setBindGroup(0, binds[0]); pass.dispatchWorkgroups(Math.ceil(tw / 8), Math.ceil(rh / 8));
      pass.setPipeline(down); pass.setBindGroup(0, binds[1]); pass.dispatchWorkgroups(Math.ceil(tw / 8), Math.ceil(th / 8));
      if (sensor) { pass.setPipeline(tint); pass.setBindGroup(0, binds[2]); pass.dispatchWorkgroups(Math.ceil(tw / 8), Math.ceil(th / 8)); }
      pass.end();
      if (k === 0) ended = mark('copy-tile');   // the first tile
      device.queue.submit([enc.finish()]);
      await device.queue.onSubmittedWorkDone(); spent += performance.now() - t; if (k === 0) ended();
      if (k === 1 && tiles > 2 && (spent / 2) * tiles > BUDGET) { console.info(`the editing copy is kept as the decoder made it: this GPU would take ${Math.round((spent / 2000) * tiles)} s`); return null; }
    }
    if (!alive()) return null;
    ended = mark('copy-read');
    { const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(made, 0, dst, 0, bytes); device.queue.submit([enc.finish()]); }
    const copy = new Uint16Array(w * h * 4);   // and back to the page, a piece at a time
    for (let o = 0; o < bytes; o += CHUNK) {
      const n = Math.min(CHUNK, bytes - o), enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(made, o, back, 0, n); device.queue.submit([enc.finish()]);
      await back.mapAsync(GPUMapMode.READ, 0, n); copy.set(new Uint16Array(back.getMappedRange(0, n)), o / 2); back.unmap();
    }
    return copy;
  } finally { ended(); for (const b of [uni, mid, made, back]) b.destroy(); none?.destroy(); done(); }
}
