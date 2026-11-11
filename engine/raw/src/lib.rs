//! The new photo engine's RAW stage (docs/engineering/ENGINE-RESEARCH.md). rawler opens the RAF (all
//! three Fujifilm encodings); this crate hands the browser the metadata the colour pipeline needs and the
//! editing proxy: each 3 x 3 cell of the X-Trans mosaic (2 x 2 for Bayer) averaged per colour into one
//! RGB pixel, black-subtracted and scaled to the white level, so the GPU starts from clean linear
//! camera RGB at about 2576 x 1717 for a 40 MP frame, with no demosaic needed. Each pixel also says which of
//! its colours had a clipped sensel, for the highlight rebuild. The sensor data under the proxy goes out too, as
//! decoded, for the full-resolution view and export (demosaiced on the GPU).

mod hot;

use rawler::decoders::RawDecodeParams;
use rayon::prelude::*;
use rawler::imgop::xyz::Illuminant;
use rawler::rawimage::{RawImage, RawImageData, RawPhotometricInterpretation};
use rawler::rawsource::RawSource;
use wasm_bindgen::prelude::*;

/// `initThreadPool(n)` for the threads build: the rayon pool rawler's decoders split their work across.
#[cfg(all(target_arch = "wasm32", feature = "threads"))]
pub use wasm_bindgen_rayon::init_thread_pool;

/// A sensel this close to the white level counts as clipped: the 40 MP X-Trans's blue stops about 2 % short of it.
const CLIP: f32 = 0.97;

/// A decoded frame: its metadata as JSON and the proxy as RGBA u16, row by row. Alpha's low three bits say
/// which of the pixel's colours (R, G, B) had at least one clipped sensel.
#[wasm_bindgen]
pub struct Decoded {
  meta: String,
  proxy: Vec<u16>,
  pw: u32,
  ph: u32,
  /// the sensor data as decoded, its row length, and where the proxy starts in it
  raw: Vec<u16>,
  stride: usize,
  at: (usize, usize),
  cell: usize,
}

#[wasm_bindgen]
impl Decoded {
  pub fn meta(&self) -> String { self.meta.clone() }
  pub fn proxy(&self) -> Vec<u16> { self.proxy.clone() }
  pub fn width(&self) -> u32 { self.pw }
  pub fn height(&self) -> u32 { self.ph }
  /// The sensor data under the proxy, row by row: `cell` sensels a proxy pixel each way (meta's fullWidth x
  /// fullHeight), black level still on. Cropped in place and handed over, so this frame is left without it.
  pub fn mosaic(&mut self) -> Vec<u16> {
    let (w, h) = (self.pw as usize * self.cell, self.ph as usize * self.cell);
    let mut d = std::mem::take(&mut self.raw);
    if d.len() < (self.at.1 + h - 1) * self.stride + self.at.0 + w { return Vec::new(); }
    for y in 0..h { let s = (self.at.1 + y) * self.stride + self.at.0; d.copy_within(s..s + w, y * w); }
    d.truncate(w * h);
    d
  }
}

/// Decodes a RAF (or any raw rawler reads) held in memory.
#[wasm_bindgen]
pub fn decode(bytes: &[u8]) -> Result<Decoded, JsError> {
  decode_native(bytes).map_err(|e| JsError::new(&e))
}

pub fn decode_native(bytes: &[u8]) -> Result<Decoded, String> {
  let src = RawSource::new_from_slice(bytes);
  let decoder = rawler::get_decoder(&src).map_err(|e| format!("not a raw this engine reads: {e}"))?;
  let mut raw = decoder.raw_image(&src, &RawDecodeParams::default(), false).map_err(|e| format!("decode failed: {e}"))?;
  let hot = mend(&mut raw);
  let b = bin(&raw)?;
  let c = chroma(&b.proxy, b.pw, b.ph, &raw.wb_coeffs);
  let meta = meta(&raw, &b, c, hot);
  let data = match std::mem::replace(&mut raw.data, RawImageData::Integer(Vec::new())) { RawImageData::Integer(d) => d, RawImageData::Float(_) => Vec::new() };
  Ok(Decoded { meta, proxy: b.proxy, pw: b.pw as u32, ph: b.ph as u32, raw: data, stride: raw.width, at: (b.x0, b.y0), cell: b.n })
}

