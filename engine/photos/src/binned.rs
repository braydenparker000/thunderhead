//! The half-size first frame (PHOTOS.md, the two-stage decode): no demosaic. Each output pixel is, per colour, the
//! tent-weighted mean (1 2 2 1 on each axis) of the mosaic samples in the 4×4 window around its 2×2 block, the
//! window clamped to its stripe and the active area (any window of at least 2×4 samples of X-Trans or Bayer holds
//! all three colours). Stripes decode in parallel six rows at a time (LightCraft's `RafStripes`), one per thread, and
//! every `CHUNK` output rows go through a bounded channel to `emit` on the calling thread, so wasm holds the file and
//! a few small chunks, never a band or the whole copy.

use crate::kernel::{Kernel, to_working};
use half::f16;
use lightcraft_raw::{self as raw, Cfa, RafStripes, RawImage};

const TENT: [f32; 4] = [1.0, 2.0, 2.0, 1.0];
/// Output rows per chunk handed over (64 rows of a 384-column band: 144 KiB).
const CHUNK: usize = 64;

/// Output columns `[x, x + w)`, rows `[y, y + h)`: planar f16, `w × h` per plane.
pub(crate) struct Chunk {
    pub(crate) x: usize,
    pub(crate) y: usize,
    pub(crate) w: usize,
    pub(crate) h: usize,
    pub(crate) data: Vec<u16>,
}

/// The half-size working copy in chunks, in no particular order: `emit(chunk)` on the calling thread.
pub(crate) fn binned(bytes: &[u8], img: &RawImage, k: &Kernel, emit: &mut dyn FnMut(&Chunk)) -> Result<(), String> {
    let st = raw::raf_stripes(bytes).map_err(|e| e.to_string())?;
    let base = img.active_area.x + k.crop.x;
    // output column ox's block starts at raw column base + 2·ox and belongs to the stripe holding that column
    let first = |sx: usize| sx.saturating_sub(base).div_ceil(2).min(k.w2);
    let jobs: Vec<(usize, usize, usize)> = (0..st.len())
        .map(|i| {
            let (sx, sw) = st.columns(i);
            (i, first(sx), first(sx + sw))
        })
        .filter(|j| j.2 > j.1)
        .collect();
    let cfa = img.cfa.clone().ok_or("this raw has no colour filter pattern")?;
    let tables = Tables::new(&cfa);
    let threads = rayon::current_num_threads();
    if threads <= 1 {
        for &(i, o0, o1) in &jobs {
            Band::new(&st, img, k, &cfa, &tables, i, o0, o1).run(&mut |c| emit(&c))?;
        }
        return Ok(());
    }
    let (tx, rx) = std::sync::mpsc::sync_channel::<Result<Chunk, String>>(2 * threads);
    let (st, cfa, tables) = (&st, &cfa, &tables);
    let mut failed = None;
    rayon::in_place_scope(|scope| {
        for &(i, o0, o1) in &jobs {
            let tx = tx.clone();
            scope.spawn(move |_| {
                if let Err(e) = Band::new(st, img, k, cfa, tables, i, o0, o1).run(&mut |c| drop(tx.send(Ok(c)))) {
                    drop(tx.send(Err(e)));
                }
            });
        }
        drop(tx);
        for c in rx {
            match c {
                Ok(c) => emit(&c),
                Err(e) => {
                    failed.get_or_insert(e);
                }
            }
        }
    });
    failed.map_or(Ok(()), Err)
}

/// For an unclamped 4×4 window, per CFA phase of its top-left sample: the colour of each of the 16 samples and the
/// reciprocal of each colour's total weight.
struct Tables {
    colour: Vec<[u8; 16]>,
    inv: Vec<[f32; 3]>,
    cw: usize,
    ch: usize,
}

impl Tables {
    fn new(cfa: &Cfa) -> Tables {
        let (cw, ch) = (cfa.width.max(1), cfa.height.max(1));
        let (mut colour, mut inv) = (Vec::new(), Vec::new());
        for py in 0..ch {
            for px in 0..cw {
                let mut c = [0u8; 16];
                let mut w = [0f32; 3];
                for j in 0..16 {
                    c[j] = cfa.color_at(px + j % 4, py + j / 4).min(2);
                    w[c[j] as usize] += TENT[j % 4] * TENT[j / 4];
                }
                colour.push(c);
                inv.push(w.map(|v| if v > 0.0 { 1.0 / v } else { 0.0 }));
            }
        }
        Tables { colour, inv, cw, ch }
    }
}

/// One stripe's output columns `[o0, o1)`, built as its rows arrive.
struct Band<'a> {
    st: &'a RafStripes<'a>,
    img: &'a RawImage,
    k: &'a Kernel,
    cfa: &'a Cfa,
    t: &'a Tables,
    i: usize,
    o0: usize,
    o1: usize,
    sx: usize,
    sw: usize,
    /// rows `[r0, r0 + buf.len() / sw)` of the stripe
    buf: Vec<u16>,
    r0: usize,
    oy: usize,
    /// output rows `[y0, oy)` waiting in `out` (planes of `CHUNK × width`)
    y0: usize,
    out: Vec<u16>,
    /// clamp bounds in raw coordinates
    xlo: usize,
    xhi: usize,
    ylo: usize,
    yhi: usize,
    sc: f32,
    /// the black level when it is one number (else it is read per sample)
    flat: Option<f32>,
}

