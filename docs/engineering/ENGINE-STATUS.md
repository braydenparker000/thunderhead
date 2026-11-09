# The new photo engine: where it stands (2026-11-09)

A handoff for whoever picks this up next. The research and the owner's decisions are in
[ENGINE-RESEARCH.md](ENGINE-RESEARCH.md) (read its "Revised pipeline" section first), the design in
[../design/EDITOR.md](../design/EDITOR.md). The owner shoots a Fujifilm X-E5 (40 MP X-Trans 5, lossless
compressed RAF), edits on a Galaxy A15 now and an A35 next, and wants Lightroom quality or better.

## Live

- **`/lab/engine/`**: the engine test page. Open a RAF, load the owner's profile zip, pick a profile, move
  Exposure and Contrast. It shows the timings, the shot's film simulation and tones, and the colour check
  against the camera's own JPEG: brightness gap in EV, then ΔE2000.
- **`/lab/editor/`**: the designed editor (its look is the owner's and stays as built). Library → Import copies
  RAFs onto the phone, a tile opens the photo, the dial drives Light and Color, and Looks lists the real
  profiles with thumbnails. Edits save as you go.

## How it works

| Stage | Where | What |
|---|---|---|
| Decode | `engine/raw/` (Rust, rawler 0.8) → `frontend/lab/engine/pkg*/` | RAF → sensor data → 3×3 X-Trans binned proxy (2576×1717), no demosaic. `pkg-threads/` is the rayon build, used when the page is cross-origin isolated (`isolate.js`; sw.js isolates `/lab/engine/` and `/lab/editor/`). On the A15: 2.5 s on 8 threads, 5.2 s on one |
| Metadata | `decode-worker.js` | Orientation and Fuji maker notes (film simulation, tones, colour, DR) from the camera JPEG's Exif. rawler reads no RAF orientation |
| Colour | `dcp.js`, `gpu.js` | DNG-spec camera profile: Forward/ColorMatrix blended by CCT, HueSatMap, exposure, LookTable, tone curve (ACR3 fallback), Adobe RGB-table looks. Temp/Tint use the DNG SDK convention |
| Controls | `gpu.js` `lights()` | Highlights/Shadows/Whites/Blacks, Saturation and Vibrance: **placeholders** (global, mine). Contrast is a power curve around middle grey: also a placeholder |
| GPU | `gpu.js` | WebGPU compute. Everything after exposure is baked into a 48³ rgba16f LUT (log2 shaper), re-baked when a tone or colour control changes. A frame is one lookup: 20–30 ms on the A15 |
| Profiles | `profiles.js` | The owner's private zip (Adobe Camera Matching DCPs + RGB-table looks, extracted from Camera Raw 18.4). Kept in IndexedDB on the phone. **Never commit them or serve them from the site: the repo is public** |
| Editor | `frontend/lab/editor/app/{store,session}.js` | OPFS for RAFs and their JPEGs, IndexedDB for records and edits. `session.js` owns the open photo, the canvas, the values and the dial maps. Boards are dc.js templates; `data-keep` marks the photo's slot |

Colour check, measured: ΔE 2.6–3.3 against the owner's camera JPEGs on the matching simulation, before
their recipe settings (highlight/shadow tone, colour) are applied.

## Next, in the order agreed with the owner

1. **The highest-quality editing pipeline**, replacing the placeholders. The owner's direction is open methods
   (darktable, RawTherapee, vkdt) with our own tuning, felt on the phone:
   - Highlights and Shadows: darktable's tone equalizer, or a local Laplacian filter (fast local Laplacian).
     Edge-aware, at proxy resolution, on the GPU, before the LUT.
   - Whites, Blacks and Contrast: a filmic or sigmoid-style scene-to-display mapping that cooperates with
     the profile's tone curve.
   - Vibrance and Saturation in a perceptual space (e.g. darktable's colour balance rgb).
2. Full-resolution demosaic (vkdt's X-Trans), 100 % zoom tiles, and banded export (Full and Small).
3. The camera's recipe settings, Fuji extras, and imports (XMP presets, film recipes).
4. Detail (sharpening, denoise), Effects (clarity, dehaze, grain), Optics (lensfun), curves, mixer, grading,
   crop, masks, heal, versions.
5. Calibration against Lightroom (Adobe Color as the base; slider feel); profiles on the Worker behind
   sign-in; backups; replacing the old editor.

## Working rules learnt here

- Lab-only branches (every change under `frontend/lab/<page>/` or `engine/`) run the fast lab checks
  (`scripts/lab-scope.mjs`, about a minute). Merge PRs as merge commits: the deploy then skips re-testing.
- Check the live site yourself (`/release.json`'s commit) before telling the owner something is live.
- Test headless with `?readback` (SwiftShader can't present a WebGPU canvas). The public sample RAFs
  (raw.pixls.us, CC0) are not in the repo; fetch them.
- Every source file stays under 300 lines.
