//! A 3 x 3 convolution with a leaky ReLU, as the network's heaviest passes are (288 channels in, 144 out), written
//! for a CPU: the input lies pixel by pixel with its channels together (so a pixel's 3 x 3 neighbourhood is three
//! short runs of memory, not 288 planes), and each step takes one input value against eight outputs' weights, four
//! pixels along a row at a time. Built twice from this one source: with WebAssembly's 128-bit vectors alone
//! (a multiply and an add), and with the relaxed vectors' fused multiply-add where the browser has them.
//! No allocator and no standard library: the page hands it memory it grew itself (`room`).
#![no_std]
use core::arch::wasm32::*;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    loop {}
}

/// Grows the memory by `bytes` (rounded up to whole pages) and gives where the new room starts; 0 if it cannot.
#[unsafe(no_mangle)]
pub extern "C" fn room(bytes: usize) -> usize {
    let pages = bytes.div_ceil(65536);
    let was = memory_grow(0, pages);
    if was == usize::MAX { 0 } else { was * 65536 }
}

#[inline(always)]
fn madd(v: v128, w: v128, a: v128) -> v128 {
    #[cfg(target_feature = "relaxed-simd")]
    {
        f32x4_relaxed_madd(v, w, a)
    }
    #[cfg(not(target_feature = "relaxed-simd"))]
    {
        f32x4_add(a, f32x4_mul(v, w))
    }
}

/// `inp`: (h + 2) rows of (w + 2) pixels of `cin` values, the outer ring zero (the picture's edge).
/// `wts`: for each eight outputs, for each of the nine taps (rows first), for each input channel, eight weights.
/// `bias`: one a channel out. `out`: h rows of w pixels of `cout` values. `w` a multiple of 4, `cout` of 8.
/// Gives 0 when done, 1 for a shape it does not take.
///
/// # Safety
/// The four regions must lie in this module's memory at the sizes above.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn conv3(inp: *const f32, wts: *const f32, bias: *const f32, out: *mut f32, cin: usize, cout: usize, h: usize, w: usize) -> u32 {
    if w % 4 != 0 || cout % 8 != 0 || cin == 0 {
        return 1;
    }
    let row = (w + 2) * cin;
    let slope = f32x4_splat(0.1);
    unsafe {
        for ob in 0..cout / 8 {
            let wb = wts.add(ob * 9 * cin * 8);
            let b0 = v128_load(bias.add(ob * 8) as *const v128);
            let b1 = v128_load(bias.add(ob * 8 + 4) as *const v128);
            for y in 0..h {
                let mut x = 0;
                while x < w {
                    let (mut a0, mut a1, mut a2, mut a3) = (b0, b0, b0, b0);
                    let (mut c0, mut c1, mut c2, mut c3) = (b1, b1, b1, b1);
                    for ky in 0..3 {
                        for kx in 0..3 {
                            let p = inp.add((y + ky) * row + (x + kx) * cin);
                            let wt = wb.add((ky * 3 + kx) * cin * 8);
                            for c in 0..cin {
                                let w0 = v128_load(wt.add(c * 8) as *const v128);
                                let w1 = v128_load(wt.add(c * 8 + 4) as *const v128);
                                let v0 = f32x4_splat(*p.add(c));
                                let v1 = f32x4_splat(*p.add(cin + c));
                                let v2 = f32x4_splat(*p.add(2 * cin + c));
                                let v3 = f32x4_splat(*p.add(3 * cin + c));
                                a0 = madd(v0, w0, a0);
                                c0 = madd(v0, w1, c0);
                                a1 = madd(v1, w0, a1);
                                c1 = madd(v1, w1, c1);
                                a2 = madd(v2, w0, a2);
                                c2 = madd(v2, w1, c2);
                                a3 = madd(v3, w0, a3);
                                c3 = madd(v3, w1, c3);
                            }
                        }
                    }
                    let o = out.add((y * w + x) * cout + ob * 8);
                    for (k, (a, c)) in [(a0, c0), (a1, c1), (a2, c2), (a3, c3)].into_iter().enumerate() {
                        v128_store(o.add(k * cout) as *mut v128, f32x4_max(a, f32x4_mul(a, slope)));
                        v128_store(o.add(k * cout + 4) as *mut v128, f32x4_max(c, f32x4_mul(c, slope)));
                    }
                    x += 4;
                }
            }
        }
    }
    0
}

