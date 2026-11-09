# The new photo engine: research and recommended design

Research report, 2026-11-09, for the engine behind the new editor ([design/EDITOR.md](../design/EDITOR.md)).
The goal the owner set: **at least Lightroom quality, especially in colour development and the quality
of each feature**, for Fujifilm X-E5 RAFs (40 MP X-Trans CMOS 5 HR, 7728 × 5152, 14-bit; compressed,
lossless compressed or uncompressed), edited in Chrome on a Samsung Galaxy A35 (Exynos 1380, Mali-G68
MP5, 8 GB), as a static PWA with no server compute. Licence rule (AGENTS.md): nothing GPL, AGPL or
non-commercial ships; such projects are read for ideas only. Figures marked *estimate* are not measured
yet; measuring them on the A35 is the first job of the build.

## Revised pipeline (owner, 2026-11-09)

The owner dropped the licence restriction: use the best existing work instead of rebuilding it. This
supersedes the "write our own" choices below wherever they differ.

- **Open the RAF:** rawler (dnglab), already in `engine/raw`; it knows the X-E5 (lossless, uncompressed
  and lossy). Decoding is lossless, so the reader does not change quality.
- **GPU backbone:** vkdt's compute modules (darktable's author's GPU engine), ported to WGSL: X-Trans
  demosaic, local Laplacian, filmic, colour.
- **Colour:** darktable's color calibration (CAT16) and color balance rgb; filmic / sigmoid / AgX; dcamprof
  profiles; RawTherapee's highlight reconstruction and capture sharpening.
- **Detail and noise:** RawTherapee and darktable demosaic and NR; BM3D; AI Denoise.
- **Lens and geometry:** lensfun (library and database), darktable's rotate and perspective.
- **Masks and Remove:** the strongest models regardless of licence (RMBG-2.0, SAM 2, BiRefNet, LaMa / MAT).
- **Film simulations:** Fujifilm's official LUTs exist only for ETERNA and ETERNA Bleach Bypass (every
  body's package, X-E5 v1.00 included). The other simulations need another exact source: the owner decides.

