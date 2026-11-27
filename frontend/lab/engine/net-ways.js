// @ts-check
// The network's middle passes written other ways (net-tune.js measures them; neural.js runs what a phone chooses).
// The passes as exported (nets/starfish-xtrans/, Starfish v0.2.0) stage each tile's input and weights in workgroup
// memory before multiplying. On mobile GPUs without dedicated shared SRAM (Mali), staging into workgroup memory
// copies through main RAM. Each way here reads directly where the buffers lie, computing the exact same sums in
// the exact same order behind the exported pass's own head (constants, bindings, load and store).

import { sliced } from './net-pace.js';

// Way 1: read in place, PY rows 4 apart and NV output vec4s per invocation (same dispatch as exported).
const MAIN3 = /* wgsl */ `
@compute @workgroup_size(16, 4, 1)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) l: vec3<u32>) {
    if (wg.x * TX >= valid_w() || wg.y * TY >= valid_h()) { return; }
    let x = i32(wg.x * TX + l.x);
    let y0 = i32(wg.y * TY + l.y);
    if (x >= W) { return; }
    let ob = wg.z;
    var acc: array<vec4<A>, PY * NV>;
    var wt = PWOFF + ob * CINP * KK * NV;
    for (var c = 0u; c < CIN; c++) {
        for (var ky = 0; ky < i32(K); ky++) {
            for (var kx = 0; kx < i32(K); kx++) {
                let gx = x + kx - R;
                let gy = y0 + ky - R;
                for (var p = 0u; p < PY; p++) {
                    let v = A(load(c, gy + i32(4u * p), gx));
                    for (var h = 0u; h < NV; h++) {
                        acc[p * NV + h] += v * vec4<A>(pw[wt + h]);
                    }
                }
                wt += NV;
            }
        }
    }
    for (var p = 0u; p < PY; p++) {
        let y = y0 + i32(4u * p);
        if (y >= H) { continue; }
        for (var h = 0u; h < NV; h++) {
            let oc0 = ob * OCB + 4u * h;
            let bo = PWOFF + NOB * CINP * KK * NV + oc0 / 4u;
            store(oc0, y, x, acc[p * NV + h] + vec4<A>(pw[bo]));
        }
    }
}
`;

// Way 2: read in place, half the output vec4s (NV / 2) per invocation to cut register pressure on mobile GPUs.
const MAIN3H = /* wgsl */ `
@compute @workgroup_size(16, 4, 1)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) l: vec3<u32>) {
    if (wg.x * TX >= valid_w() || wg.y * TY >= valid_h()) { return; }
    let x = i32(wg.x * TX + l.x);
    let y0 = i32(wg.y * TY + l.y);
    if (x >= W) { return; }
    let ob = wg.z / 2u;
    let h0 = (wg.z % 2u) * (NV / 2u);
    var acc: array<vec4<A>, PY * (NV / 2u)>;
    var wt = PWOFF + ob * CINP * KK * NV + h0;
    for (var c = 0u; c < CIN; c++) {
        for (var ky = 0; ky < i32(K); ky++) {
            for (var kx = 0; kx < i32(K); kx++) {
                let gx = x + kx - R;
                let gy = y0 + ky - R;
                for (var p = 0u; p < PY; p++) {
                    let v = A(load(c, gy + i32(4u * p), gx));
                    for (var h = 0u; h < NV / 2u; h++) {
                        acc[p * (NV / 2u) + h] += v * vec4<A>(pw[wt + h]);
                    }
                }
                wt += NV;
            }
        }
    }
    for (var p = 0u; p < PY; p++) {
        let y = y0 + i32(4u * p);
        if (y >= H) { continue; }
        for (var h = 0u; h < NV / 2u; h++) {
            let oc0 = ob * OCB + 4u * (h0 + h);
            let bo = PWOFF + NOB * CINP * KK * NV + oc0 / 4u;
            store(oc0, y, x, acc[p * (NV / 2u) + h] + vec4<A>(pw[bo]));
        }
    }
}
`;

// Way 3: one pixel and all NV output vec4s per invocation, contiguous 8x8 workgroup tiles.
const MAIN3P = /* wgsl */ `
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
    if (g.x >= valid_w() || g.y >= valid_h()) { return; }
    let x = i32(g.x);
    let y = i32(g.y);
    if (x >= W || y >= H) { return; }
    let ob = g.z;
    var acc: array<vec4<A>, NV>;
    var wt = PWOFF + ob * CINP * KK * NV;
    for (var c = 0u; c < CIN; c++) {
        for (var ky = 0; ky < i32(K); ky++) {
            for (var kx = 0; kx < i32(K); kx++) {
                let v = A(load(c, y + ky - R, x + kx - R));
                for (var h = 0u; h < NV; h++) {
                    acc[h] += v * vec4<A>(pw[wt + h]);
                }
                wt += NV;
            }
        }
    }
    for (var h = 0u; h < NV; h++) {
        let oc0 = ob * OCB + 4u * h;
        let bo = PWOFF + NOB * CINP * KK * NV + oc0 / 4u;
        store(oc0, y, x, acc[h] + vec4<A>(pw[bo]));
    }
}
`;