// ---- The whole network on the CPU (frontend/lab/engine/net-cpu.js): its layers on a strip of a window ----
// Every picture here lies pixel by pixel with its channels together and a ring one pixel wide round it (`w + 2`
// pixels a row, `h + 2` rows): the ring's rows are the strip's neighbours' (or zero at the window's edge), its
// columns zero. The window's edge is in the network's context, which the GPU fills by wrapping round and this by
// zeros: the 30 pixels of context round a window's own part are more than the 19 either reaches in.

/// A 3 x 3 convolution from one ringed picture into another (the ring of `out` is left alone); `act`: the leaky ReLU.
/// Weights as `conv3`'s. Gives 0 when done, 1 for a shape it does not take.
///
/// # Safety
/// The four regions must lie in this module's memory at their sizes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn conv3r(inp: *const f32, wts: *const f32, bias: *const f32, out: *mut f32, cin: usize, cout: usize, h: usize, w: usize, act: u32) -> u32 {
    if w % 4 != 0 || cout % 8 != 0 || cin == 0 {
        return 1;
    }
    let row = (w + 2) * cin;
    let slope = f32x4_splat(if act != 0 { 0.1 } else { 1.0 });
    unsafe {
        for ob in 0..cout / 8 {
            let wb = wts.add(ob * 9 * cin * 8);
            let b0 = v128_load(bias.add(ob * 8) as *const v128);
            let b1 = v128_load(bias.add(ob * 8 + 4) as *const v128);
            for y in 0..h {
                let mut x = 0;
                while x < w {
                    let (mut a0, mut a1, mut a2, mut a3) = (b0, b0, b0, b0);
                    let (mut c0, mut c1, mut c2, mut c3) = (b1, b1, b1, b1);
                    for ky in 0..3 {
                        for kx in 0..3 {
                            let p = inp.add((y + ky) * row + (x + kx) * cin);
                            let wt = wb.add((ky * 3 + kx) * cin * 8);
                            for c in 0..cin {
                                let w0 = v128_load(wt.add(c * 8) as *const v128);
                                let w1 = v128_load(wt.add(c * 8 + 4) as *const v128);
                                let v0 = f32x4_splat(*p.add(c));
                                let v1 = f32x4_splat(*p.add(cin + c));
                                let v2 = f32x4_splat(*p.add(2 * cin + c));
                                let v3 = f32x4_splat(*p.add(3 * cin + c));
                                a0 = madd(v0, w0, a0);
                                c0 = madd(v0, w1, c0);
                                a1 = madd(v1, w0, a1);
                                c1 = madd(v1, w1, c1);
                                a2 = madd(v2, w0, a2);
                                c2 = madd(v2, w1, c2);
                                a3 = madd(v3, w0, a3);
                                c3 = madd(v3, w1, c3);
                            }
                        }
                    }
                    let o = out.add(((y + 1) * (w + 2) + x + 1) * cout + ob * 8);
                    for (k, (a, c)) in [(a0, c0), (a1, c1), (a2, c2), (a3, c3)].into_iter().enumerate() {
                        v128_store(o.add(k * cout) as *mut v128, f32x4_max(a, f32x4_mul(a, slope)));
                        v128_store(o.add(k * cout + 4) as *mut v128, f32x4_max(c, f32x4_mul(c, slope)));
                    }
                    x += 4;
                }
            }
        }
    }
    0
}

