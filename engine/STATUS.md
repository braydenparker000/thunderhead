# The photo editor: status and plan

The working note for whoever continues (a person, or an agent after its context was compacted). Read this
first, then [../docs/engineering/ENGINE-RESEARCH.md](../docs/engineering/ENGINE-RESEARCH.md) for the reasoning.
It lives here, not under `docs/`, so that updating it stays a lab-only change (the fast checks).
`docs/engineering/ENGINE-STATUS.md` is older (it stops before white balance presets); this note replaces it.

The owner shoots a Fujifilm X-E5 (40 MP X-Trans, lossless RAF) and edits in Chrome on a Galaxy A15 (4 GB,
Mali-G57), an A35 next. This is their main editor for months without a computer. They want Lightroom quality.
The editor's look (the camera-plate boards) is approved and stays as built.

## Live

| What | Where |
|---|---|
| Decode on every core, 3×3-binned editing copy, the sensor's own pixels for full size | `engine/raw`, `frontend/lab/engine/decode-worker.js` |
| Colour: Adobe camera profiles and looks (the owner's private zip, in IndexedDB; never commit or serve them) | `dcp.js`, `gpu.js`, `profiles.js` |
| Light and Color sliders, white balance presets, eyedropper, Auto tone, Reset | `wgsl.js`, `mask.js`, `auto.js`, `editor/app/session.js` |
| Full size: X-Trans demosaic (vkdt's) of the rectangle looked at, developed by the same frame pass | `demosaic.js`, `full.js` |
| 100 % view (View board; fit or 100 % only, being reworked in step 1) | `editor/app/zoom.js`, `boards/ViewTools.js` |
| Export: Full or smaller, JPEG (bands joined by restart markers), PNG, 16-bit TIFF, Exif carried | `export.js`, `files.js`, `exif.js`, `editor/app/save.js` |

## The plan, in order (agreed with the owner 2026-11-10)

Steps are grouped by the engine machinery they share, so each is built once.

| # | Built once | Features | Needs |
|---|---|---|---|
| 1 | No engine work | Free pinch zoom to 300 % on Edit and View; Undo and history; before/after; histogram and clipping; versions | |
| 2 | One resampling stage; sensor and cropped coordinates | Lens corrections from the RAF's own data (distortion, fringing, vignetting); crop, aspect, straighten, rotate, flip, perspective | |
| 3 | One stage for filters that read neighbouring pixels, at editing and full size | Sharpening, noise reduction, texture, clarity, dehaze, defringe; export sharpening | Then the owner's "Time the stages" readout on the A15 |
| 4 | Nothing in the engine | Library: delete, ratings, flags, filters, storage readout, thumbnails showing the edit | Can jump the queue |
| 5 | Nothing new: all inside the colour table | Curve, colour mixer, grading, vignette, grain; save a look, `.cube` looks, search | |
| 6 | Mask layers in sensor coordinates, per-mask adjustments | Brush, linear, radial, colour range, brightness range | After 2 |
| 7 | A retouch pass on the sensor data; the brush from 6 | Heal, clone, remove | After 6 |
| 8 | A calibration fit | Sliders that answer like Lightroom's; then `.xmp` presets and the camera's recipe settings | Reference exports from the owner |
| 9 | The owner's decisions | Subject and sky detection, Auto white balance, profiles on their Worker, backups, replacing the old editor | The owner |

Left out unless asked for: `.lrtemplate` and preset packs, recipe text, camera import over USB, watermark, Display P3.

## Step 1: what was decided

- Zoom is on the Edit screen too (the owner pinched there and Chrome zoomed the page, which the app's fit code
  then fought). Stop the browser's own zoom over the app; the fit code must ignore page magnification.
- Free pinch from fit to 300 %; double-tap jumps between fit and 100 %; the badge shows the percentage; a pinch
  ending near 100 % snaps to it.
- Nothing renders while fingers move: the picture on screen is moved and scaled (a transform). Detail is drawn
  once the gesture stops.
- Up to about 40 % the editing copy is what shows (it is a third of the sensor's size, so sharp to 33 %).
  From 40 % to 100 % the sensor's pixels are drawn in a few passes after the gesture stops (memory stays one
  screenful); a slider dragged there shows the editing copy until released. From 100 % up, one pass, and
  sliders update the real pixels live.

## How to work here

- The owner wants it lean: one PR per step (two only if half a step is usable alone), lab checks only, no
  parallel helper agents, short reports. Each PR updates this note.
- Lab-only changes (`frontend/lab/`, `engine/`) run the fast checks: `npx tsc && node scripts/contract.mjs
  --check && node scripts/stage.mjs "$(git rev-parse HEAD)"`, then `node --test tests/lab-scope.test.mjs
  tests/site.test.mjs tests/sw-browser.test.mjs`. `node scripts/lab-scope.mjs origin/main` must print `lab`.
- Merge PRs as merge commits. Check `/release.json` and the served files before saying something is live.
- Headless: Chromium with `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`, the page with `?readback`.
  Its timings mean nothing; the phone is the instrument. Public sample RAFs (raw.pixls.us) are not in the repo.
- Every source file stays under 300 lines. `editor/app/session.js` is at the limit: split it before adding.
- Port methods plainly from open work (darktable, RawTherapee, vkdt); the fine tuning waits for the owner's eye.

## Traps met

- The engine's colour table is re-made only by a render. Anything that draws without one (export's bands) must
  call `session.settle()` first, or it inherits whatever a look's tile last baked.
- `dc.js` patches by position: an element marked `data-keep` is filled by the app and never patched inside.
- A view's `region()` draws with the last shown frame's settings; `place()` waits for the next render.

## Waiting on the owner

How the sliders feel; how fast 100 % and export are on the A15, and whether the tab ever reloads (a photo now
keeps about 80 MB more on the GPU); five or six of their own RAFs to test on, if they want to share them.