**First slice, measured** (this machine's CPU; the A35 next): an X-T5 RAF (lossless compressed, 43 MB)
decodes and bins in wasm in about 2.1 s on one thread (0.56 s natively with rawler's own threads); the
2576 x 1717 proxy uploads in about 50 ms; a full development pass takes about 112 ms on SwiftShader
(software), which a real GPU runs many times faster.

## The answer in one page

1. **Decode on the CPU, everything else on the GPU.** RAF parsing and Fuji's lossless decompression run
   in wasm across threads: the compressed image is split into independent 768-px-wide blocks (11 per
   row at 7728 px), so 4–6 threads decode in parallel. Every later stage is WebGPU compute in float16.
2. **Edit a proxy, finish at full size.** The working image while editing is a **3 × 3-binned X-Trans
   proxy, 2576 × 1717**: clean colour with no demosaic, about the size of Lightroom's 2560-px Smart
   Preview. Zooming to 100 % renders only the visible region at full resolution, with a real demosaic.
   Export renders full resolution in bands.
3. **Colour: DNG-standard maths, our own tuning.** Black and white levels → white balance → camera to
   XYZ through dual-illuminant matrices blended by colour temperature → **linear Rec.2020, float16**
   working space → exposure and highlight reconstruction → local tone (Highlights, Shadows, Clarity,
   Texture) → our own filmic tone curve → perceptual colour tools in **OkLCh** → the look (film simulation
   LUT) → Display P3 or sRGB output with dither. The DNG specification's patent grant is royalty-free,
   so this is clean to ship.
4. **Film simulations: learned from the owner's own camera.** The X-E5 can re-render one RAF in-camera
   in every film simulation (RAW conversion in playback). Those JPEGs paired with the RAF are perfect
   training data: we fit a 3D LUT per simulation (plus tone curves for Highlight/Shadow and DR), so
   ours match his camera, not a guess.
5. **AI where it beats classic methods:** masks (subject, sky, people, objects), Remove, and an optional
   AI Denoise. These are permissively licensed models run by ONNX Runtime Web on WebGPU, downloaded once
   and cached on the phone.
6. **Validate against references, not taste alone.** Colour is measured as ΔE2000 against the camera's
   own JPEGs and a reference converter on the same frames; tone and detail with fixed test scenes; speed
   on the A35 itself.

## 1. Getting the image in

**Container and decode.** A RAF holds a header, an embedded full-size JPEG preview, Exif plus Fujifilm
maker notes, and the raw data. The lossless-compressed format is entropy coded per block, so it cannot
run on the GPU, but blocks are independent, so wasm threads parallelise it. Implementations:
LibRaw (LGPL-2.1 **or** CDDL-1.0), rawspeed (LGPL-2.1), rawler/dnglab (LGPL-2.1; already lists the X-E5),
rawloader (no Fuji compressed support). None is MIT/BSD. **Recommendation: write our own decoder** for
the three RAF variants in Rust → wasm (the format is fully described by these open sources; reading for
understanding is fine). It's a few hundred lines and avoids any licence question. Fallback: LibRaw under
its CDDL option, kept as its own module [owner call: CDDL is file-level copyleft, not banned by our rule,
but not permissive either].

**Instant thumbnails** come from the embedded JPEG: no decode needed for the Library grid or culling.

**Metadata worth reading** (documented in ExifTool's FujiFilm tag list): white balance, black levels,
crop, `RawExposureBias` (DR200/DR400 shoot underexposed by 1–2 stops: the engine must lift exposure to
match, as Lightroom does), the film simulation, Grain, Color Chrome, Chrome FX Blue, Highlight/Shadow
tone, Color, Sharpness, NR, Clarity (this gives "As shot"), and Fujifilm's lens corrections (distortion,
vignetting, chromatic aberration), which are only partly decoded publicly (see §5).

## 2. Demosaic and detail

**X-Trans is the hard part.** The 6 × 6 pattern defeats Bayer algorithms and shows maze or "worm"
artefacts and false colour if handled badly.

- **Baseline:** Markesteijn 3-pass (from dcraw; its licence is free for all uses) ported to WGSL. It's
  the reference used by darktable and RawTherapee.
- **Quality bar:** Lightroom's default is good, and its *Enhance › Raw Details* (machine learning) is
  better. Recent community work (the pixls.us "x-veon" thread, 2025) reports cleaner X-Trans results with
  fewer worms; worth evaluating.
- **Later:** a small learned demosaic in the same AI runtime as masks, run on demand for export.

On the proxy, the 3 × 3 binning *is* the demosaic: each 3 × 3 X-Trans cell has red, green and blue
sites, so binning gives clean colour. That's why the proxy looks good immediately.

*Estimate:* Markesteijn on a 40 MP frame is seconds on a phone GPU. That's acceptable for export and for
100 % regions (a 412 × 600 css view at 100 % is about 1.5 MP), not for every slider move. That is exactly
the proxy split above.

## 3. Colour science: how we reach Lightroom quality

**Camera characterisation.** We use the DNG specification's model: ColorMatrix and ForwardMatrix for two
illuminants (A and D65), interpolated by the scene's correlated colour temperature (inverse CCT). The X-E5
needs these numbers. Two clean sources:
- **(a)** our own measurement from a ColorChecker photo (best: a matrix plus a small 3D correction table,
  like Adobe's HueSatMap);
- **(b)** published matrices used across open converters, as starting values.

Adobe's DNG SDK has its own licence (redistributable with notices); we don't need the SDK, only the
spec's maths, which carries a royalty-free patent grant.

**White balance.** As-shot multipliers from the RAF. Temperature and Tint match Lightroom's controls by
mapping Kelvin along the Planckian/daylight locus with Robertson's method, and tint perpendicular to it.
Chromatic adaptation is CAT16 (or Bradford). Auto WB uses a robust grey-world/white-patch blend, with the
camera's own as-shot value as the anchor.

**Working space.** Scene-referred linear **Rec.2020 in float16**, the same idea as ProPhoto-linear in
Lightroom. Nothing clips until the output transform.

**Tone (the feel of the sliders).** Adobe has never published Process Version 2012's maths, so nobody can
copy it exactly. What's known: Exposure is a linear gain; Highlights and Shadows are *local*, adaptive
adjustments (they don't flatten local contrast); Whites and Blacks set the end points; Contrast pivots
around mid-grey.
- **Our version:** Exposure in linear light. Highlights, Shadows and Clarity through a **local Laplacian
  pyramid** (the fast approximation by Aubry et al. 2014, about 50× faster than the original); this is
  what gives Lightroom-like, halo-free results.
- **Base curve:** our own **filmic sigmoid**, with Whites, Blacks and Contrast as its parameters.
  ACES 2.0's output transform (Apache-2.0) is the licence-safe reference to compare against. OpenDRT
  (GPL-3) and darktable's sigmoid and filmic are study-only.
- **Highlight reconstruction:** recover clipped channels from the unclipped ones ("inpaint opposed"
  style), then compress gamut so saturated colours don't break.

**Colour tools in a perceptual space.**
- **OkLCh** for HSL and the colour mixer (8 bands with smooth weighting), Vibrance (weighted against
  already-saturated colours and protecting skin tones) and Saturation.
- Colour grading wheels apply in OkLab with luminance-weighted masks for Shadows, Midtones and
  Highlights, plus Blending and Balance as in Lightroom.
- The point curve applies in a log or display-like encoding so it behaves like Lightroom's.

**Output.** Display P3 on screen (Chrome Android supports P3 canvases and WebGPU canvases), sRGB or P3
for export with an embedded ICC profile, and blue-noise dither before 8-bit.

**Film simulations: the plan that makes them right.**
1. **The owner shoots a calibration set** (one afternoon): about 30 varied scenes (skin, sky, foliage,
   neon, night, a grey card if possible). For each RAF, the camera re-renders a JPEG in every simulation
   through in-camera RAW conversion. That gives roughly 30 × 16 matched pairs at no cost.
2. **We fit, per simulation,** a 33³ 3D LUT from our neutral render to the camera JPEG, with smoothness
   regularisation. Highlight and Shadow tone, DR100/200/400, Color, Color Chrome and Chrome FX Blue are
   fitted as separate parametric layers, so recipes can set them independently.
3. **Measure:** ΔE2000 on held-out frames. *Target:* median under 2 (barely visible), 95th percentile
   under 5.

This gives the owner's camera's real look for Provia through Reala Ace, which no generic preset pack
can promise. Grain is our own synthesis (a physically based grain model; the reference implementation by
Newson et al. is GPL-3, so we write ours from the paper).

**Imported looks.**
- `.cube` LUTs apply directly.
- Lightroom `.xmp` and `.lrtemplate` presets map their `crs:` settings onto our sliders.
- Presets that point to Adobe's camera profiles (e.g. "Camera Classic Chrome") map to our fitted
  simulations, as the import report on the Looks screen says.
- Recipe text maps 1:1 to our film-simulation layers.

## 4. Feature quality: algorithm per feature

| Feature | Method | Licence | Notes |
|---|---|---|---|
| Texture / Clarity | Local Laplacian (fast approx.) on luminance, band-limited | own | the key to "Lightroom feel"; avoid halos |
| Dehaze | Dark-channel prior with guided-filter refinement, in linear light | own | add a sky-aware clamp |
| Sharpening | Unsharp mask with Detail and Masking like Lightroom; optional deconvolution | own | Masking = edge mask from a blurred gradient |
| Noise reduction (live) | Wavelet / guided-filter luminance and chroma NR | own | real-time on the proxy |
| AI Denoise (action) | NAFNet (MIT) or SCUNet (Apache-2.0), tiled, in ORT Web | permissive | like Lightroom's Denoise: run once, writes a new base |
| Lens corrections | Fuji in-RAF data when decoded; else measured profiles for the owner's lenses | own | lensfun's library is LGPL-3 and its database CC BY-SA: don't ship |
| Upright / auto straighten | Line detection (own EDLines/Hough) + vanishing points | own | LSD's reference code is AGPL: don't ship |
| Vignette, Grain | Post-crop vignette (highlight priority); physical grain synthesis | own | |
| Heal / Clone | Poisson blending on the GPU (multigrid) | own | |
| Remove | MI-GAN (MIT, ~28 MB) or LaMa (Apache-2.0, larger), tiled | permissive | |
| Range masks | Luminance / colour from the image | own | |

## 5. Masks on the phone

All model weights must allow commercial use. Checked so far:
- **Usable:**
  - MobileSAM, EfficientSAM, SAM 2.1, SlimSAM, TinySAM and RepViT-SAM (Apache-2.0)
  - U²-Net and MODNet (Apache)
  - SkySeg u2netp (MIT)
  - MediaPipe multiclass segmenter (Apache)
  - MI-GAN (MIT) and LaMa (Apache)
- **Not usable:** EdgeSAM (S-Lab licence), RMBG-2.0 and MAT (CC BY-NC), SegFormer (NVIDIA non-commercial).
- **To confirm:** BiRefNet's code is MIT, but its weights' terms weren't stated.

**Recommended stack:** ONNX Runtime Web with the WebGPU backend.
- **Subject:** BiRefNet-lite (fp16, ~115 MB) if its weights check out, else U²-Net.
- **Sky:** SkySeg.
- **People and parts:** MediaPipe multiclass (face, hair, skin, clothes).
- **Objects (tap or box):** MobileSAM or SAM 2.1-tiny.
- **Resolution:** run at ~1024 px, then an edge-aware guided upsample to 40 MP for clean hair and edges.
- **Delivery:** models download on first use with a progress bar and are kept on the phone (OPFS).
  *Estimate:* 1–3 s per mask on the A35. No public Mali-G68 figures exist, so measure.

## 6. The platform: what the A35 allows

- **GPU memory:** a 40 MP RGBA float16 image is ~320 MB, larger than WebGPU's common 128–256 MiB limit
  for one storage buffer, so full-resolution work is **tiled** (e.g. 2048² tiles with overlap for the
  local filters).
- **f16 shaders:** `shader-f16` is opt-in and must be checked per device; Dawn applies a zero-init
  workaround on Mali.
- **Memory64** has been in Chrome since 133.
- **Device loss:** plan for it. Keep the recipe, not the pixels, as the truth, so a lost GPU just re-renders.
- **Threads:** decode and file work in wasm workers, GPU work in one worker using OffscreenCanvas, and
  the UI thread only draws the plate. That's what keeps the dial at 60 fps while the image renders behind.
- **Frame budget** (Lightroom-mobile pattern): a slider move renders the proxy within ~50 ms; if a frame
  takes longer, show a half-size preview while dragging and refine on release. Full-res regions render
  after the finger lifts.
- **Files on Android Chrome:**
  - OPFS works.
  - `showDirectoryPicker` isn't available, so importing uses the multi-file picker. It can browse an
    SD reader or the camera over USB through Android's Files.
  - WebUSB can't read mass storage, so no direct camera link.
  - Saving uses a download (lands in Downloads) or Web Share.
- **Encoders:** jpegli or libjpeg-turbo (BSD-style) in wasm, banded; our own 16-bit TIFF writer; ICC and
  Exif/XMP writers; PNG via the browser.
- **Edits and library:** each photo's edit is a small recipe (JSON) plus history and versions in
  IndexedDB/OPFS; optionally an XMP sidecar in Lightroom's `crs:` namespace so edits can round-trip later.

## 7. Test files

No public X-E5 RAFs were found. raw.pixls.us offers public-domain (CC0) RAFs from **three cameras with
the same 40 MP X-Trans 5 HR sensor**:
- the **X-H2**, with all three formats (compressed, lossless compressed, uncompressed);
- the **X-T5**;
- the **X100VI**.

These are our automated test set; X-E5-specific checks use the owner's own frames, kept off the repository.

## 8. How we prove it's Lightroom quality

1. **Colour:** ΔE2000 of our neutral render against a reference converter's neutral render of the same
   RAFs, and of each fitted simulation against the camera's JPEG (targets in §3).
2. **Tone:** step wedges and real scenes; each slider's response curve compared with the reference
   converter's at matching settings, so sliders "feel" the same.
3. **Detail:** demosaic crops at 100 % (foliage, fabric, text, starburst charts) checked for worms and
   false colour against Markesteijn and the reference.
4. **Speed on the A35:** time to first image (< 1 s from the embedded preview, < 3 s to the editable
   proxy), slider frame time (≤ 50 ms), 100 % region (< 1.5 s), full export (< 30 s for both sizes),
   memory peak (< 1.5 GB).
5. **Blind A/B with the owner** on his own photos.

## 9. Build order

1. **Foundations:** RAF decoder (all three variants) in wasm threads; embedded previews; the GPU worker;
   the proxy; neutral colour (WB, matrices, linear Rec.2020, output); measure speed on the A35.
2. **Light and Color:** exposure, filmic tone with Whites, Blacks and Contrast, local Laplacian
   Highlights and Shadows, Temp and Tint, OkLCh tools, tone curve; wire the new editor's Edit screen to it.
3. **Full resolution:** tiling, Markesteijn, 100 % regions, banded export with jpegli; ship to the owner.
4. **Looks:** the owner's calibration shoot; fitted simulations; recipes; .cube, .xmp and .lrtemplate
   import.
5. **Detail and Effects:** sharpening, live NR, Texture, Clarity, Dehaze, grain, vignette, lens and geometry.
6. **Masks and Remove:** the model stack, brush, gradients, ranges; Heal.
7. **Polish:** AI Denoise, better demosaic, Lightroom XMP round-trip.

## 10. Decisions for the owner

- Our own RAF decoder (recommended) or LibRaw under its CDDL licence.
- The calibration shoot for film simulations (an afternoon with the camera; no cost). A ColorChecker
  target (~$100) would make the base colour measurably better: **a spend to approve**, optional.
- Model downloads on first use (~150–250 MB in total for all masks and Remove), kept on the phone.

## 11. Risks

- **Mali driver quirks and thermal throttling** on long exports: tiles keep each submit small; test on
  the A35 early.
- **Lightroom's slider feel is undocumented:** tuning against reference renders will take iterations.
- **Fuji's in-RAF lens data is only partly decoded:** measured profiles are the fallback.
- **Model licences change:** pin versions and keep each licence file with the model.
- **Memory on an 8 GB phone:** Chrome may kill a tab above ~1.5–2 GB; budgets per stage and tiling are
  the guard.

## Sources

Fuji compressed RAF decoder: LibRaw `src/decoders/fuji_compressed.cpp` (third-party-mirror.googlesource.com/libraw);
FujiFilm tags: exiftool.org/TagNames/FujiFilm.html; dnglab supported cameras (github.com/dnglab/dnglab);
dcraw (Markesteijn, licence note); pixls.us "x-veon" X-Trans demosaic thread; DNG specification patent
licence (Adobe); Adobe DNG SDK licence (scancode licensedb); dcamprof (GPL-3), ArgyllCMS (AGPL), ACES
(github.com/aces-aswf/aces, Apache-2.0); Fujifilm X-E5 LUT downloads (fujifilm-x.com); Aubry et al. 2014
"Fast local Laplacian filters"; Restormer, NAFNet, SCUNet, LaMa (Apache-2.0), MI-GAN weights (MIT) licence
files; lensfun (LGPL-3 / CC BY-SA 3.0); LSD on IPOL (AGPL-3); bm3d (non-commercial); EdgeSAM, RMBG-2.0,
MAT, SegFormer licences; MediaPipe image segmenter docs; WebGPU limits survey (web3dsurvey.com); Dawn
source (Mali workarounds); Chrome File System Access docs; Chrome Memory64 intent; raw.pixls.us
(Fujifilm X-H2, X-T5, X100VI samples, CC0).

**Colour check (2026-11-09).** `/lab/engine/` now compares each render with the camera's own JPEG on a
96 × 64 grid: the brightness gap in EV, then mean ΔE2000 once brightness is equalised. Measured here:
X-T5, PROVIA, ΔE 2.6; the X-H2 portrait sample, 4.1–8.3 across profiles. A +0.25 EV baseline plus
Fuji's DR setting (maker note 0x1403) keeps every file within ±0.17 EV of the camera. rawler reads no orientation from
a RAF, so it comes from the camera JPEG's Exif 0x0112. On the owner's A15, with a 46 MB X-E5 file:
decode 5.3 s, first developed image 6.9 s, frame 21 ms median.