fn level(v: &rawler::formats::tiff::Rational) -> f32 { if v.d == 0 { 0.0 } else { v.n as f32 / v.d as f32 } }
/// The sensor's black and white levels.
fn levels(raw: &RawImage) -> (f32, f32) {
  let l = &raw.blacklevel.levels;
  (if l.is_empty() { 0.0 } else { l.iter().map(level).sum::<f32>() / l.len() as f32 }, *raw.whitelevel.0.first().unwrap_or(&65535) as f32)
}
/// Mends the sensor data's hot sensels before anything is made from it (hot.rs), and says how many.
fn mend(raw: &mut RawImage) -> usize {
  let (black, white) = levels(raw);
  let cfa = match &raw.photometric { RawPhotometricInterpretation::Cfa(c) => c.cfa.clone(), _ => return 0 };
  let colour: Vec<usize> = (0..cfa.width * cfa.height).map(|i| cfa.color_at(i / cfa.width, i % cfa.width).min(2)).collect();
  let w = raw.width;
  match &mut raw.data { RawImageData::Integer(d) => hot::mend(d, w, &colour, cfa.width, cfa.height, black, white), RawImageData::Float(_) => 0 }
}

/// The proxy, where it starts in the sensor data, sensels a pixel each way, the black and white levels, and the
/// colour (0 R, 1 G, 2 B) of each site of the pattern from the proxy's first sensel on, row by row.
struct Bin { proxy: Vec<u16>, pw: usize, ph: usize, x0: usize, y0: usize, n: usize, black: f32, white: f32, cfa: String, cfa_width: usize }

/// The binned proxy over the crop (or active) area.
fn bin(raw: &RawImage) -> Result<Bin, String> {
  let data = match &raw.data { RawImageData::Integer(d) => d, RawImageData::Float(_) => return Err("float raws are not handled yet".into()) };
  let cfa = match &raw.photometric { RawPhotometricInterpretation::Cfa(c) => c.cfa.clone(), _ => return Err("not a mosaic raw".into()) };
  let n = if cfa.width == 6 { 3 } else { 2 };
  let area = raw.crop_area.or(raw.active_area);
  let (x0, y0, w, h) = match area { Some(r) => (r.p.x, r.p.y, r.d.w, r.d.h), None => (0, 0, raw.width, raw.height) };
  // start on a cell boundary of the pattern, so every n x n cell holds the same mix of colours
  let (x0, y0) = (x0 + (n - x0 % n) % n, y0 + (n - y0 % n) % n);
  let (pw, ph) = ((w - (x0 - area.map_or(0, |r| r.p.x))) / n, (h - (y0 - area.map_or(0, |r| r.p.y))) / n);
  let (black, white) = levels(raw);
  let scale = 65535.0 / (white - black).max(1.0);
  let clip = black + CLIP * (white - black);
  // the colour of each site of the pattern, looked up once rather than per pixel
  let (cw, ch) = (cfa.width, cfa.height);
  let colour: Vec<usize> = (0..cw * ch).map(|i| cfa.color_at(i / cw, i % cw).min(2)).collect();
  let mut out = vec![0u16; pw * ph * 4];
  out.par_chunks_mut(pw * 4).enumerate().for_each(|(py, line)| {
    for px in 0..pw {
      let (mut s, mut c, mut clipped) = ([0f32; 3], [0u32; 3], 0u16);
      for dy in 0..n {
        let y = y0 + py * n + dy;
        let row = &data[y * raw.width..(y + 1) * raw.width];
        for dx in 0..n {
          let x = x0 + px * n + dx;
          let k = colour[(y % ch) * cw + x % cw];
          s[k] += row[x] as f32;
          c[k] += 1;
          if row[x] as f32 >= clip { clipped |= 1 << k; }
        }
      }
      for k in 0..3 {
        let v = if c[k] > 0 { (s[k] / c[k] as f32 - black) * scale } else { 0.0 };
        line[px * 4 + k] = v.clamp(0.0, 65535.0) as u16;
      }
      line[px * 4 + 3] = clipped;
    }
  });
  let sites: String = (0..cw * ch).map(|i| char::from(b'0' + colour[((y0 + i / cw) % ch) * cw + (x0 + i % cw) % cw] as u8)).collect();
  Ok(Bin { proxy: out, pw, ph, x0, y0, n, black, white, cfa: sites, cfa_width: cw })
}

