// @ts-check
// The network's middle passes written other ways (net-tune.js measures them; neural.js runs the ones a phone has
// chosen). The passes as exported (nets/starfish-xtrans/) stage each tile's input and weights in the workgroup's own
// memory before multiplying: on a desktop GPU that memory is fast and the staging pays. A phone's GPU (Arm's Mali)
// has no such memory, the workgroup's is the same RAM as any buffer, and Arm's own advice is that copying into it is
// wasted work. Each way here reads its input and weights where they lie, with the same sums in the same order as the
// exported pass, behind the exported pass's own head (its constants, bindings, load and store): four pixels and
// eight outputs to an invocation, as exported; for a 3 x 3 pass also four pixels and sixteen outputs; one pixel and
// thirty-two outputs; and, since the owner's phone found the wider ones slower (2026-11-14), the four pixels of a
// 2 x 2 block, whose neighbourhood is read once, with eight outputs and with four.

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

// a 3 x 3 pass, one pixel and thirty-two outputs to an invocation: each input read feeds four times the sums, and
// the pixels of a workgroup lie together (the exported pass's are four rows apart, as its staging wanted)
const MAIN3P = /* wgsl */ `
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
    if ((g.x / TX) * TX >= valid_w() || (g.y / TY) * TY >= valid_h()) { return; }
    let x = i32(g.x);
    let y = i32(g.y);
    if (x >= W || y >= H) { return; }
    let ob = g.z * 4u;
    let next = CINP * KK * 2u;
    let o0 = PWOFF + ob * next;
    let o1 = PWOFF + min(ob + 1u, NOB - 1u) * next;
    let o2 = PWOFF + min(ob + 2u, NOB - 1u) * next;
    let o3 = PWOFF + min(ob + 3u, NOB - 1u) * next;
    var acc: array<vec4<A>, 8>;
    var t = 0u;
    for (var c = 0u; c < CIN; c++) {
        for (var ky = 0; ky < i32(K); ky++) {
            for (var kx = 0; kx < i32(K); kx++) {
                let v = A(load(c, y + ky - R, x + kx - R));
                acc[0] += v * vec4<A>(pw[o0 + t]); acc[1] += v * vec4<A>(pw[o0 + t + 1u]);
                acc[2] += v * vec4<A>(pw[o1 + t]); acc[3] += v * vec4<A>(pw[o1 + t + 1u]);
                acc[4] += v * vec4<A>(pw[o2 + t]); acc[5] += v * vec4<A>(pw[o2 + t + 1u]);
                acc[6] += v * vec4<A>(pw[o3 + t]); acc[7] += v * vec4<A>(pw[o3 + t + 1u]);
                t += 2u;
            }
        }
    }
    for (var b = 0u; b < 4u; b++) {
        if (ob + b >= NOB) { break; }
        let bo = PWOFF + NOB * next + (ob + b) * 2u;
        store((ob + b) * 8u, y, x, acc[2u * b] + vec4<A>(pw[bo]));
        store((ob + b) * 8u + 4u, y, x, acc[2u * b + 1u] + vec4<A>(pw[bo + 1u]));
    }
}
`;
// a 1 x 1 pass, one pixel and all thirty-two outputs of its group to an invocation
const MAIN1P = /* wgsl */ `
@compute @workgroup_size(16, 4, 1)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
    let p0 = (wg.y * NGX + wg.x) * NP;
    let py = p0 / W;
    let px0 = p0 % W;
    if (py >= valid_h() || (px0 >= valid_w() && (px0 + NP <= W || py + 1u >= valid_h()))) { return; }
    let og = wg.z;
    let px = p0 + li;
    var acc: array<vec4<A>, 8>;
    var wt = PWOFF + og * CINP * 8u;
    for (var c = 0u; c < CIN; c++) {
        let v = A(load(c, px));
        for (var q = 0u; q < 8u; q++) { acc[q] += v * vec4<A>(pw[wt + q]); }
        wt += 8u;
    }
    let bo = PWOFF + NOG * CINP * 8u + og * 8u;
    for (var q = 0u; q < 8u; q++) { store(og * OCW + 4u * q, px, acc[q] + vec4<A>(pw[bo + q])); }
}
`;

