# The photo editor: status and plan

The working note for whoever continues (a person, or an agent after its context was compacted). Read this
first, then [../../docs/engineering/ENGINE-RESEARCH.md](../../docs/engineering/ENGINE-RESEARCH.md) for the reasoning.
It lives in `engine/raw/`, not under `docs/`, so that updating it stays a lab-only change (the fast checks:
`scripts/lab-scope.mjs` counts only `frontend/lab/<page>/` and `engine/<crate>/`).
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
| Geometry: one pass lays the photo out as the picture; the lens's own corrections (distortion, fringing, darkened corners) from the RAF; Distortion and Vignetting by hand | `warp.js`, `lens.js` |
| Full size: X-Trans demosaic (vkdt's) of the rectangle looked at, developed by the same frame pass | `demosaic.js`, `full.js` |
| Zoom on the Edit and View screens: free pinch from fitted to 300 %, drag, double-tap for 100 %; the percentage and a map while zoomed | `editor/app/zoom.js` (any slot marked `data-zoom`) |
| Undo and history (every step keeps the whole edit), versions, saved with the edit | `editor/app/past.js`, `session.js` |
| View board: before/after against the photo as imported, histogram and clipping overlay | `boards/ViewTools.js`, `editor/app/scope.js`, `tiles.js` |
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

## Steps 1 and 2a are done. Next: step 2b (the Crop board)

How geometry works (step 2a), for whoever touches it:

- `warp.js` runs once whenever the geometry changes, never per frame: it writes `flat`, a copy of the photo
  already laid out as the picture (upright, lens faults undone), in the editing copy's packed form. The frame
  pass, the tone mask and the 3D table are unchanged and read `flat` one pixel for one.
- From a picture point back to the sensor: crop centre and straighten angle, the perspective's 3 × 3, flips,
  quarter turns, then the lens table (`lens.js`) once for each colour. `toSensor()` is the same maths in JS;
  `reach()` gives the sensor rectangle a rectangle of the picture draws on.
- The uniform and the shader already carry crop, angle, perspective and flips; `geometry()` still fills them
  with "none". Step 2b sets them, and must then resize `flat`, `out`, the canvas and the tone mask (they are
  made once per photo at the uncropped size today), and tell `full.js` the picture's new size.
- Lens data: a RAF's raw directory 0xf000 holds 0xf00b (distortion), 0xf00f (fringing), 0xf010 (brightness);
  the method is darktable's "embedded metadata" correction. Checked against the camera's JPEG on an 18 mm
  shot: patches were off by a mean of 4.3 px (of 1288) without it, about 0.5 with.
- Corner gain can exceed 1, so `flat` is stored divided by the largest gain and the frame pass multiplies it
  back (`wb.w`).
- A full-size view draws on more of the sensor than itself: its demosaic buffer is a quarter larger each way.
  A strong straighten will need more than that (grow it in 2b).
- Export develops each band in tiles of 2048, so a straightened band doesn't draw on a huge sensor rectangle.
- Not handled: Fuji's 1.25× crop modes (darktable scales the table by 1.25 for them).

Step 2b, the Crop board (`boards/CropPlate.js` is still the design's sample): crop with aspect, straighten
(±45°, Auto), quarter turns and flips, perspective (Vertical, Horizontal, Scale, Upright). Draw the editing
copy with `fine = false` (two-tap, no fringing pass) while a control moves, fine at rest.

How zoom works, for whoever touches it:

- `zoom.js` owns what is inside a `data-keep="photo" data-zoom` slot: a wrap (moved and scaled by a transform)
  holding the editing copy and two detail canvases, plus the badge and the map. Boards don't draw any of it.
- Nothing renders while fingers move. At rest: below 40 % nothing more; 40 % to 100 % the sensor's pixels in
  tiles onto a 2D canvas (the view holds one screenful, so memory is flat); from 100 % one live pass on the
  view's own canvas, which then follows the engine's frames.
- Detail canvases are placed by a transform from their own pixel size. A laid-out size is rounded to 1/64
  pixel, which the wrap's scale turned into a blur at 100 %.
- The browser's own pinch zoom is off over the app (`touch-action` on `#frame`), and `boot.js` sizes the app from
  the layout, not from a magnified visual viewport.
- `tiles.js` makes every small picture (look tiles, version tiles, the map, the photo as imported) through
  `session.picture()`, off screen.

Not done in step 1, on purpose: a long press on Undo does not open History; the 40 % threshold and the snap
to 100 % are first guesses for the owner's hand.

Check script (not in the repo): import a RAF, pinch to 55 %, 100 %, 300 %, compare the detail canvas with the
editing copy under it, move a slider at 100 %, Undo, then the View board's before/after, histogram, history
and versions, and a reload. Sample pages `/lab/editor/viewing/` and `/lab/editor/export/` must still play.

## How to work here

- The owner wants it lean: one PR per step (two only if half a step is usable alone), lab checks only, no
  parallel helper agents, short reports. Each PR updates this note.
- Lab-only changes (`frontend/lab/`, `engine/`) run the fast checks: `npx tsc && node scripts/contract.mjs
  --check && node scripts/stage.mjs "$(git rev-parse HEAD)"`, then `node --test tests/lab-scope.test.mjs
  tests/site.test.mjs tests/sw-browser.test.mjs`. `node scripts/lab-scope.mjs origin/main` must print `lab`.
- Merge PRs as merge commits. Check `/release.json` and the served files before saying something is live.
- Headless: Chromium with `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`, the page with `?readback`.
  Its timings mean nothing; the phone is the instrument. Public sample RAFs (raw.pixls.us) are not in the repo.
- Every source file stays under 300 lines. The dial's adjustments live in `editor/app/adjust.js`; `session.js`
  hands them on as its own (a deliberate import cycle: `adjust.js` must not use anything of `session.js` at its
  top level).
- Port methods plainly from open work (darktable, RawTherapee, vkdt); the fine tuning waits for the owner's eye.

## Traps met

- The engine's colour table is re-made only by a render. Anything that draws without one (export's bands) must
  call `session.settle()` first, or it inherits whatever a look's tile last baked.
- `dc.js` patches by position: an element marked `data-keep` is filled by the app and never patched inside.
- A view's `region()` draws with the last shown frame's settings; `place()` waits for the next render.

## Waiting on the owner

How the sliders feel; how the zoom feels (smoothness of the pinch, how long detail takes to land at 50 % and at
100 %); how fast export is on the A15, and whether the tab ever reloads (a photo keeps about 80 MB more on the
GPU); five or six of their own RAFs to test on, if they want to share them.
