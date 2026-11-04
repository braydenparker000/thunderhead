//! The pixel kernel: camera RGB → white balance → linear Rec.2020, and LightCraft's own demosaic run on a
//! window of the mosaic (plus a margin), so neither the working copy nor a tile ever needs the whole image as
//! floats (~460 MiB at 40 MP).

use half::f16;
use lightcraft_raw::{self as raw, Method, Normalized, RawData, RawImage, Rect};

/// Demosaic margin around a window: the X-Trans interpolation reads a 5×5 neighbourhood.
pub(crate) const MARGIN: usize = 8;
/// Output pixels per side of a demosaic block (2D blocks keep the f32 temporaries ~7 MiB).
const BLOCK_OUT: usize = 128;

/// Camera RGB (1.0 = white) → white balance, clip, → linear Rec.2020.
#[inline]
pub(crate) fn to_working(m: &[[f32; 3]; 3], wb: &[f32; 3], c: [f32; 3]) -> [f32; 3] {
    // the simplest highlight handling: clip each balanced channel at white so clipped areas stay neutral
    let b = [(c[0] * wb[0]).min(1.0), (c[1] * wb[1]).min(1.0), (c[2] * wb[2]).min(1.0)];
    [
        m[0][0] * b[0] + m[0][1] * b[1] + m[0][2] * b[2],
        m[1][0] * b[0] + m[1][1] * b[1] + m[1][2] * b[2],
        m[2][0] * b[0] + m[2][1] * b[1] + m[2][2] * b[2],
    ]
}

/// Where mosaic samples come from, in active-area coordinates: the whole decoded mosaic, or a decoded band.
pub(crate) enum Src<'a> {
    Raw(&'a RawImage),
    Band { data: &'a [u16], x0: usize, w: usize, y0: usize, h: usize },
}

impl Src<'_> {
    /// Active-area columns and rows this source holds.
    fn bounds(&self, a: Rect) -> (usize, usize, usize, usize) {
        match self {
            Src::Raw(_) => (0, a.width, 0, a.height),
            Src::Band { x0, w, y0, h, .. } => (*x0, x0 + w, *y0, y0 + h),
        }
    }
    #[inline]
    fn get(&self, a: Rect, ax: usize, ay: usize) -> f32 {
        match self {
            Src::Raw(r) => match &r.data {
                RawData::U16(d) => d[(a.y + ay) * r.width + a.x + ax] as f32,
                RawData::F32(d) => d[(a.y + ay) * r.width + a.x + ax],
            },
            Src::Band { data, x0, w, y0, .. } => data[(ay - y0) * w + ax - x0] as f32,
        }
    }
}

/// Builds working-copy pixels from any [`Src`].
pub(crate) struct Kernel {
    pub(crate) matrix: [[f32; 3]; 3],
    pub(crate) wb: [f32; 3],
    pub(crate) crop: Rect,
    pub(crate) s: usize,
    pub(crate) w2: usize,
    pub(crate) h2: usize,
}

impl Kernel {
    /// Output columns `[ox0, ox1)` of every row, in blocks of `BLOCK_OUT`² output pixels.
    pub(crate) fn produce(&self, src: &Src, meta: &RawImage, ox0: usize, ox1: usize, out: &mut [u16]) {
        let (s, w2, h2, c) = (self.s, self.w2, self.h2, self.crop);
        let plane = w2 * h2;
        let inv = 1.0 / (s * s) as f32;
        for oy in (0..h2).step_by(BLOCK_OUT) {
            for ox in (ox0..ox1).step_by(BLOCK_OUT) {
                let (rows, cols) = (BLOCK_OUT.min(h2 - oy), BLOCK_OUT.min(ox1 - ox));
                let (dx, dy, rgb) = demosaic_window(src, meta, c.x + ox * s, c.y + oy * s, cols * s, rows * s);
                for y in 0..rows {
                    for x in 0..cols {
                        let mut acc = [0f32; 3];
                        for by in 0..s {
                            let row = (dy + y * s + by) * rgb.width + dx + x * s;
                            for px in &rgb.data[row..row + s] {
                                acc[0] += px[0];
                                acc[1] += px[1];
                                acc[2] += px[2];
                            }
                        }
                        let v = to_working(&self.matrix, &self.wb, [acc[0] * inv, acc[1] * inv, acc[2] * inv]);
                        let i = (oy + y) * w2 + ox + x;
                        out[i] = f16::from_f32(v[0]).to_bits();
                        out[plane + i] = f16::from_f32(v[1]).to_bits();
                        out[2 * plane + i] = f16::from_f32(v[2]).to_bits();
                    }
                }
            }
        }
    }
}

