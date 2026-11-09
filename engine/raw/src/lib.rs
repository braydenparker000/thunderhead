//! The new photo engine's RAW stage (docs/engineering/ENGINE-RESEARCH.md). rawler opens the RAF (all
//! three Fujifilm encodings); this crate hands the browser the metadata the colour pipeline needs and the
//! editing proxy: each 3 x 3 cell of the X-Trans mosaic (2 x 2 for Bayer) averaged per colour into one
//! RGB pixel, black-subtracted and scaled to the white level, so the GPU starts from clean linear
//! camera RGB at about 2576 x 1717 for a 40 MP frame, with no demosaic needed.

use rawler::decoders::RawDecodeParams;
use rayon::prelude::*;
use rawler::imgop::xyz::Illuminant;
use rawler::rawimage::{RawImage, RawImageData, RawPhotometricInterpretation};
use rawler::rawsource::RawSource;
use wasm_bindgen::prelude::*;

/// `initThreadPool(n)` for the threads build: the rayon pool rawler's decoders split their work across.
#[cfg(all(target_arch = "wasm32", feature = "threads"))]
pub use wasm_bindgen_rayon::init_thread_pool;

/// A decoded frame: its metadata as JSON and the proxy as RGBA u16 (alpha unused), row by row.
#[wasm_bindgen]
pub struct Decoded {
  meta: String,
  proxy: Vec<u16>,
  pw: u32,
  ph: u32,
}

#[wasm_bindgen]
impl Decoded {
  pub fn meta(&self) -> String { self.meta.clone() }
  pub fn proxy(&self) -> Vec<u16> { self.proxy.clone() }
  pub fn width(&self) -> u32 { self.pw }
  pub fn height(&self) -> u32 { self.ph }
}

/// Decodes a RAF (or any raw rawler reads) held in memory.
#[wasm_bindgen]
pub fn decode(bytes: &[u8]) -> Result<Decoded, JsError> {
  decode_native(bytes).map_err(|e| JsError::new(&e))
}

pub fn decode_native(bytes: &[u8]) -> Result<Decoded, String> {
  let src = RawSource::new_from_slice(bytes);
  let decoder = rawler::get_decoder(&src).map_err(|e| format!("not a raw this engine reads: {e}"))?;
  let raw = decoder.raw_image(&src, &RawDecodeParams::default(), false).map_err(|e| format!("decode failed: {e}"))?;
  let (proxy, pw, ph) = bin(&raw)?;
  Ok(Decoded { meta: meta(&raw, pw, ph), proxy, pw, ph })
}

fn level(v: &rawler::formats::tiff::Rational) -> f32 { if v.d == 0 { 0.0 } else { v.n as f32 / v.d as f32 } }

/// The binned proxy over the crop (or active) area.
fn bin(raw: &RawImage) -> Result<(Vec<u16>, u32, u32), String> {
  let data = match &raw.data { RawImageData::Integer(d) => d, RawImageData::Float(_) => return Err("float raws are not handled yet".into()) };
  let cfa = match &raw.photometric { RawPhotometricInterpretation::Cfa(c) => c.cfa.clone(), _ => return Err("not a mosaic raw".into()) };
  let n = if cfa.width == 6 { 3 } else { 2 };
  let area = raw.crop_area.or(raw.active_area);
  let (x0, y0, w, h) = match area { Some(r) => (r.p.x, r.p.y, r.d.w, r.d.h), None => (0, 0, raw.width, raw.height) };
  // start on a cell boundary of the pattern, so every n x n cell holds the same mix of colours
  let (x0, y0) = (x0 + (n - x0 % n) % n, y0 + (n - y0 % n) % n);
  let (pw, ph) = ((w - (x0 - area.map_or(0, |r| r.p.x))) / n, (h - (y0 - area.map_or(0, |r| r.p.y))) / n);
  let black: f32 = { let l = &raw.blacklevel.levels; if l.is_empty() { 0.0 } else { l.iter().map(level).sum::<f32>() / l.len() as f32 } };
  let white = *raw.whitelevel.0.first().unwrap_or(&65535) as f32;
  let scale = 65535.0 / (white - black).max(1.0);
  // the colour of each site of the pattern, looked up once rather than per pixel
  let (cw, ch) = (cfa.width, cfa.height);
  let colour: Vec<usize> = (0..cw * ch).map(|i| cfa.color_at(i / cw, i % cw).min(2)).collect();
  let mut out = vec![0u16; pw * ph * 4];
  out.par_chunks_mut(pw * 4).enumerate().for_each(|(py, line)| {
    for px in 0..pw {
      let (mut s, mut c) = ([0f32; 3], [0u32; 3]);
      for dy in 0..n {
        let y = y0 + py * n + dy;
        let row = &data[y * raw.width..(y + 1) * raw.width];
        for dx in 0..n {
          let x = x0 + px * n + dx;
          let k = colour[(y % ch) * cw + x % cw];
          s[k] += row[x] as f32;
          c[k] += 1;
        }
      }
      for k in 0..3 {
        let v = if c[k] > 0 { (s[k] / c[k] as f32 - black) * scale } else { 0.0 };
        line[px * 4 + k] = v.clamp(0.0, 65535.0) as u16;
      }
    }
  });
  Ok((out, pw as u32, ph as u32))
}

/// What the GPU stage needs: white balance, the camera matrix for D65 (XYZ to camera), orientation.
fn meta(raw: &RawImage, pw: u32, ph: u32) -> String {
  let m = raw.color_matrix.get(&Illuminant::D65).or_else(|| raw.color_matrix.values().next());
  let mat = m.map(|v| v.iter().take(9).map(|x| format!("{x}")).collect::<Vec<_>>().join(",")).unwrap_or_default();
  let wb = raw.wb_coeffs.iter().map(|x| format!("{}", if x.is_nan() { 0.0 } else { *x })).collect::<Vec<_>>().join(",");
  format!(
    "{{\"make\":{:?},\"model\":{:?},\"width\":{},\"height\":{},\"proxyWidth\":{},\"proxyHeight\":{},\"wb\":[{}],\"xyzToCamD65\":[{}],\"orientation\":{:?}}}",
    raw.clean_make, raw.clean_model, raw.width, raw.height, pw, ph, wb, mat, format!("{:?}", raw.orientation)
  )
}
