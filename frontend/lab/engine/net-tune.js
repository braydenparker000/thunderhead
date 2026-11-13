// @ts-check
// The network's passes tried another way on this GPU, and the faster kept (neural.js uses what is chosen here).
// The passes as exported (nets/starfish-xtrans/) stage each tile's input and weights in the workgroup's own memory
// before multiplying: on a desktop GPU that memory is fast and the staging pays. A phone's GPU (Arm's Mali) has no
// such memory, the workgroup's is the same RAM as any buffer, and Arm's own advice is that copying into it is
// wasted work. Whether that holds on a given phone is measured, not assumed: `ways` writes a pass that reads its
// input and weights where they lie, with the same sums in the same order (and, for the 3 × 3 passes, a second such
// way), and `tune` runs each pass every way on real data, checks the results agree, and times them. A pass is used
// another way only where that agreed and was clearly faster; the choice is kept on the phone (`chosen`), and
// neural.js still proves the whole network with it before using it.
const KEY = 'th.net.tune', V = 1;   // the kept choice; V: raised when `ways` changes, so an old choice is not used for new code

// a 3 × 3 pass (01, 04, 07): 16 × 4 invocations a 16 × 16 tile, each four pixels four rows apart and eight outputs
const MAIN3 = /* wgsl */ `
@compute @workgroup_size(16, 4, 1)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) l: vec3<u32>) {
    if (wg.x * TX >= valid_w() || wg.y * TY >= valid_h()) { return; }
    let x = i32(wg.x * TX + l.x);
    let y0 = i32(wg.y * TY + l.y);
    if (x >= W) { return; }
    let ob = wg.z;
    var a00 = vec4<A>(0); var a01 = vec4<A>(0);
    var a10 = vec4<A>(0); var a11 = vec4<A>(0);
    var a20 = vec4<A>(0); var a21 = vec4<A>(0);
    var a30 = vec4<A>(0); var a31 = vec4<A>(0);
    var wt = PWOFF + ob * CINP * KK * 2u;
    for (var c = 0u; c < CIN; c++) {
        for (var ky = 0; ky < i32(K); ky++) {
            for (var kx = 0; kx < i32(K); kx++) {
                let gx = x + kx - R;
                let gy = y0 + ky - R;
                let v0 = A(load(c, gy, gx));
                let v1 = A(load(c, gy + 4, gx));
                let v2 = A(load(c, gy + 8, gx));
                let v3 = A(load(c, gy + 12, gx));
                let w0 = vec4<A>(pw[wt]);
                let w1 = vec4<A>(pw[wt + 1u]);
                wt += 2u;
                a00 += v0 * w0; a01 += v0 * w1;
                a10 += v1 * w0; a11 += v1 * w1;
                a20 += v2 * w0; a21 += v2 * w1;
                a30 += v3 * w0; a31 += v3 * w1;
            }
        }
    }
    var accs = array<vec4<A>, 8>(a00, a01, a10, a11, a20, a21, a30, a31);
    for (var p = 0u; p < 4u; p++) {
        let y = y0 + i32(4u * p);
        if (y >= H) { continue; }
        for (var h = 0u; h < 2u; h++) {
            let oc0 = ob * 8u + 4u * h;
            let bo = PWOFF + NOB * CINP * KK * 2u + oc0 / 4u;
            store(oc0, y, x, accs[2u * p + h] + vec4<A>(pw[bo]));
        }
    }
}
`;
// a 1 × 1 pass (02, 03, 05, 06, 08, 09): 16 × 4 invocations 64 pixels along a row, each four pixels 16 apart and eight outputs
const MAIN1 = /* wgsl */ `
@compute @workgroup_size(16, 4, 1)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) l: vec3<u32>) {
    let p0 = (wg.y * NGX + wg.x) * NP;
    let py = p0 / W;
    let px0 = p0 % W;
    if (py >= valid_h() || (px0 >= valid_w() && (px0 + NP <= W || py + 1u >= valid_h()))) { return; }
    let og = wg.z;
    let wo = l.y * 2u;
    let px = p0 + l.x;
    var a00 = vec4<A>(0); var a01 = vec4<A>(0);
    var a10 = vec4<A>(0); var a11 = vec4<A>(0);
    var a20 = vec4<A>(0); var a21 = vec4<A>(0);
    var a30 = vec4<A>(0); var a31 = vec4<A>(0);
    var wt = PWOFF + og * CINP * 8u + wo;
    for (var c = 0u; c < CIN; c++) {
        let v0 = A(load(c, px));
        let v1 = A(load(c, px + 16u));
        let v2 = A(load(c, px + 32u));
        let v3 = A(load(c, px + 48u));
        let w0 = vec4<A>(pw[wt]);
        let w1 = vec4<A>(pw[wt + 1u]);
        wt += 8u;
        a00 += v0 * w0; a01 += v0 * w1;
        a10 += v1 * w0; a11 += v1 * w1;
        a20 += v2 * w0; a21 += v2 * w1;
        a30 += v3 * w0; a31 += v3 * w1;
    }
    let oc0 = og * OCW + l.y * 8u;
    let bo = PWOFF + NOG * CINP * 8u + oc0 / 4u;
    let b0 = vec4<A>(pw[bo]);
    let b1 = vec4<A>(pw[bo + 1u]);
    store(oc0, px, a00 + b0);       store(oc0 + 4u, px, a01 + b1);
    store(oc0, px + 16u, a10 + b0); store(oc0 + 4u, px + 16u, a11 + b1);
    store(oc0, px + 32u, a20 + b0); store(oc0 + 4u, px + 32u, a21 + b1);
    store(oc0, px + 48u, a30 + b0); store(oc0 + 4u, px + 48u, a31 + b1);
}
`;

