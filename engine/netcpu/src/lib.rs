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
