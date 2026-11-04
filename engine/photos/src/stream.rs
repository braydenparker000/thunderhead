//! Streaming mode for RAF: the mosaic (~78 MiB of u16 at 40 MP) is never held whole. The working copy is
//! built from sensor columns band by band as LightCraft's patched decoder hands them over (one 768-px stripe
//! for compressed files, 256-px bands for uncompressed), kept in one rolling buffer with an 8 px margin; a
//! tile decodes only the stripes under it.

use crate::kernel::{Kernel, MARGIN, Src};
use lightcraft_raw::{self as raw, RawImage, Rect};

/// Output columns of the working copy at `1/s` of `c`, `w2` wide, into `out` (planar f16).
pub(crate) fn working(bytes: &[u8], img: &RawImage, k: &Kernel, c: Rect, out: &mut [u16]) -> Result<(), String> {
    let (s, w2, a) = (k.s, k.w2, img.active_area);
    // rolling buffer of full-height active-area columns [b0, b0 + bw)
    let (mut buf, mut b0, mut bw, mut done) = (Vec::<u16>::new(), 0usize, 0usize, 0usize);
    let need_end = (c.x + w2 * s + MARGIN).min(a.width);
    let sx0 = a.x + c.x.saturating_sub(MARGIN);
    raw::raf_decode_columns(bytes, sx0, a.x + need_end, &mut |bx, bwid, data| {
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
            k.produce(&src, img, done, ox1, out);
            done = ox1;
        }
    })
    .map_err(|e| e.to_string())
}

/// A full-resolution tile at active-area `(fx, fy)`, `w × h`: only the stripes under it are decoded.
pub(crate) fn tile(bytes: &[u8], img: &RawImage, k: &Kernel, fx: usize, fy: usize, out: &mut [u16]) -> Result<(), String> {
    let (a, w, h) = (img.active_area, k.w2, k.h2);
    let (wx0, wx1) = (fx.saturating_sub(MARGIN), (fx + w + MARGIN).min(a.width));
    let (wy0, wy1) = (fy.saturating_sub(MARGIN), (fy + h + MARGIN).min(a.height));
    let (ww, wh) = (wx1 - wx0, wy1 - wy0);
    let mut buf = vec![0u16; ww * wh];
    raw::raf_decode_columns(bytes, a.x + wx0, a.x + wx1, &mut |bx, bwid, data| {
        for ay in wy0..wy1 {
            let (ax0, ax1) = (bx.saturating_sub(a.x).max(wx0), (bx + bwid).saturating_sub(a.x).min(wx1));
            if ax1 > ax0 {
                let row = (a.y + ay) * bwid + a.x;
                buf[(ay - wy0) * ww + ax0 - wx0..(ay - wy0) * ww + ax1 - wx0].copy_from_slice(&data[row + ax0 - bx..row + ax1 - bx]);
            }
        }
    })
    .map_err(|e| e.to_string())?;
    k.produce(&Src::Band { data: &buf, x0: wx0, w: ww, y0: wy0, h: wh }, img, 0, w, out);
    Ok(())
}