// Way 4: a 2 x 2 pixel block (4 x 4 neighbourhood loaded once per channel) and eight outputs (2 vec4s) per invocation.
const MAIN3B = /* wgsl */ `
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) l: vec3<u32>) {
    if (wg.x * 16u >= valid_w() || wg.y * 16u >= valid_h()) { return; }
    let x = i32(wg.x * 16u + 2u * l.x); let y = i32(wg.y * 16u + 2u * l.y);
    if (x >= W || y >= H) { return; }
    let pairs = NV / 2u;
    let ob = wg.z / pairs;
    let h0 = (wg.z % pairs) * 2u;
    var a: array<vec4<A>, 8>;
    var n: array<A, 16>;
    var wt = PWOFF + ob * CINP * KK * NV + h0;
    for (var c = 0u; c < CIN; c++) {
        for (var j = 0; j < 4; j++) {
            for (var i = 0; i < 4; i++) { n[j * 4 + i] = A(load(c, y + j - R, x + i - R)); }
        }
        for (var ky = 0u; ky < K; ky++) {
            for (var kx = 0u; kx < K; kx++) {
                let w0 = vec4<A>(pw[wt]);
                let w1 = vec4<A>(pw[wt + 1u]);
                wt += NV;
                let t = ky * 4u + kx;
                a[0] += n[t] * w0;      a[1] += n[t] * w1;
                a[2] += n[t + 1u] * w0; a[3] += n[t + 1u] * w1;
                a[4] += n[t + 4u] * w0; a[5] += n[t + 4u] * w1;
                a[6] += n[t + 5u] * w0; a[7] += n[t + 5u] * w1;
            }
        }
    }
    let bo = PWOFF + NOB * CINP * KK * NV + ob * NV + h0;
    let b0 = vec4<A>(pw[bo]);
    let b1 = vec4<A>(pw[bo + 1u]);
    for (var p = 0u; p < 4u; p++) {
        let px = x + i32(p % 2u); let py = y + i32(p / 2u);
        if (px >= W || py >= H) { continue; }
        store(ob * OCB + 4u * h0, py, px, a[2u * p] + b0);
        store(ob * OCB + 4u * (h0 + 1u), py, px, a[2u * p + 1u] + b1);
    }
}
`;

// Way 5: the same 2 x 2 pixel block with four outputs (1 vec4) per invocation: minimum register count.
const MAIN3N = /* wgsl */ `
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) l: vec3<u32>) {
    if (wg.x * 16u >= valid_w() || wg.y * 16u >= valid_h()) { return; }
    let x = i32(wg.x * 16u + 2u * l.x); let y = i32(wg.y * 16u + 2u * l.y);
    if (x >= W || y >= H) { return; }
    let ob = wg.z / NV;
    let hh = wg.z % NV;
    var a: array<vec4<A>, 4>;
    var n: array<A, 16>;
    var wt = PWOFF + ob * CINP * KK * NV + hh;
    for (var c = 0u; c < CIN; c++) {
        for (var j = 0; j < 4; j++) {
            for (var i = 0; i < 4; i++) { n[j * 4 + i] = A(load(c, y + j - R, x + i - R)); }
        }
        for (var ky = 0u; ky < K; ky++) {
            for (var kx = 0u; kx < K; kx++) {
                let w0 = vec4<A>(pw[wt]);
                wt += NV;
                let t = ky * 4u + kx;
                a[0] += n[t] * w0;
                a[1] += n[t + 1u] * w0;
                a[2] += n[t + 4u] * w0;
                a[3] += n[t + 5u] * w0;
            }
        }
    }
    let b0 = vec4<A>(pw[PWOFF + NOB * CINP * KK * NV + ob * NV + hh]);
    for (var p = 0u; p < 4u; p++) {
        let px = x + i32(p % 2u); let py = y + i32(p / 2u);
        if (px >= W || py >= H) { continue; }
        store(ob * OCB + 4u * hh, py, px, a[p] + b0);
    }
}
`;

/** @typedef {{ code: string, groups: number[] }} Way a pass written another way, and the workgroups it is dispatched over */
/** The other ways a pass is written here, each in its own place (numbered 1..5; 0 is exported):
 * 1: read in place (`MAIN3`), 2: half output block (`MAIN3H`), 3: one pixel x OCB (`MAIN3P`),
 * 4: 2x2 block x 8 outputs (`MAIN3B`), 5: 2x2 block x 4 outputs (`MAIN3N`).
 * @param {{ code: string, groups: number[] }} o the pass as exported @returns {(Way | null)[]} */
export function ways(o) {
  const at = o.code.indexOf('@compute');
  if (at < 0 || !/^var<workgroup>/m.test(o.code) || !/@workgroup_size\(16, 4, 1\)/.test(o.code)) return [];
  const head = o.code.slice(0, at).replace(/^var<workgroup>.*\n/gm, '');
  const has = (/** @type {string[]} */ ...names) => names.every((n) => new RegExp(`\\bconst ${n}\\b`).test(head));
  const num = (/** @type {string} */ n) => Number(new RegExp(`const ${n}: \\w+ = (\\d+)u?;`).exec(head)?.[1]) || 0;
  const [gx, gy, gz] = o.groups;
  const way = (/** @type {string} */ main, groups = o.groups) => ({ code: sliced(head + main), groups });
  if (has('KK', 'NOB', 'TX', 'TY', 'PY', 'OCB', 'NV')) {
    const W = num('W') || gx * 16, H = num('H') || gy * 12, nv = (num('OCB') || 32) / 4;
    const gx8 = Math.ceil(W / 8), gy8 = Math.ceil(H / 8), gx16 = Math.ceil(W / 16), gy16 = Math.ceil(H / 16);
    return [
      way(MAIN3),
      nv >= 2 ? way(MAIN3H, [gx, gy, gz * 2]) : null,
      way(MAIN3P, [gx8, gy8, gz]),
      nv >= 2 ? way(MAIN3B, [gx16, gy16, gz * (nv / 2)]) : null,
      way(MAIN3N, [gx16, gy16, gz * nv]),
    ];
  }
  return [];
}
/** How many other ways any pass has at most. */
export const WAYS = 5;
