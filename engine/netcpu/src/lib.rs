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