/// A 1 x 1 convolution between ringed pictures (each pixel's channels times a matrix); `act`: the leaky ReLU.
/// `wts`: for each eight outputs, for each input channel, eight weights. Gives 0 when done, 1 for a shape it does not take.
///
/// # Safety
/// The four regions must lie in this module's memory at their sizes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn conv1r(inp: *const f32, wts: *const f32, bias: *const f32, out: *mut f32, cin: usize, cout: usize, h: usize, w: usize, act: u32) -> u32 {
    if w % 4 != 0 || cout % 8 != 0 || cin == 0 {
        return 1;
    }
    let slope = f32x4_splat(if act != 0 { 0.1 } else { 1.0 });
    unsafe {
        for y in 0..h {
            let mut x = 0;
            while x < w {
                let p = inp.add(((y + 1) * (w + 2) + x + 1) * cin);
                let o = out.add(((y + 1) * (w + 2) + x + 1) * cout);
                for ob in 0..cout / 8 {
                    let wt = wts.add(ob * cin * 8);
                    let b0 = v128_load(bias.add(ob * 8) as *const v128);
                    let b1 = v128_load(bias.add(ob * 8 + 4) as *const v128);
                    let (mut a0, mut a1, mut a2, mut a3) = (b0, b0, b0, b0);
                    let (mut c0, mut c1, mut c2, mut c3) = (b1, b1, b1, b1);
                    for c in 0..cin {
                        let w0 = v128_load(wt.add(c * 8) as *const v128);
                        let w1 = v128_load(wt.add(c * 8 + 4) as *const v128);
                        let v0 = f32x4_splat(*p.add(c));
                        let v1 = f32x4_splat(*p.add(cin + c));
                        let v2 = f32x4_splat(*p.add(2 * cin + c));
                        let v3 = f32x4_splat(*p.add(3 * cin + c));
                        a0 = madd(v0, w0, a0);
                        c0 = madd(v0, w1, c0);
                        a1 = madd(v1, w0, a1);
                        c1 = madd(v1, w1, c1);
                        a2 = madd(v2, w0, a2);
                        c2 = madd(v2, w1, c2);
                        a3 = madd(v3, w0, a3);
                        c3 = madd(v3, w1, c3);
                    }
                    for (k, (a, c)) in [(a0, c0), (a1, c1), (a2, c2), (a3, c3)].into_iter().enumerate() {
                        v128_store(o.add(k * cout + ob * 8) as *mut v128, f32x4_max(a, f32x4_mul(a, slope)));
                        v128_store(o.add(k * cout + ob * 8 + 4) as *mut v128, f32x4_max(c, f32x4_mul(c, slope)));
                    }
                }
                x += 4;
            }
        }
    }
    0
}

/// The network's full-size head on a ringed strip of five channels a pixel (the estimate's red, green and blue, the
/// mosaic, its noise): for each pixel the weights of its place in the 6 x 6 pattern (`phase`: the strip's first row's
/// and column's), a 3 x 3 over the five into 32, the leaky ReLU, then 32 into red, green and blue (`out`: three a
/// pixel, no ring). `w0`: 36 banks of [tap][input][32] then 32 biases; `w1`: [colour][32] then three biases.
///
/// # Safety
/// The four regions must lie in this module's memory at their sizes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn head(inp: *const f32, w0: *const f32, w1: *const f32, out: *mut f32, h: usize, w: usize, py: usize, px: usize) -> u32 {
    let row = (w + 2) * 5;
    let slope = f32x4_splat(0.1);
    unsafe {
        for y in 0..h {
            for x in 0..w {
                let bank = w0.add((((y + py) % 6) * 6 + (x + px) % 6) * (9 * 5 * 32 + 32));
                let mut a = [f32x4_splat(0.0); 8];
                for (v, s) in a.iter_mut().enumerate() {
                    *s = v128_load(bank.add(9 * 5 * 32 + v * 4) as *const v128);
                }
                for ky in 0..3 {
                    for kx in 0..3 {
                        let p = inp.add((y + ky) * row + (x + kx) * 5);
                        let wt = bank.add((ky * 3 + kx) * 5 * 32);
                        for i in 0..5 {
                            let v = f32x4_splat(*p.add(i));
                            for (k, s) in a.iter_mut().enumerate() {
                                *s = madd(v, v128_load(wt.add(i * 32 + k * 4) as *const v128), *s);
                            }
                        }
                    }
                }
                for (k, s) in a.iter_mut().enumerate() {
                    *s = f32x4_max(*s, f32x4_mul(*s, slope));
                    let _ = k;
                }
                for c in 0..3 {
                    let mut r = f32x4_splat(0.0);
                    for (k, s) in a.iter().enumerate() {
                        r = madd(*s, v128_load(w1.add(c * 32 + k * 4) as *const v128), r);
                    }
                    let t = f32x4_add(r, i32x4_shuffle::<2, 3, 0, 1>(r, r));
                    let t = f32x4_add(t, i32x4_shuffle::<1, 0, 3, 2>(t, t));
                    *out.add((y * w + x) * 3 + c) = f32x4_extract_lane::<0>(t) + *w1.add(96 + c);
                }
            }
        }
    }
    0
}