/// For the highlight rebuild (after darktable's "inpaint opposed"): a clipped colour is estimated from the
/// pixel's other two (the cube of their mean cube root, white-balanced), and this is how far the photo's own
/// colours sit from that estimate, averaged per colour over the unclipped pixels within three of a clipped
/// one. In sensor units (divide the white balance back out), zero when too few pixels say.
fn chroma(p: &[u16], pw: usize, ph: usize, wb_coeffs: &[f32]) -> [f32; 3] {
  let ok = wb_coeffs.len() >= 3 && wb_coeffs[..3].iter().all(|x| x.is_finite() && *x > 0.0);
  let wb: [f32; 3] = if ok { [wb_coeffs[0] / wb_coeffs[1], 1.0, wb_coeffs[2] / wb_coeffs[1]] } else { [2.0, 1.0, 1.667] };
  // which colours are clipped within three pixels along the row; the rows above and below are joined next
  let mut along = vec![0u8; pw * ph];
  along.par_chunks_mut(pw).enumerate().for_each(|(y, line)| {
    for x in 0..pw {
      let f = p[(y * pw + x) * 4 + 3] as u8;
      if f != 0 { for q in x.saturating_sub(3)..(x + 4).min(pw) { line[q] |= f; } }
    }
  });
  let sums = (0..ph).into_par_iter().map(|y| {
    let (mut acc, mut near) = ([0f64; 6], vec![0u8; pw]);
    for q in y.saturating_sub(3)..(y + 4).min(ph) { for (n, a) in near.iter_mut().zip(&along[q * pw..(q + 1) * pw]) { *n |= a; } }
    for x in 0..pw {
      let i = (y * pw + x) * 4;
      let want = near[x] & !(p[i + 3] as u8);
      if want == 0 { continue; }
      let v: [f32; 3] = std::array::from_fn(|k| p[i + k] as f32 / 65535.0 * wb[k]);
      let r = v.map(f32::cbrt);
      for k in 0..3 {
        if want & (1 << k) == 0 || (p[i + k] as f32) < 0.2 * CLIP * 65535.0 { continue; }
        let m = 0.5 * (r[(k + 1) % 3] + r[(k + 2) % 3]);
        acc[k] += (v[k] - m * m * m) as f64;
        acc[k + 3] += 1.0;
      }
    }
    acc
  }).reduce(|| [0f64; 6], |a, b| std::array::from_fn(|i| a[i] + b[i]));
  std::array::from_fn(|k| if sums[k + 3] > 100.0 { (sums[k] / sums[k + 3]) as f32 / wb[k] } else { 0.0 })
}

/// What the GPU stage needs: white balance, the camera matrix for D65 (XYZ to camera), orientation.
fn meta(raw: &RawImage, b: &Bin, chroma: [f32; 3], hot: usize) -> String {
  let m = raw.color_matrix.get(&Illuminant::D65).or_else(|| raw.color_matrix.values().next());
  let mat = m.map(|v| v.iter().take(9).map(|x| format!("{x}")).collect::<Vec<_>>().join(",")).unwrap_or_default();
  let wb = raw.wb_coeffs.iter().map(|x| format!("{}", if x.is_nan() { 0.0 } else { *x })).collect::<Vec<_>>().join(",");
  format!(
    "{{\"make\":{:?},\"model\":{:?},\"width\":{},\"height\":{},\"proxyWidth\":{},\"proxyHeight\":{},\"wb\":[{}],\"xyzToCamD65\":[{}],\"orientation\":{:?},\"chroma\":[{},{},{}],\"fullWidth\":{},\"fullHeight\":{},\"black\":{},\"white\":{},\"cfa\":{:?},\"cfaWidth\":{},\"hot\":{}}}",
    raw.clean_make, raw.clean_model, raw.width, raw.height, b.pw, b.ph, wb, mat, format!("{:?}", raw.orientation), chroma[0], chroma[1], chroma[2],
    b.pw * b.n, b.ph * b.n, b.black, b.white, b.cfa, b.cfa_width, hot
  )
}

/// One band of a JPEG: `rgb` is w x h pixels, three bytes each, top row first. Every band made at one quality
/// shares its tables (the standard Huffman ones), so the page joins the bands' scans with restart markers into
/// one file and never holds more than a band. `fine` keeps colour at full resolution (4:4:4); else 4:2:0.
#[wasm_bindgen]
pub fn jpeg(rgb: &[u8], w: u16, h: u16, quality: u8, fine: bool) -> Result<Vec<u8>, JsError> {
  use jpeg_encoder::{ChromaSubsamplingMethod, ColorType, Encoder, SamplingFactor};
  let mut out = Vec::with_capacity(rgb.len() / 4);
  let mut e = Encoder::new(&mut out, quality);
  e.set_sampling_factor(if fine { SamplingFactor::R_4_4_4 } else { SamplingFactor::R_4_2_0 });
  e.set_chroma_subsampling_method(ChromaSubsamplingMethod::Average);
  e.encode(rgb, w, h, ColorType::Rgb).map_err(|x| JsError::new(&x.to_string()))?;
  Ok(out)
}