/// Black-subtract and white-scale the active-area window `(x, y, w, h)` plus `MARGIN` (clamped to what `src`
/// holds), demosaic it with LightCraft's own demosaic (X-Trans: edge-weighted directional) and return the offset
/// of `(x, y)` inside the result. Equivalent to `RawImage::normalized` + `demosaic` restricted to a window, for
/// raws without DNG opcode lists (RAF has none).
pub(crate) fn demosaic_window(src: &Src, meta: &RawImage, x: usize, y: usize, w: usize, h: usize) -> (usize, usize, lightcraft_raster::Rgb32f) {
    let a = meta.active_area;
    let (sx0, sx1, sy0, sy1) = src.bounds(a);
    let x0 = x.saturating_sub(MARGIN).max(sx0);
    let y0 = y.saturating_sub(MARGIN).max(sy0);
    let x1 = (x + w + MARGIN).min(sx1);
    let y1 = (y + h + MARGIN).min(sy1);
    let (ww, wh) = (x1 - x0, y1 - y0);
    let range = meta.white_at(0) - meta.black.mean();
    let sc = if range > 0.0 { 1.0 / range } else { 1.0 };
    let mut data = Vec::with_capacity(ww * wh);
    for yy in y0..y1 {
        for xx in x0..x1 {
            let n = (src.get(a, xx, yy) - meta.black.at(xx, yy, 0, 1)) * sc;
            data.push(if n.is_finite() { n } else { 0.0 });
        }
    }
    let cfa = meta.cfa.as_ref().map(|c| c.shifted(a.x + x0, a.y + y0));
    let n = Normalized { width: ww, height: wh, cpp: 1, data, cfa };
    let rgb = raw::demosaic(&n, Method::Ahd);
    (x - x0, y - y0, rgb)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The windowed demosaic equals LightCraft's whole-image `normalized()` + `demosaic` on the same pixels.
    /// `PHOTOS_RAF=<file> cargo test --release -- --nocapture` (native; needs ~1 GB for the full-image reference).
    #[test]
    fn window_matches_full_demosaic() {
        let Ok(path) = std::env::var("PHOTOS_RAF") else { return };
        let bytes = std::fs::read(path).unwrap();
        let img = raw::decode(&bytes).unwrap();
        let full = raw::demosaic(&img.normalized().unwrap(), Method::Ahd);
        let a = img.active_area;
        let mut worst = 0f32;
        for &(x, y, w, h) in &[(0, 0, 300, 200), (3303, 2202, 1122, 748), (3060, 1000, 64, 64), (a.width - 500, a.height - 300, 500, 300)] {
            let (dx, dy, rgb) = demosaic_window(&Src::Raw(&img), &img, x, y, w, h);
            for ty in 0..h {
                for tx in 0..w {
                    let p = rgb.data[(dy + ty) * rgb.width + dx + tx];
                    let q = full.data[(y + ty) * full.width + x + tx];
                    for c in 0..3 {
                        worst = worst.max((p[c] - q[c]).abs());
                    }
                }
            }
        }
        println!("max abs difference window vs full demosaic: {worst:e}");
        assert_eq!(worst, 0.0);
    }
}
