# The new photo engine: where it stands (2026-11-09)

A handoff for whoever picks this up next. The research and the owner's decisions are in
[ENGINE-RESEARCH.md](ENGINE-RESEARCH.md) (read its "Revised pipeline" section first), the design in
[../design/EDITOR.md](../design/EDITOR.md). The owner shoots a Fujifilm X-E5 (40 MP X-Trans 5, lossless
compressed RAF), edits on a Galaxy A15 now and an A35 next, and wants Lightroom quality or better.

## Live

- **`/lab/engine/`**: the engine test page. Open a RAF, load the owner's profile zip, pick a profile (Adobe
  Color by default) and move every Light and Color control. It shows the timings, the shot's film simulation
  and tones, and the colour check against the camera's own JPEG: brightness gap in EV, then ΔE2000. **Time the
  stages** prints what each stage of a frame costs on the phone in hand; the switches turn single stages off
  for comparing.
- **`/lab/editor/`**: the designed editor (its look is the owner's and stays as built). Library → Import copies
  RAFs onto the phone, a tile opens the photo, the dial drives Light and Color, and Looks lists the real
  profiles with thumbnails. Edits save as you go.

## How it works

| Stage | Where | What |
|---|---|---|
| Decode | `engine/raw/` (Rust, rawler 0.8) → `frontend/lab/engine/pkg*/` | RAF → sensor data → 3×3 X-Trans binned proxy (2576×1717), no demosaic. `pkg-threads/` is the rayon build, used when the page is cross-origin isolated (`isolate.js`; sw.js isolates `/lab/engine/` and `/lab/editor/`). On the A15: 2.5 s on 8 threads, 5.2 s on one |
| Metadata | `decode-worker.js` | Orientation and Fuji maker notes (film simulation, tones, colour, DR) from the camera JPEG's Exif. rawler reads no RAF orientation |
| Colour | `dcp.js`, `gpu.js` | DNG-spec camera profile: Forward/ColorMatrix blended by CCT, HueSatMap, exposure, LookTable, tone curve (ACR3 fallback), Adobe RGB-table looks. Temp/Tint use the DNG SDK convention |
| Highlights rebuilt | `wgsl.js` | A colour the sensor clipped is rebuilt from the channels that didn't clip (after darktable's "inpaint opposed"), before the camera profile |
| Highlights, Shadows | `mask.js`, `wgsl.js` `shade()` | Stops added by how bright the pixel's **area** is, not the pixel: the tone mask is a guided filter on log2 luminance at one eighth size (the idea is darktable's tone equalizer). Made once a photo, before the table |
| Contrast, Whites, Blacks | `wgsl.js` `tones()` | One curve over stops from middle grey. Contrast is its slope there; Whites and Blacks move the scene brightness that lands on white and on black. Hue-preserving. Our own tuning |
| Saturation, Vibrance | `wgsl.js` `vivid()` | Colour strength about the colour's own lightness in Oklab. Vibrance moves muted colours most and spares skin's hues; a strengthened colour eases off towards the sRGB edge. Our own tuning |
| GPU | `gpu.js` | WebGPU compute. Everything after Highlights and Shadows is baked into a 65³ rgba16f table (log2 shaper, tetrahedral lookup), re-made when the profile, Contrast, Whites, Blacks, Saturation or Vibrance changes. On the A15 a whole frame is 21 ms, 32 ms with Highlights or Shadows on |
| Profiles | `profiles.js` | The owner's private zip (Adobe Camera Matching DCPs + RGB-table looks, extracted from Camera Raw 18.4). Kept in IndexedDB on the phone. **Never commit them or serve them from the site: the repo is public** |
| Editor | `frontend/lab/editor/app/{store,session}.js` | OPFS for RAFs and their JPEGs, IndexedDB for records and edits. `session.js` owns the open photo, the canvas, the values and the dial maps. Boards are dc.js templates; `data-keep` marks the photo's slot |

Colour check, measured: ΔE 2.6–3.3 against the owner's camera JPEGs on the matching simulation, before
their recipe settings (highlight/shadow tone, colour) are applied.

## Next, in the order agreed with the owner

Light and Color are in, as first versions: the methods are ported plainly and the fine tuning waits for the
owner's eye on the phone. Still theirs to judge:

- How each slider feels, and how strong Whites should be.
- Saturation near +100 can clip a strong red to a flat patch: the look and the tone curve after it add colour
  its limit doesn't see. A gamut compression at the output would fix it, at the cost of changing the picture
  at rest against Adobe's.
- A roof in deep shade goes flat and salmon at Shadows +100. A local Laplacian filter is the upgrade if halos
  or flatness show.
- What a frame costs while Contrast, Whites, Blacks, Saturation or Vibrance moves (the table is re-made):
  "Time the stages" measures it; not yet read on the phone.

Then, each as its own merged and live-checked change:

1. Color extras: white balance presets, eyedropper, Auto, Reset.
2. Full resolution: X-Trans demosaic (vkdt's), 100 % zoom with a minimap, export Full and Small (JPEG, PNG,
   16-bit TIFF, metadata).
3. Viewing: histogram and clipping, before and after, history, versions.
4. Looks: Amount, "As shot", the camera's recipe settings, imports (`.xmp`, `.lrtemplate`, `.cube`, zip packs,
   recipe text), save current, search.
5. Detail (sharpening, noise reduction), Effects (clarity, dehaze, vignette, grain), Optics (distortion,
   vignetting, fringing).
6. Curve, Mixer, Grading; Crop; Masks (brush, linear, radial, colour and brightness range); Heal.
7. Library: ratings, flags, filters, culling, delete, storage readout, card and camera import.

Waiting on the owner: mask detection (which model, and its download size); calibration against Lightroom;
the profiles' home on the Worker behind sign-in; backups; replacing the old editor.

## Working rules learnt here

- Lab-only branches (every change under `frontend/lab/<page>/` or `engine/`) run the fast lab checks
  (`scripts/lab-scope.mjs`, about a minute). Merge PRs as merge commits: the deploy then skips re-testing.
- Check the live site yourself (`/release.json`'s commit) before telling the owner something is live.
- Test headless with `?readback` (SwiftShader can't present a WebGPU canvas). The public sample RAFs
  (raw.pixls.us, CC0) are not in the repo; fetch them.
- Every source file stays under 300 lines.
- Headless timings say nothing about stage costs (SwiftShader, and the readback dominates): the phone is the
  instrument. The first frame of a photo makes the table and is the pipelines' first run (about 200 ms on the
  A15); it is not what an edit costs.
- The colour table against the exact maths (the "exact" switch): mean ΔE2000 0.4 at rest, 0.8 at Saturation
  +100.