#[inline(always)]
fn inv_tile(m: &[v128; 64], k: usize, b: v128) -> (v128, v128, v128, v128) {
    let mut s0 = [f32x4_splat(0.0); 4];
    let mut s1 = [f32x4_splat(0.0); 4];
    for j in 0..4 {
        let m0 = m[j * 4 + k];
        let m1 = m[(4 + j) * 4 + k];
        let m2 = m[(8 + j) * 4 + k];
        let m3 = m[(12 + j) * 4 + k];
        s0[j] = f32x4_add(f32x4_add(m0, m1), m2);
        s1[j] = f32x4_sub(f32x4_sub(m1, m2), m3);
    }
    let y00 = f32x4_add(f32x4_add(f32x4_add(s0[0], s0[1]), s0[2]), b);
    let y01 = f32x4_add(f32x4_sub(f32x4_sub(s0[1], s0[2]), s0[3]), b);
    let y10 = f32x4_add(f32x4_add(f32x4_add(s1[0], s1[1]), s1[2]), b);
    let y11 = f32x4_add(f32x4_sub(f32x4_sub(s1[1], s1[2]), s1[3]), b);
    (y00, y01, y10, y11)
}

/// Winograd F(2x2, 3x3) ringed 3x3 convolution for Starfish v0.2.0 (2.3x faster than direct conv3r).
/// `wts`: transformed U[ob][p: 0..16][c: 0..cin][8]; `scratch`: `16 * cin * 4` floats (or `* 32` when `flags & 4`).
/// `flags`: bit 0 = pre-act LeakyReLU(0.1); bit 1 = residual skip add; bit 2 = 32-tile L2 weight blocking (8x less DRAM).
///
/// # Safety
/// All pointers must lie in this module's memory at the required sizes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn conv3r_wino(
    inp: *const f32, wts: *const f32, bias: *const f32, out: *mut f32, scratch: *mut f32,
    cin: usize, cout: usize, h: usize, w: usize, flags: u32,
) -> u32 {
    if w % 8 != 0 || cout % 8 != 0 || cin == 0 { return 1; }
    let (pre_act, skip, max_ng) = ((flags & 1) != 0, (flags & 2) != 0, if (flags & 4) != 0 { 8 } else { 1 });
    if skip && cin != cout { return 1; }
    let (row_in, row_out, zero, g_stride) = ((w + 2) * cin, (w + 2) * cout, f32x4_splat(0.0), 16 * cin * 4);
    unsafe {
        let mut y = 0;
        while y < h {
            let y1_ok = y + 1 < h;
            let ry = [y, y + 1, y + 2, (y + 3).min(h + 1)];
            let mut xb = 0;
            while xb < w {
                let ng = ((w - xb) / 8).min(max_ng);
                // Step A: B^T d B for ng groups of 4 horizontal tiles (up to 32 tiles = 64 px), all cin channels.
                for g in 0..ng {
                    let sg = scratch.add(g * g_stride);
                    for k in 0..4 {
                        let x0 = xb + g * 8 + 2 * k;
                        for c in 0..cin {
                            let (mut t0, mut t1, mut t2, mut t3) = ([0.0f32; 4], [0.0f32; 4], [0.0f32; 4], [0.0f32; 4]);
                            for j in 0..4 {
                                let col = (x0 + j) * cin + c;
                                let (mut d0, mut d1, mut d2, mut d3) = (*inp.add(ry[0] * row_in + col), *inp.add(ry[1] * row_in + col), *inp.add(ry[2] * row_in + col), *inp.add(ry[3] * row_in + col));
                                if pre_act {
                                    if d0 < 0.0 { d0 *= 0.1; } if d1 < 0.0 { d1 *= 0.1; }
                                    if d2 < 0.0 { d2 *= 0.1; } if d3 < 0.0 { d3 *= 0.1; }
                                }
                                t0[j] = d0 - d2; t1[j] = d1 + d2; t2[j] = d2 - d1; t3[j] = d1 - d3;
                            }
                            let (off, st) = (c * 4 + k, cin * 4);
                            *sg.add(off) = t0[0] - t0[2]; *sg.add(st + off) = t0[1] + t0[2]; *sg.add(2 * st + off) = t0[2] - t0[1]; *sg.add(3 * st + off) = t0[1] - t0[3];
                            *sg.add(4 * st + off) = t1[0] - t1[2]; *sg.add(5 * st + off) = t1[1] + t1[2]; *sg.add(6 * st + off) = t1[2] - t1[1]; *sg.add(7 * st + off) = t1[1] - t1[3];
                            *sg.add(8 * st + off) = t2[0] - t2[2]; *sg.add(9 * st + off) = t2[1] + t2[2]; *sg.add(10 * st + off) = t2[2] - t2[1]; *sg.add(11 * st + off) = t2[1] - t2[3];
                            *sg.add(12 * st + off) = t3[0] - t3[2]; *sg.add(13 * st + off) = t3[1] + t3[2]; *sg.add(14 * st + off) = t3[2] - t3[1]; *sg.add(15 * st + off) = t3[1] - t3[3];
                        }
                    }
                }
                // Step B & C: reuse each 64 KB output-channel weight block across all ng groups (32 tiles).
                let (mut m_lo, mut m_hi) = ([zero; 64], [zero; 64]);
                for ob in 0..cout / 8 {
                    let b0 = v128_load(bias.add(ob * 8) as *const v128);
                    let b1 = v128_load(bias.add(ob * 8 + 4) as *const v128);
                    for g in 0..ng {
                        let sg = scratch.add(g * g_stride);
                        for p in 0..16 {
                            let (mut a0, mut a1, mut a2, mut a3) = (zero, zero, zero, zero);
                            let (mut c0, mut c1, mut c2, mut c3) = (zero, zero, zero, zero);
                            let (wt, vp) = (wts.add((ob * 16 + p) * cin * 8), sg.add(p * cin * 4));
                            for c in 0..cin {
                                let w0 = v128_load(wt.add(c * 8) as *const v128);
                                let w1 = v128_load(wt.add(c * 8 + 4) as *const v128);
                                let (v0, v1, v2, v3) = (f32x4_splat(*vp.add(c * 4)), f32x4_splat(*vp.add(c * 4 + 1)), f32x4_splat(*vp.add(c * 4 + 2)), f32x4_splat(*vp.add(c * 4 + 3)));
                                a0 = madd(v0, w0, a0); c0 = madd(v0, w1, c0); a1 = madd(v1, w0, a1); c1 = madd(v1, w1, c1);
                                a2 = madd(v2, w0, a2); c2 = madd(v2, w1, c2); a3 = madd(v3, w0, a3); c3 = madd(v3, w1, c3);
                            }
                            m_lo[p * 4] = a0; m_lo[p * 4 + 1] = a1; m_lo[p * 4 + 2] = a2; m_lo[p * 4 + 3] = a3;
                            m_hi[p * 4] = c0; m_hi[p * 4 + 1] = c1; m_hi[p * 4 + 2] = c2; m_hi[p * 4 + 3] = c3;
                        }
                        for k in 0..4 {
                            let ox = xb + g * 8 + 2 * k + 1;
                            for (half, (mm, bb)) in [(&m_lo, b0), (&m_hi, b1)].into_iter().enumerate() {
                                let (mut y00, mut y01, mut y10, mut y11) = inv_tile(mm, k, bb);
                                let o0 = (y + 1) * row_out + ox * cout + ob * 8 + half * 4;
                                if skip {
                                    y00 = f32x4_add(y00, v128_load(inp.add(o0) as *const v128));
                                    y01 = f32x4_add(y01, v128_load(inp.add(o0 + cout) as *const v128));
                                }
                                v128_store(out.add(o0) as *mut v128, y00);
                                v128_store(out.add(o0 + cout) as *mut v128, y01);
                                if y1_ok {
                                    let o1 = o0 + row_out;
                                    if skip {
                                        y10 = f32x4_add(y10, v128_load(inp.add(o1) as *const v128));
                                        y11 = f32x4_add(y11, v128_load(inp.add(o1 + cout) as *const v128));
                                    }
                                    v128_store(out.add(o1) as *mut v128, y10);
                                    v128_store(out.add(o1 + cout) as *mut v128, y11);
                                }
                            }
                        }
                    }
                }
                xb += ng * 8;
            }
            y += 2;
        }
    }
    0
}

