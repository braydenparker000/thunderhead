//! Photos' RAW engine (docs/product/apps/PHOTOS.md, the editor): LightCraft's decoders and colour maths
//! behind a small wasm-bindgen API, run in a Web Worker on the phone.
//!
//! - `inputPtr(len, reserve)`: JS streams the file straight into wasm memory (it is never a whole
//!   `ArrayBuffer` in JS); `decode(bytes)` is the copying form.
//! - `decodeInput(streaming)` → `{width, height, camera, whiteBalance, previewJpeg, …}`. Streaming (RAF only)
//!   reads the headers now and decodes the mosaic band by band later (stream.rs).
//! - `working(scale)` → planar f16 linear Rec.2020 at `1/scale` (2 = half size), white balanced.
//! - `tile(x, y, w, h)` → the same at full resolution for one window (the 1:1 view).
//! - `freeWorking()` once the copy lives in GPU textures, so a tile can reuse the space.
//!
//! Buffers come back as `{ptr, width, height}`: JS makes zero-copy views on `memory.buffer`, valid until the
//! next call that may allocate.

mod kernel;
mod stream;

use js_sys::{Array, Object, Reflect, Uint8Array};
use kernel::Kernel;
use lightcraft_color::{REC2020, SRGB};
use lightcraft_raw::{self as raw, RawImage, Rect};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
#[derive(Default)]
pub struct Engine {
    /// The file, in a u16 arena so the same allocation is reused for the working copy when the mosaic is
    /// decoded whole (wasm memory never shrinks; a freed file below the mosaic would leave a hole).
    input: Vec<u16>,
    input_len: usize,
    raw: Option<RawImage>,
    /// white-balanced camera RGB → linear Rec.2020 D65
    matrix: [[f32; 3]; 3],
    wb: [f32; 3],
    /// the default crop in active-area coordinates
    crop: Rect,
    work: Vec<u16>,
    tile: Vec<u16>,
    streaming: bool,
}

fn set(o: &Object, k: &str, v: impl Into<JsValue>) {
    let _ = Reflect::set(o, &JsValue::from_str(k), &v.into());
}

fn arr<T: Copy + Into<JsValue>>(v: &[T]) -> Array {
    v.iter().map(|&x| x.into()).collect()
}