impl<'a> Band<'a> {
    #[allow(clippy::too_many_arguments)]
    fn new(st: &'a RafStripes<'a>, img: &'a RawImage, k: &'a Kernel, cfa: &'a Cfa, t: &'a Tables, i: usize, o0: usize, o1: usize) -> Self {
        let (sx, sw) = st.columns(i);
        let a = img.active_area;
        let range = img.white_at(0) - img.black.mean();
        let b = &img.black;
        let flat = (b.values.len() <= 1 && b.delta_h.is_empty() && b.delta_v.is_empty()).then(|| b.values.first().copied().unwrap_or(0.0));
        Band {
            st, img, k, cfa, t, i, o0, o1, sx, sw,
            buf: Vec::with_capacity(16 * sw),
            r0: 0,
            oy: 0,
            y0: 0,
            out: vec![0; 3 * (o1 - o0) * CHUNK],
            xlo: sx.max(a.x),
            xhi: (sx + sw).min(a.x + a.width),
            ylo: a.y,
            yhi: (a.y + a.height).min(st.height),
            sc: if range > 0.0 { 1.0 / range } else { 1.0 },
            flat,
        }
    }

    fn run(mut self, flush: &mut dyn FnMut(Chunk)) -> Result<(), String> {
        let (st, i) = (self.st, self.i);
        st.decode_rows(i, &mut |y0, rows| {
            if self.buf.is_empty() {
                self.r0 = y0;
            }
            self.buf.extend_from_slice(rows);
            self.rows(false, flush);
        })
        .map_err(|e| e.to_string())?;
        self.rows(true, flush);
        Ok(())
    }

    /// The rows waiting in `out` as one chunk.
    fn flush(&mut self, flush: &mut dyn FnMut(Chunk)) {
        let (w, h) = (self.o1 - self.o0, self.oy - self.y0);
        if h > 0 {
            let data = (0..3).flat_map(|p| self.out[p * w * CHUNK..p * w * CHUNK + w * h].iter().copied()).collect();
            flush(Chunk { x: self.o0, y: self.y0, w, h, data });
        }
        self.y0 = self.oy;
    }

    fn y_of(&self, oy: usize) -> usize {
        self.img.active_area.y + self.k.crop.y + 2 * oy
    }

    /// Every output row whose window rows have arrived (all that are left when `last`).
    fn rows(&mut self, last: bool, flush: &mut dyn FnMut(Chunk)) {
        let r1 = self.r0 + self.buf.len() / self.sw.max(1);
        while self.oy < self.k.h2 {
            let y = self.y_of(self.oy);
            let (wy0, wy1) = (y.saturating_sub(1).max(self.ylo).max(self.r0), (y + 3).min(self.yhi));
            if wy1 > r1 && !last {
                break;
            }
            for ox in self.o0..self.o1 {
                self.pixel(ox, y, wy0, wy1.min(r1));
            }
            self.oy += 1;
            if self.oy - self.y0 == CHUNK {
                self.flush(flush);
            }
            let keep = self.y_of(self.oy).saturating_sub(1).max(self.r0).min(r1);
            if keep > self.r0 {
                self.buf.drain(..(keep - self.r0) * self.sw);
                self.r0 = keep;
            }
        }
        if last {
            self.flush(flush);
        }
    }

    fn pixel(&mut self, ox: usize, y: usize, wy0: usize, wy1: usize) {
        let x = self.img.active_area.x + self.k.crop.x + 2 * ox;
        let (wx0, wx1) = (x.saturating_sub(1).max(self.xlo), (x + 3).min(self.xhi));
        let (mut acc, mut w) = ([0f32; 3], [0f32; 3]);
        let a = self.img.active_area;
        if let (Some(black), 4, 4, true) = (self.flat, wx1.saturating_sub(wx0), wy1.saturating_sub(wy0), x >= 1 && y >= 1) {
            let t = self.t;
            let phase = (wy0 % t.ch) * t.cw + wx0 % t.cw;
            let c = &t.colour[phase];
            for r in 0..4 {
                let row = &self.buf[(wy0 + r - self.r0) * self.sw + wx0 - self.sx..][..4];
                for q in 0..4 {
                    acc[c[r * 4 + q] as usize] += TENT[r] * TENT[q] * row[q] as f32;
                }
            }
            let inv = t.inv[phase];
            for j in 0..3 {
                (acc[j], w[j]) = ((acc[j] * inv[j] - black) * self.sc, if inv[j] > 0.0 { 1.0 } else { 0.0 });
            }
        } else {
            for yy in wy0..wy1 {
                let row = &self.buf[(yy - self.r0) * self.sw..];
                for xx in wx0..wx1 {
                    let wt = TENT[yy + 1 - y] * TENT[xx + 1 - x];
                    let col = self.cfa.color_at(xx, yy).min(2) as usize;
                    acc[col] += wt * (row[xx - self.sx] as f32 - self.img.black.at(xx - a.x, yy - a.y, 0, 1)) * self.sc;
                    w[col] += wt;
                }
            }
            for j in 0..3 {
                acc[j] = if w[j] > 0.0 { acc[j] / w[j] } else { 0.0 };
            }
        }
        // a colour missing from a clipped corner window takes green's value (neutral)
        let m = [0, 1, 2].map(|j| if w[j] > 0.0 { acc[j] } else { acc[1] });
        let v = to_working(&self.k.matrix, &self.k.wb, m);
        let plane = (self.o1 - self.o0) * CHUNK;
        let idx = (self.oy - self.y0) * (self.o1 - self.o0) + ox - self.o0;
        self.out[idx] = f16::from_f32(v[0]).to_bits();
        self.out[plane + idx] = f16::from_f32(v[1]).to_bits();
        self.out[2 * plane + idx] = f16::from_f32(v[2]).to_bits();
    }
}