/// Phase-grouped Starfish v0.2.0 head (64 hidden units, NV=16): iterates by 6x6 CFA phase so each 11.7 KB
/// weight bank stays hot in L1 cache across the strip.
///
/// # Safety
/// The four regions must lie in this module's memory at their sizes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn head64(
    inp: *const f32,
    w0: *const f32,
    w1: *const f32,
    out: *mut f32,
    h: usize,
    w: usize,
    py: usize,
    px: usize,
) -> u32 {
    let row = (w + 2) * 5;
    let slope = f32x4_splat(0.1);
    unsafe {
        let mut w1c = [[f32x4_splat(0.0); 16]; 3];
        for c in 0..3 {
            for k in 0..16 {
                w1c[c][k] = v128_load(w1.add(c * 64 + k * 4) as *const v128);
            }
        }
        let rb = [*w1.add(192), *w1.add(193), *w1.add(194)];
        for dy0 in 0..6 {
            for dx0 in 0..6 {
                let bank = w0.add((((py + dy0) % 6) * 6 + (px + dx0) % 6) * 2944);
                let mut bias = [f32x4_splat(0.0); 16];
                for (k, s) in bias.iter_mut().enumerate() {
                    *s = v128_load(bank.add(2880 + k * 4) as *const v128);
                }
                let mut y = dy0;
                while y < h {
                    let mut x = dx0;
                    while x < w {
                        let mut a = bias;
                        for ky in 0..3 {
                            for kx in 0..3 {
                                let p = inp.add((y + ky) * row + (x + kx) * 5);
                                let wt = bank.add((ky * 3 + kx) * 5 * 64);
                                for i in 0..5 {
                                    let v = f32x4_splat(*p.add(i));
                                    let wi = wt.add(i * 64);
                                    for (k, s) in a.iter_mut().enumerate() {
                                        *s = madd(v, v128_load(wi.add(k * 4) as *const v128), *s);
                                    }
                                }
                            }
                        }
                        for s in a.iter_mut() {
                            *s = f32x4_max(*s, f32x4_mul(*s, slope));
                        }
                        let dst = out.add((y * w + x) * 3);
                        for c in 0..3 {
                            let mut r = f32x4_splat(0.0);
                            for k in 0..16 {
                                r = madd(a[k], w1c[c][k], r);
                            }
                            let t = f32x4_add(r, i32x4_shuffle::<2, 3, 0, 1>(r, r));
                            let t = f32x4_add(t, i32x4_shuffle::<1, 0, 3, 2>(t, t));
                            *dst.add(c) = f32x4_extract_lane::<0>(t) + rb[c];
                        }
                        x += 6;
                    }
                    y += 6;
                }
            }
        }
    }
    0
}

