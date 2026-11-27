// @ts-check
// Exact D4 symmetry test-time augmentation (2x / 4x) for X-Trans Starfish.
// For Starfish v0.2.0's 6x6 CFA (and any window dimensions vw, vh divisible by 6),
// (x, y) -> (vw - 2 - x, y) [flipH], (x, vh - 2 - y) [flipV], and (vw - 2 - x, vh - 2 - y) [rot180]
// are exact self-inverse involutions that preserve the X-Trans CFA phase at every pixel.
// Measured +0.67 dB (2x) and +1.19 dB (4x) clean, +0.56 / +0.97 dB ISO 3200.
// Scratch buffers (~18 MB f16) are allocated lazily ONLY when tta > 1 (0 bytes when off).

/** @param {GPUDevice} device @param {import('./neural.js').Graph} g */
export async function compileTta(device, g) {
  const f16 = g.kind === 'f16', hdr = f16 ? 'enable f16;\nalias T = f16;\n' : 'alias T = f32;\n';
  const W = g.win, P = W * W;
  const code = /* wgsl */ `${hdr}
struct Cfg { vw: u32, vh: u32, fx: u32, fy: u32, weight: f32, clear: u32, p0: u32, p1: u32 }
const WIN: u32 = ${W}u; const PLANE: u32 = ${P}u;
@group(0) @binding(0) var<uniform> cfg: Cfg;
@group(0) @binding(1) var<storage, read> srcA: array<T>;
@group(0) @binding(2) var<storage, read> srcB: array<T>;
@group(0) @binding(3) var<storage, read_write> dstA: array<T>;
@group(0) @binding(4) var<storage, read_write> dstB: array<T>;
fn mapCoord(v: i32, lim: u32, flip: u32) -> u32 {
  if (flip == 0u) { return u32(v); }
  var s = i32(lim) - 2 - v;
  if (s < 0) { s += 6; }
  return u32(s);
}
@compute @workgroup_size(16, 16, 1)
fn flipIn(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= cfg.vw || id.y >= cfg.vh) { return; }
  let sx = mapCoord(i32(id.x), cfg.vw, cfg.fx);
  let sy = mapCoord(i32(id.y), cfg.vh, cfg.fy);
  let dst = id.y * WIN + id.x; let src = sy * WIN + sx;
  dstA[dst] = srcA[src]; dstB[dst] = srcB[src];
}`;

  const accCode = /* wgsl */ `${hdr}
struct Cfg { vw: u32, vh: u32, fx: u32, fy: u32, weight: f32, clear: u32, p0: u32, p1: u32 }
const WIN: u32 = ${W}u; const PLANE: u32 = ${P}u;
@group(0) @binding(0) var<uniform> cfg: Cfg;
@group(0) @binding(1) var<storage, read> netOut: array<T>;
@group(0) @binding(2) var<storage, read_write> acc: array<f32>;
fn mapCoord(v: i32, lim: u32, flip: u32) -> u32 {
  if (flip == 0u) { return u32(v); }
  var s = i32(lim) - 2 - v;
  if (s < 0) { s += 6; }
  return u32(s);
}
@compute @workgroup_size(16, 16, 1)
fn accum(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= cfg.vw || id.y >= cfg.vh) { return; }
  let sx = mapCoord(i32(id.x), cfg.vw, cfg.fx);
  let sy = mapCoord(i32(id.y), cfg.vh, cfg.fy);
  let dst = id.y * WIN + id.x; let src = sy * WIN + sx;
  for (var c = 0u; c < 3u; c++) {
    let v = f32(netOut[c * PLANE + src]) * cfg.weight;
    acc[c * PLANE + dst] = select(acc[c * PLANE + dst] + v, v, cfg.clear != 0u);
  }
}`;

  const finCode = /* wgsl */ `${hdr}
struct Cfg { vw: u32, vh: u32, fx: u32, fy: u32, weight: f32, clear: u32, p0: u32, p1: u32 }
const WIN: u32 = ${W}u; const PLANE: u32 = ${P}u;
@group(0) @binding(0) var<uniform> cfg: Cfg;
@group(0) @binding(1) var<storage, read> acc: array<f32>;
@group(0) @binding(2) var<storage, read_write> netOut: array<T>;
@compute @workgroup_size(16, 16, 1)
fn finish(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= cfg.vw || id.y >= cfg.vh) { return; }
  let p = id.y * WIN + id.x;
  for (var c = 0u; c < 3u; c++) { netOut[c * PLANE + p] = T(acc[c * PLANE + p]); }
}`;

  const mk = (/** @type {string} */ src, /** @type {string} */ ep) => device.createComputePipelineAsync({ layout: 'auto', compute: { module: device.createShaderModule({ code: src }), entryPoint: ep } });
  const [flipIn, accum, finish] = await Promise.all([mk(code, 'flipIn'), mk(accCode, 'accum'), mk(finCode, 'finish')]);
  return { flipIn, accum, finish };
}

/** Lazily-backed TTA pass wrapper around any inner network pass list.
 * @param {GPUDevice} device @param {import('./neural.js').Graph} g
 * @param {Awaited<ReturnType<typeof compileTta>>} pipes @param {GPUBuffer[]} bufs */