// a 3 x 3 pass, the four pixels of a 2 x 2 block and eight outputs to an invocation: the block's 4 x 4 neighbourhood
// is read once a channel (sixteen reads where four pixels apart take thirty-six), each pixel's sums still in the
// exported order
const MAIN3B = /* wgsl */ `
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) l: vec3<u32>) {
    if (wg.x * TX >= valid_w() || wg.y * TY >= valid_h()) { return; }
    let x = i32(wg.x * TX + 2u * l.x); let y = i32(wg.y * TY + 2u * l.y);
    if (x >= W || y >= H) { return; }
    let ob = wg.z;
    var a: array<vec4<A>, 8>;
    var n: array<A, 16>;
    var wt = PWOFF + ob * CINP * KK * 2u;
    for (var c = 0u; c < CIN; c++) {
        for (var j = 0; j < 4; j++) {
            for (var i = 0; i < 4; i++) { n[j * 4 + i] = A(load(c, y + j - R, x + i - R)); }
        }
        for (var ky = 0u; ky < K; ky++) {
            for (var kx = 0u; kx < K; kx++) {
                let w0 = vec4<A>(pw[wt]);
                let w1 = vec4<A>(pw[wt + 1u]);
                wt += 2u;
                let t = ky * 4u + kx;
                a[0] += n[t] * w0;      a[1] += n[t] * w1;
                a[2] += n[t + 1u] * w0; a[3] += n[t + 1u] * w1;
                a[4] += n[t + 4u] * w0; a[5] += n[t + 4u] * w1;
                a[6] += n[t + 5u] * w0; a[7] += n[t + 5u] * w1;
            }
        }
    }
    let bo = PWOFF + NOB * CINP * KK * 2u + ob * 2u;
    let b0 = vec4<A>(pw[bo]);
    let b1 = vec4<A>(pw[bo + 1u]);
    for (var p = 0u; p < 4u; p++) {
        let px = x + i32(p % 2u); let py = y + i32(p / 2u);
        if (px >= W || py >= H) { continue; }
        store(ob * 8u, py, px, a[2u * p] + b0);
        store(ob * 8u + 4u, py, px, a[2u * p + 1u] + b1);
    }
}
`;
// the same 2 x 2 block with four outputs to an invocation: half the sums held at once, twice the dispatches
const MAIN3N = /* wgsl */ `
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) l: vec3<u32>) {
    if (wg.x * TX >= valid_w() || wg.y * TY >= valid_h()) { return; }
    let x = i32(wg.x * TX + 2u * l.x); let y = i32(wg.y * TY + 2u * l.y);
    if (x >= W || y >= H) { return; }
    let ob = wg.z / 2u;
    let hh = wg.z % 2u;
    var a: array<vec4<A>, 4>;
    var n: array<A, 16>;
    var wt = PWOFF + ob * CINP * KK * 2u + hh;
    for (var c = 0u; c < CIN; c++) {
        for (var j = 0; j < 4; j++) {
            for (var i = 0; i < 4; i++) { n[j * 4 + i] = A(load(c, y + j - R, x + i - R)); }
        }
        for (var ky = 0u; ky < K; ky++) {
            for (var kx = 0u; kx < K; kx++) {
                let w0 = vec4<A>(pw[wt]);
                wt += 2u;
                let t = ky * 4u + kx;
                a[0] += n[t] * w0;
                a[1] += n[t + 1u] * w0;
                a[2] += n[t + 4u] * w0;
                a[3] += n[t + 5u] * w0;
            }
        }
    }
    let b0 = vec4<A>(pw[PWOFF + NOB * CINP * KK * 2u + ob * 2u + hh]);
    for (var p = 0u; p < 4u; p++) {
        let px = x + i32(p % 2u); let py = y + i32(p / 2u);
        if (px >= W || py >= H) { continue; }
        store(ob * 8u + 4u * hh, py, px, a[p] + b0);
    }
}
`;

/** @typedef {{ code: string, groups: number[] }} Way a pass written another way, and the workgroups it is dispatched over */
/** The other ways a pass is written here, each in its own place whatever the pass (a way is numbered from 1 by its
 * place; 0 is the pass as exported): first read in place (`MAIN3`, `MAIN1`), second sixteen outputs to an
 * invocation (`MAIN3W`: a 3 x 3 pass with an even number of output blocks only), third one pixel with thirty-two
 * outputs (`MAIN3P`, `MAIN1P`), fourth a 2 x 2 block of pixels with eight outputs (`MAIN3B`), fifth that with four
 * (`MAIN3N`): the last two for a 3 x 3 pass only. A place a pass has no way for is null. None at all for a pass
 * that stages nothing (the first and the last), or one of a shape not known here.
 * @param {{ code: string, groups: number[] }} o the pass as exported @returns {(Way | null)[]} */
export function ways(o) {
  const at = o.code.indexOf('@compute');
  if (at < 0 || !/^var<workgroup>/m.test(o.code) || !/@workgroup_size\(16, 4, 1\)/.test(o.code)) return [];
  const head = o.code.slice(0, at).replace(/^var<workgroup>.*\n/gm, ''), has = (/** @type {string[]} */ ...names) => names.every((n) => new RegExp(`\\bconst ${n}\\b`).test(head));
  const [gx, gy, gz] = o.groups, way = (/** @type {string} */ main, groups = o.groups) => ({ code: head + main, groups });
  if (has('KK', 'NOB', 'TX', 'TY')) return [way(MAIN3), gz % 2 ? null : way(MAIN3W, [gx, gy, gz / 2]), way(MAIN3P, [gx * 2, gy * 2, Math.ceil(gz / 4)]), way(MAIN3B), way(MAIN3N, [gx, gy, gz * 2])];
  if (has('NGX', 'NOG', 'OCW', 'NP')) return [way(MAIN1), null, way(MAIN1P), null, null];
  return [];
}
/** How many other ways any pass has at most. */
export const WAYS = 5;