fn err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn buffer(ptr: *const u16, x: usize, y: usize, w: usize, h: usize) -> JsValue {
    let o = Object::new();
    set(&o, "ptr", ptr as usize as u32);
    set(&o, "x", x as u32);
    set(&o, "y", y as u32);
    set(&o, "width", w as u32);
    set(&o, "height", h as u32);
    set(&o, "planes", 3u32);
    o.into()
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine {
        Engine::default()
    }

    /// Reserves `len` bytes for the file and returns their address; `reserve` (bytes) makes the arena at least
    /// that large (the expected working copy), so the copy can live where the file was.
    #[wasm_bindgen(js_name = inputPtr)]
    pub fn input_ptr(&mut self, len: usize, reserve: usize) -> usize {
        self.input = Vec::new();
        self.work = Vec::new();
        self.tile = Vec::new();
        self.raw = None;
        let words = len.div_ceil(2);
        let mut v = Vec::with_capacity(words.max(reserve.div_ceil(2)));
        v.resize(words, 0u16);
        self.input = v;
        self.input_len = len;
        self.input.as_mut_ptr() as usize
    }

    /// The copying form: takes the file's bytes and decodes them whole.
    pub fn decode(&mut self, bytes: &[u8]) -> Result<JsValue, JsError> {
        self.input_ptr(bytes.len(), 0);
        bytemuck::cast_slice_mut::<u16, u8>(&mut self.input)[..bytes.len()].copy_from_slice(bytes);
        self.decode_input(false)
    }

    /// Decodes the file written at `inputPtr`. `streaming` (RAF only, else ignored) keeps the file and reads
    /// only its headers now. Returns `{width, height, camera, whiteBalance, previewJpeg, …}`.
    #[wasm_bindgen(js_name = decodeInput)]
    pub fn decode_input(&mut self, streaming: bool) -> Result<JsValue, JsError> {
        self.raw = None;
        self.tile = Vec::new();
        self.work = Vec::new();
        let bytes = &bytemuck::cast_slice::<u16, u8>(&self.input)[..self.input_len];
        let preview = raw::embedded_preview(bytes);
        let streaming = streaming && raw::probe(bytes) == Some(raw::RawFormat::Raf);
        let img = if streaming { raw::raf_decode_header(bytes) } else { raw::decode(bytes) }.map_err(err)?;
        self.streaming = streaming;
        if !streaming {
            let mut arena = std::mem::take(&mut self.input);
            arena.clear();
            self.work = arena; // its capacity is kept for the working copy
        }
        if img.cpp != 1 {
            return Err(JsError::new("this engine reads single-plane mosaic raws only"));
        }
        // Colour: the file's own matrices (DNG), else LightCraft's bundled ones for the body, else its neutral
        // fallback (camera RGB taken as linear sRGB); the white balance is the file's as-shot one.
        let wb_xy = raw::color::as_shot_white_xy(&img);
        let t = raw::color::camera_transform(&img, wb_xy);
        self.matrix = t.matrix.to_f32();
        self.wb = t.wb;
        let a = img.active_area;
        self.crop = img.develop_crop(a.width, a.height);

        let o = Object::new();
        set(&o, "width", self.crop.width as u32);
        set(&o, "height", self.crop.height as u32);
        let m = &img.metadata;
        let camera = format!("{} {}", m.make.as_deref().unwrap_or("").trim(), m.model.as_deref().unwrap_or("").trim());
        set(&o, "camera", camera.trim().to_string());
        set(&o, "format", format!("{:?}", img.format));
        set(&o, "bits", img.bits);
        set(&o, "iso", m.iso.unwrap_or(0));
        set(&o, "orientation", format!("{:?}", img.orientation));
        let cfa = img.cfa.as_ref().map(|c| format!("{}x{} {}", c.width, c.height, if c.is_bayer() { "bayer" } else { "x-trans" }));
        set(&o, "cfa", cfa.unwrap_or_default());
        set(&o, "whiteBalance", arr(&self.wb));
        set(&o, "whiteXy", arr(&[t.white_xy.x, t.white_xy.y]));
        set(&o, "matrixIsFallback", t.matrix_is_fallback);
        set(&o, "baselineExposure", t.baseline_exposure);
        set(&o, "cameraToRec2020", arr(&self.matrix.concat()));
        set(&o, "rec2020ToSrgb", arr(&REC2020.to_space(&SRGB).to_f32().concat()));
        // JS owns the preview from here; wasm memory keeps no second copy
        match preview {
            Some(j) => set(&o, "previewJpeg", Uint8Array::from(j.as_slice())),
            None => set(&o, "previewJpeg", JsValue::NULL),
        }
        set(&o, "streaming", self.streaming);
        self.raw = Some(img);
        Ok(o.into())
    }

    /// The working copy at `1/scale` of the default crop: planar f16 linear Rec.2020, white balanced,
    /// highlights clipped at 1.0. Plane `c` starts at `ptr + c * width * height * 2`.
    pub fn working(&mut self, scale: usize) -> Result<JsValue, JsError> {
        let img = self.raw.as_ref().ok_or_else(|| JsError::new("decode first"))?;
        let s = scale.max(1);
        let c = self.crop;
        let (w2, h2) = (c.width / s, c.height / s);
        let mut out = std::mem::take(&mut self.work);
        out.clear();
        out.resize(w2 * h2 * 3, 0);
        let k = Kernel { matrix: self.matrix, wb: self.wb, crop: c, s, w2, h2 };
        if self.streaming {
            let bytes = &bytemuck::cast_slice::<u16, u8>(&self.input)[..self.input_len];
            stream::working(bytes, img, &k, c, &mut out).map_err(err)?;
        } else {
            k.produce(&kernel::Src::Raw(img), img, 0, w2, &mut out);
        }
        self.work = out;
        Ok(buffer(self.work.as_ptr(), 0, 0, w2, h2))
    }

    /// A full-resolution tile of the default crop at `(x, y)`, `w × h` (clamped to the crop), encoded as
    /// `working` is. Returns `{ptr, x, y, width, height, planes: 3}`.
    pub fn tile(&mut self, x: usize, y: usize, w: usize, h: usize) -> Result<JsValue, JsError> {
        let img = self.raw.as_ref().ok_or_else(|| JsError::new("decode first"))?;
        let c = self.crop;
        let x = x.min(c.width.saturating_sub(1));
        let y = y.min(c.height.saturating_sub(1));
        let w = w.min(c.width - x).max(1);
        let h = h.min(c.height - y).max(1);
        let (fx, fy) = (c.x + x, c.y + y);
        let mut out = std::mem::take(&mut self.tile);
        out.clear();
        out.resize(w * h * 3, 0);
        let k = Kernel { matrix: self.matrix, wb: self.wb, crop: Rect::new(fx, fy, w, h), s: 1, w2: w, h2: h };
        if self.streaming {
            let bytes = &bytemuck::cast_slice::<u16, u8>(&self.input)[..self.input_len];
            stream::tile(bytes, img, &k, fx, fy, &mut out).map_err(err)?;
        } else {
            k.produce(&kernel::Src::Raw(img), img, 0, w, &mut out);
        }
        self.tile = out;
        Ok(buffer(self.tile.as_ptr(), x, y, w, h))
    }

    /// Drops the CPU working copy (it lives in GPU textures from here).
    #[wasm_bindgen(js_name = freeWorking)]
    pub fn free_working(&mut self) {
        self.work = Vec::new();
    }

    /// The linear memory's size in bytes (it never shrinks, so this is also the peak).
    #[wasm_bindgen(js_name = memoryBytes)]
    pub fn memory_bytes(&self) -> f64 {
        #[cfg(target_arch = "wasm32")]
        return (core::arch::wasm32::memory_size(0) * 65536) as f64;
        #[cfg(not(target_arch = "wasm32"))]
        return 0.0;
    }
}
