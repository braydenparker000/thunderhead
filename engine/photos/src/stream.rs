//! Streaming mode for RAF: the mosaic (~78 MiB of u16 at 40 MP) is never held whole. The working copy is
//! built from sensor columns band by band as LightCraft's patched decoder hands them over (one 768-px stripe
//! for compressed files, 256-px bands for uncompressed), kept in one rolling buffer with an 8 px margin; a
//! tile decodes only the stripes under it. Stripes decode as many at a time as there are threads (`columns`).

use crate::kernel::{Kernel, MARGIN, Src};
use lightcraft_raw::{self as raw, RawImage, Rect};
use rayon::prelude::*;

/// Sensor columns `[x0, x1)` handed to `sink(band_x0, band_width, samples)` stripe by stripe from left to right (full
/// height, row-major), the stripes decoded in parallel batches of one per thread.
fn columns(bytes: &[u8], x0: usize, x1: usize, sink: &mut dyn FnMut(usize, usize, &[u16])) -> Result<(), String> {
    let st = raw::raf_stripes(bytes).map_err(|e| e.to_string())?;
    let todo: Vec<usize> = (0..st.len()).filter(|&i| st.columns(i).0 < x1 && st.columns(i).0 + st.columns(i).1 > x0).collect();
    for group in todo.chunks(rayon::current_num_threads().max(1)) {
        let bands: Vec<Result<Vec<u16>, String>> = group
            .par_iter()
            .map(|&i| {
                let mut v = Vec::with_capacity(st.columns(i).1 * st.height);
                st.decode_rows(i, &mut |_, rows| v.extend_from_slice(rows)).map_err(|e| e.to_string())?;
                v.resize(st.columns(i).1 * st.height, 0);
                Ok(v)
            })
            .collect();
        for (&i, b) in group.iter().zip(bands) {
            let (bx, bw) = st.columns(i);
            sink(bx, bw, &b?);
        }
    }
    Ok(())
}

/// The working copy at `1/s` of `c`, `w2` wide, handed to `emit(ox0, width, planes)` band by band (planar f16).
pub(crate) fn working(bytes: &[u8], img: &RawImage, k: &Kernel, c: Rect, emit: &mut dyn FnMut(usize, usize, &[u16])) -> Result<(), String> {
    let (s, w2, a) = (k.s, k.w2, img.active_area);
    // rolling buffer of full-height active-area columns [b0, b0 + bw)
    let (mut buf, mut b0, mut bw, mut done) = (Vec::<u16>::new(), 0usize, 0usize, 0usize);
    let need_end = (c.x + w2 * s + MARGIN).min(a.width);
    let sx0 = a.x + c.x.saturating_sub(MARGIN);
    let mut err = None;
    columns(bytes, sx0, a.x + need_end, &mut |bx, bwid, data| {
        // the band's columns inside the active area, appended to the rolling buffer
        let (ax0, ax1) = (bx.saturating_sub(a.x).max(b0 + bw), (bx + bwid).saturating_sub(a.x).min(a.width));
        if ax1 <= ax0 {
            return;
        }
        let keep_from = (c.x + done * s).saturating_sub(MARGIN).max(b0);
        let (off, kept) = (keep_from - b0, b0 + bw - keep_from);
        let nw = kept + (ax1 - ax0);
        // re-stride in place (rows from the bottom up when growing, so no unread row is overwritten)
        if buf.capacity() == 0 {
            buf.reserve_exact((2 * MARGIN + bwid + 8) * a.height);
        }
        let row_at = |buf: &mut Vec<u16>, y: usize| {
            buf.copy_within(y * bw + off..y * bw + off + kept, y * nw);
            let row = (a.y + y) * bwid;
            buf[y * nw + kept..y * nw + nw].copy_from_slice(&data[row + a.x + ax0 - bx..row + a.x + ax1 - bx]);
        };
        if nw >= bw {
            buf.resize(nw * a.height, 0);
            for y in (0..a.height).rev() {
                row_at(&mut buf, y);
            }
        } else {
            for y in 0..a.height {
                row_at(&mut buf, y);
            }
            buf.truncate(nw * a.height);
        }
        (b0, bw) = (keep_from, nw);
        let last = b0 + bw >= need_end;
        let limit = if last { c.x + w2 * s } else { b0 + bw - MARGIN };
        let mut ox1 = done;
        while ox1 < w2 && c.x + (ox1 + 1) * s <= limit {
            ox1 += 1;
        }
        if ox1 > done {
            let src = Src::Band { data: &buf, x0: b0, w: bw, y0: 0, h: a.height };
            let mut band = Vec::new();
            if band.try_reserve_exact(3 * (ox1 - done) * k.h2).is_err() {
                err = Some("out of memory for a band".to_string());
                return;
            }
            band.resize(3 * (ox1 - done) * k.h2, 0);
            k.produce(&src, img, done, ox1, &mut band, ox1 - done);
            emit(done, ox1 - done, &band);
            done = ox1;
        }
    })?;
    err.map_or(Ok(()), Err)
}

/// A full-resolution tile at active-area `(fx, fy)`, `w × h`: only the stripes under it are decoded.
pub(crate) fn tile(bytes: &[u8], img: &RawImage, k: &Kernel, fx: usize, fy: usize, out: &mut [u16]) -> Result<(), String> {
    let (a, w, h) = (img.active_area, k.w2, k.h2);
    let (wx0, wx1) = (fx.saturating_sub(MARGIN), (fx + w + MARGIN).min(a.width));
    let (wy0, wy1) = (fy.saturating_sub(MARGIN), (fy + h + MARGIN).min(a.height));
    let (ww, wh) = (wx1 - wx0, wy1 - wy0);
    let mut buf = vec![0u16; ww * wh];
    columns(bytes, a.x + wx0, a.x + wx1, &mut |bx, bwid, data| {
        for ay in wy0..wy1 {
            let (ax0, ax1) = (bx.saturating_sub(a.x).max(wx0), (bx + bwid).saturating_sub(a.x).min(wx1));
            if ax1 > ax0 {
                let row = (a.y + ay) * bwid + a.x;
                buf[(ay - wy0) * ww + ax0 - wx0..(ay - wy0) * ww + ax1 - wx0].copy_from_slice(&data[row + ax0 - bx..row + ax1 - bx]);
            }
        }
    })?;
    k.produce(&Src::Band { data: &buf, x0: wx0, w: ww, y0: wy0, h: wh }, img, 0, w, out, w);
    Ok(())
}