// a 3 × 3 pass again, sixteen outputs to an invocation, not eight: half the dispatches, and each input read feeds
// twice the sums (the weights of the next eight outputs lie one block on)
const MAIN3W = /* wgsl */ `
@compute @workgroup_size(16, 4, 1)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) l: vec3<u32>) {
    if (wg.x * TX >= valid_w() || wg.y * TY >= valid_h()) { return; }
    let x = i32(wg.x * TX + l.x);
    let y0 = i32(wg.y * TY + l.y);
    if (x >= W) { return; }
    let ob = wg.z * 2u;
    let next = CINP * KK * 2u;
    var acc: array<vec4<A>, 16>;
    var wt = PWOFF + ob * next;
    for (var c = 0u; c < CIN; c++) {
        for (var ky = 0; ky < i32(K); ky++) {
            for (var kx = 0; kx < i32(K); kx++) {
                let gx = x + kx - R;
                let gy = y0 + ky - R;
                let v0 = A(load(c, gy, gx));
                let v1 = A(load(c, gy + 4, gx));
                let v2 = A(load(c, gy + 8, gx));
                let v3 = A(load(c, gy + 12, gx));
                let w0 = vec4<A>(pw[wt]);
                let w1 = vec4<A>(pw[wt + 1u]);
                let w2 = vec4<A>(pw[wt + next]);
                let w3 = vec4<A>(pw[wt + next + 1u]);
                wt += 2u;
                acc[0] += v0 * w0; acc[1] += v0 * w1; acc[2] += v0 * w2; acc[3] += v0 * w3;
                acc[4] += v1 * w0; acc[5] += v1 * w1; acc[6] += v1 * w2; acc[7] += v1 * w3;
                acc[8] += v2 * w0; acc[9] += v2 * w1; acc[10] += v2 * w2; acc[11] += v2 * w3;
                acc[12] += v3 * w0; acc[13] += v3 * w1; acc[14] += v3 * w2; acc[15] += v3 * w3;
            }
        }
    }
    for (var p = 0u; p < 4u; p++) {
        let y = y0 + i32(4u * p);
        if (y >= H) { continue; }
        for (var h = 0u; h < 4u; h++) {
            let oc0 = ob * 8u + 4u * h;
            let bo = PWOFF + NOB * next + oc0 / 4u;
            store(oc0, y, x, acc[4u * p + h] + vec4<A>(pw[bo]));
        }
    }
}
`;

/** @typedef {{ code: string, groups: number[] }} Way a pass written another way, and the workgroups it is dispatched over */
/** The other ways a pass is written here, in the order they are numbered from 1 (0 is the pass as exported): reading
 * its input and weights where they lie (`MAIN3`, `MAIN1`) and, for a 3 × 3 pass, that with sixteen outputs to an
 * invocation (`MAIN3W`). None for a pass that stages nothing (the first and the last), or one of a shape not known here.
 * @param {{ code: string, groups: number[] }} o the pass as exported @returns {Way[]} */
export function ways(o) {
  const at = o.code.indexOf('@compute');
  if (at < 0 || !/^var<workgroup>/m.test(o.code) || !/@workgroup_size\(16, 4, 1\)/.test(o.code)) return [];
  const head = o.code.slice(0, at).replace(/^var<workgroup>.*\n/gm, ''), has = (/** @type {string[]} */ ...names) => names.every((n) => new RegExp(`\\bconst ${n}\\b`).test(head));
  if (has('KK', 'NOB', 'TX')) return [{ code: head + MAIN3, groups: o.groups }, ...(o.groups[2] % 2 ? [] : [{ code: head + MAIN3W, groups: [o.groups[0], o.groups[1], o.groups[2] / 2] }])];
  if (has('NGX', 'NOG', 'OCW')) return [{ code: head + MAIN1, groups: o.groups }];
  return [];
}

/** Which way this phone runs each pass, as last chosen here for this kind of network: a number a pass, 0 as
 * exported, else one of `ways` (all 0 where none was chosen, or nothing can be kept). @param {string} kind
 * @param {number} count the network's passes @returns {number[]} */