export function ttaRunner(device, g, pipes, bufs) {
  const wide = g.kind === 'f16' ? 2 : 4, planeBytes = g.win * g.win * wide;
  let bakMos = /** @type {GPUBuffer | null} */ (null);
  let bakSig = /** @type {GPUBuffer | null} */ (null);
  let accBuf = /** @type {GPUBuffer | null} */ (null);
  /** @type {Map<GPUBuffer, { cfgs: GPUBuffer[], bgSave: GPUBindGroup, bgFlip: GPUBindGroup[], bgRest: GPUBindGroup, bgAcc: GPUBindGroup[], bgFin: GPUBindGroup }>} */
  const slots = new Map();
  const grp = (/** @type {GPUComputePipeline} */ p, /** @type {GPUBindGroupEntry[]} */ e) => device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: e });

  const ensure = (/** @type {GPUBuffer} */ key) => {
    if (!bakMos) {
      bakMos = device.createBuffer({ size: planeBytes, usage: GPUBufferUsage.STORAGE });
      bakSig = device.createBuffer({ size: planeBytes, usage: GPUBufferUsage.STORAGE });
      accBuf = device.createBuffer({ size: 3 * g.win * g.win * 4, usage: GPUBufferUsage.STORAGE });
    }
    let s = slots.get(key);
    if (s) return s;
    const cfgs = Array.from({ length: 6 }, () => device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    // cfgs[0]=save/id, cfgs[1..3]=flips, cfgs[4]=restore, cfgs[5]=finish (reuses cfgs[0] for accum 0)
    const bgSave = grp(pipes.flipIn, [{ binding: 0, resource: { buffer: cfgs[0] } }, { binding: 1, resource: { buffer: bufs[g.mosaic] } }, { binding: 2, resource: { buffer: bufs[g.sigma] } }, { binding: 3, resource: { buffer: /** @type {GPUBuffer} */ (bakMos) } }, { binding: 4, resource: { buffer: /** @type {GPUBuffer} */ (bakSig) } }]);
    const bgFlip = [1, 2, 3].map((k) => grp(pipes.flipIn, [{ binding: 0, resource: { buffer: cfgs[k] } }, { binding: 1, resource: { buffer: /** @type {GPUBuffer} */ (bakMos) } }, { binding: 2, resource: { buffer: /** @type {GPUBuffer} */ (bakSig) } }, { binding: 3, resource: { buffer: bufs[g.mosaic] } }, { binding: 4, resource: { buffer: bufs[g.sigma] } }]));
    const bgRest = grp(pipes.flipIn, [{ binding: 0, resource: { buffer: cfgs[4] } }, { binding: 1, resource: { buffer: /** @type {GPUBuffer} */ (bakMos) } }, { binding: 2, resource: { buffer: /** @type {GPUBuffer} */ (bakSig) } }, { binding: 3, resource: { buffer: bufs[g.mosaic] } }, { binding: 4, resource: { buffer: bufs[g.sigma] } }]);
    const bgAcc = [0, 1, 2, 3].map((k) => grp(pipes.accum, [{ binding: 0, resource: { buffer: cfgs[k] } }, { binding: 1, resource: { buffer: bufs[g.output] } }, { binding: 2, resource: { buffer: /** @type {GPUBuffer} */ (accBuf) } }]));
    const bgFin = grp(pipes.finish, [{ binding: 0, resource: { buffer: cfgs[4] } }, { binding: 1, resource: { buffer: /** @type {GPUBuffer} */ (accBuf) } }, { binding: 2, resource: { buffer: bufs[g.output] } }]);
    s = { cfgs, bgSave, bgFlip, bgRest, bgAcc, bgFin };
    slots.set(key, s);
    return s;
  };

  const FLIPS = [[0, 0], [1, 0], [0, 1], [1, 1]];
  /** Wraps `netPasses` with 2x or 4x D4 symmetry TTA.
   * @param {GPUBuffer} key @param {number} vw @param {number} vh @param {number} tta
   * @param {[GPUComputePipeline, GPUBindGroup, number, number, number, boolean?, number?][]} netPasses */
  const wrap = (key, vw, vh, tta, netPasses) => {
    const n = tta >= 4 ? 4 : 2, w = 1 / n, s = ensure(key), gx = Math.ceil(vw / 16), gy = Math.ceil(vh / 16);
    const write = (/** @type {GPUBuffer} */ b, /** @type {number} */ fx, /** @type {number} */ fy, /** @type {number} */ clear) => {
      const ab = new ArrayBuffer(32), u = new Uint32Array(ab), f = new Float32Array(ab);
      u[0] = vw; u[1] = vh; u[2] = fx; u[3] = fy; f[4] = w; u[5] = clear;
      device.queue.writeBuffer(b, 0, ab);
    };
    write(s.cfgs[0], 0, 0, 1);
    for (let k = 1; k < n; k++) write(s.cfgs[k], FLIPS[k][0], FLIPS[k][1], 0);
    write(s.cfgs[4], 0, 0, 0);
    /** @type {[GPUComputePipeline, GPUBindGroup, number, number, number, boolean?, number?][]} */
    const out = [[pipes.flipIn, s.bgSave, gx, gy, 1, false, 0]];
    for (let k = 0; k < n; k++) {
      if (k > 0) out.push([pipes.flipIn, s.bgFlip[k - 1], gx, gy, 1, false, 0]);
      out.push(...netPasses);
      out.push([pipes.accum, s.bgAcc[k], gx, gy, 1, false, 13]);
    }
    out.push([pipes.flipIn, s.bgRest, gx, gy, 1, false, 13], [pipes.finish, s.bgFin, gx, gy, 1, false, 13]);
    return out;
  };
  return {
    wrap,
    destroy: () => {
      bakMos?.destroy(); bakSig?.destroy(); accBuf?.destroy();
      for (const s of slots.values()) for (const b of s.cfgs) b.destroy();
      slots.clear();
    },
  };
}