export function chosen(kind, count) {
  const none = new Array(count).fill(0);
  try { const k = JSON.parse(localStorage.getItem(KEY) || 'null'); return k && k.v === V && k.kind === kind && Array.isArray(k.way) && k.way.length === count && k.way.every((/** @type {any} */ w) => Number.isInteger(w) && w >= 0 && w <= 2) ? k.way : none; } catch { return none; }
}
/** Keeps the choice (all as exported: forgets it). @param {string} kind @param {number[]} way */
export function choose(kind, way) { try { if (way.some(Boolean)) localStorage.setItem(KEY, JSON.stringify({ v: V, kind, way })); else localStorage.removeItem(KEY); } catch { /* nowhere to keep it: the passes run as exported */ } }

const SPOTS = 24, SPOT = 4096;   // where two results are compared: this many places, this many bytes at each
/** How much faster another way must be to be chosen: a tenth is within what one timing wanders by. */
export const CLEARLY = 0.85;
/** Runs the network's passes over the window already cut into its buffers, each as exported and each other way there
 * is, on the same input: how long each took, and whether its result agrees with the exported pass's. The last run of
 * each pass is one that agreed (or the exported pass again), so the window is still made right.
 * @param {GPUDevice} device @param {{ kind: string, ops: { code: string, binds: number[], groups: number[] }[], sizes: number[] }} g the network as exported
 * @param {GPUComputePipeline[]} pipes its passes @param {GPUBuffer[]} bufs @param {GPUBuffer} valid
 * @param {(h: number) => number} unhalf a half float's bits as a number
 * @returns {Promise<{ ms: number[], alt: number[][], way: number[] }>} `ms`: each pass as exported; `alt`: each other way's ms, a list a
 *   way and in it a number a pass (-1 where the pass has no such way, -2 where it disagreed); `way`: the fastest that agreed, 0 unless clearly faster */
export async function tune(device, g, pipes, bufs, valid, unhalf) {
  const wide = g.kind === 'f16' ? 2 : 4, ms = /** @type {number[]} */ ([]), alt = [/** @type {number[]} */ ([]), /** @type {number[]} */ ([])], way = /** @type {number[]} */ ([]);
  const back = device.createBuffer({ size: 2 * SPOTS * SPOT, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const run = async (/** @type {GPUComputePipeline} */ pipe, /** @type {typeof g.ops[number]} */ o, /** @type {number[]} */ groups, /** @type {number} */ half, /** @type {number} */ bytes) => {
    const enc = device.createCommandEncoder(), pass = enc.beginComputePass(), t = performance.now();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [...o.code.matchAll(/@binding\((\d)\)/g)].map((m) => +m[1]).map((b) => ({ binding: b, resource: { buffer: b === 5 ? valid : bufs[o.binds[b]] } })) }));
    pass.dispatchWorkgroups(groups[0], groups[1], groups[2]); pass.end();
    // a little of the result from places spread over it, to compare the ways by
    if (half >= 0) for (let k = 0; k < SPOTS; k++) enc.copyBufferToBuffer(bufs[o.binds[4]], Math.floor(((bytes - SPOT) * k) / (SPOTS - 1) / 4) * 4, back, (half * SPOTS + k) * SPOT, SPOT);
    device.queue.submit([enc.finish()]); await device.queue.onSubmittedWorkDone();
    return performance.now() - t;
  };
  try {
    for (const [j, o] of g.ops.entries()) {
      const others = ways(o), out = Number(/const COUT: u32 = (\d+)u/.exec(o.code)?.[1]) * 176 * 176 * wide, bytes = Math.min(g.sizes[o.binds[4]], out || Infinity), can = others.length > 0 && bytes > SPOT;
      ms.push(await run(pipes[j], o, o.groups, can ? 0 : -1, bytes));
      let best = 0, least = CLEARLY * ms[j], right = true;   // the output now holds a result that is right
      for (const [k, list] of alt.entries()) {
        const w = can ? others[k] : null, pipe = w && (await device.createComputePipelineAsync({ layout: 'auto', compute: { module: device.createShaderModule({ code: w.code }), entryPoint: 'main' } }).catch(() => null));
        if (!w) { list.push(-1); continue; }
        if (!pipe) { list.push(-2); continue; }
        const took = await run(pipe, o, w.groups, 1, bytes);
        await back.mapAsync(GPUMapMode.READ);
        const raw = back.getMappedRange(), n = (SPOTS * SPOT) / wide, a = wide === 2 ? new Uint16Array(raw, 0, n) : new Float32Array(raw, 0, n), b = wide === 2 ? new Uint16Array(raw, SPOTS * SPOT, n) : new Float32Array(raw, SPOTS * SPOT, n);
        let same = true, some = false;
        for (let i = 0; i < n && same; i++) { const p = wide === 2 ? unhalf(a[i]) : a[i], q = wide === 2 ? unhalf(b[i]) : b[i]; some ||= p !== 0; same = Math.abs(p - q) <= 0.02 + 0.02 * Math.abs(p); }   // (a NaN on either side is not the same)
        back.unmap();
        right = same && some; list.push(right ? took : -2);
        if (right && took < least) { best = k + 1; least = took; }
      }
      if (!right) await run(pipes[j], o, o.groups, -1, 0);
      way.push(best);
    }
  } finally { back.destroy(); }
  return { ms, alt, way };
}
