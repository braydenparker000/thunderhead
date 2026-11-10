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
| Sharpening (Amount, Radius, Detail), Defringe, and noise reduction (Noise, Color noise) on the sensor's own pixels: 100 % and export | `finish.js`, `denoise.js`, `noise.js`, `full.js` |
| Effects: Clarity, Texture, Dehaze (each from a small mask, so they cost one lookup a pixel and match at every zoom) | `mask.js`, `haze.js`, `wgsl.js` main |
| Crop board: crop with aspect, straighten (and Auto level), quarter turns, flips, perspective (Vertical, Horizontal, Scale) | `crop.js`, `level.js`, `boards/CropPlate.js` |
| Full size: X-Trans demosaic (vkdt's) of the rectangle looked at, developed by the same frame pass | `demosaic.js`, `full.js` |
| Zoom on the Edit and View screens: free pinch from fitted to 300 %, drag, double-tap for 100 %; the percentage and a map while zoomed. On Masks and Heal: two fingers zoom and move the photo, one works the tool | `editor/app/zoom.js` (any slot marked `data-zoom`; `data-zoom="tool"` for a tool board) |
| Undo and history (every step keeps the whole edit), versions, saved with the edit | `editor/app/past.js`, `session.js` |
| View board: before/after against the photo as imported, histogram and clipping overlay | `boards/ViewTools.js`, `editor/app/scope.js`, `tiles.js` |
| Curve (RGB and each colour, over the photo's histogram), colour mixer (eight colours), grading (three ranges and the whole, Blending, Balance), Vignette, Grain | `grade.js`, `wgsl.js`, `boards/CurveOverlay.js`, `boards/GradeTrio.js`, `boards/EditPlate.js` |
| Looks board: `.cube` looks brought in and kept on the phone (Presets), an edit saved as a look of one's own (Mine), each tile this photo wearing it | `cube.js`, `editor/app/looks.js`, `boards/LooksPlate.js` |
| Masks board: a brush, linear and radial gradients laid on the picture, ranges of colour and of brightness picked with a tap; each with its own Light, Color and Effects adjustments, Amount, Invert; shown in red | `local.js`, `brush.js`, `wgsl.js` main, `editor/app/masks.js`, `boards/MaskPlate.js` |
| Heal board: Heal, Clone and Remove spots, each replaced from a source the engine picks nearby (it can be dragged); Size, Feather, Opacity; Visualize | `heal.js`, `mend.js`, `warp.js`, `demosaic.js`, `editor/app/heal.js`, `boards/HealPlate.js` |
| Library: tiles that show the edit, an Edited filter, what the photos take on the phone, deleting rejects for good | `boards/LibraryPlate.js`, `editor/app/store.js` |
| Export: Full or smaller, JPEG (bands joined by restart markers), PNG, 16-bit TIFF, Exif carried, output sharpening for Screen or Print | `export.js`, `files.js`, `exif.js`, `editor/app/save.js` |

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

## Steps 1 to 7 are done. What is left waits on the owner (8, 9) or was left out along the way

Three things left out of earlier steps, done after step 7 (all in the full-size finishing, so they show at 100 %
and in the export, not on the fitted photo):

- **Output sharpening** (Export › Output: No sharpen, Screen, Print; Amount Low, Standard, High). After the photo is
  brought to its export size, `export.js` `crisp` sharpens it once more on the way to the file: the same unsharp
  mask as the engine's at its smallest (the nine pixels around each), a row behind the rows it is given. On a
  2048 px export at Screen, Standard, fine detail goes from 0.0148 to 0.0184 with the mean colour unchanged.
  The Small preset starts at Screen, the Full one at none.
- **Defringe** (Optics, 0 to 100). `finish.js`: where brightness changes sharply and the pixel is purple or green
  (red and blue both over green, or green over both), its colour is drawn back to grey. On the sample's crane
  cable at 100 %, the purple at edges falls from 0.080 to 0.023. It cannot tell a purple thing from a purple
  fringe: at 100 a hard-edged purple object loses colour too.
- **A mask's own Sharpness** (Masks › Effects). The frame pass hands the masks' sum to the last pass in its fourth
  value (1 + the sum, for full-size views only: flag 524288); `finish.js` adds twice it to the photo's amount,
  and with less than none softens towards the blur. Noise for a mask is still not built (noise reduction runs
  before the frame pass, which is where masks are known).

Zoom on the tool boards (after step 7), for fine painting and for dust:

- A board whose one finger is a tool marks its slot `data-zoom="tool"`. There `zoom.js` hears gestures on the
  slot's parent (so they count wherever the fingers land), only two fingers zoom or move the photo, and there is
  no double-tap. Whatever the board marks `data-zoom-with` (the layer it lays over the photo: guides, rings, the
  touch surface) is given the photo's own shift and scale while fingers move; the board binds the same value
  (`zoom.transform()`) when it next draws, so the two agree.
- Because that layer is scaled with the photo, a touch read against its box on screen is already a place in the
  photo: the boards needed no other change to work zoomed. Lines keep their weight (`1 / zoom.mag()`), and the
  brush and a new spot keep their size on screen, so zooming in makes them finer on the photo.
- A touch of the tool waits for the finger to move or lift (a range's pick, a brush's first dab, a new heal
  spot): a second finger landing first makes it a pinch, and nothing is painted or retouched.
- At 40 % and up the sensor's own pixels are drawn at rest as on the Edit board, masks, red overlay and retouch
  included.
- Fixed on the way: a photo zoomed before its sensor pixels had reached the GPU (a second or so after it opens)
  stayed without detail until the next gesture; `zoom.js` now draws it when they arrive. And an error while
  drawing detail is logged, not swallowed.


Step 7, retouching (`engine/heal.js` for the maths, `mend.js` for the rule the two passes share):

- **A spot is replaced by another place in the photo, on the sensor's own values, before anything else sees
  them.** There are two places a photo's pixels enter the pipeline, and both follow the one rule: the editing copy
  as it is laid out as the picture (`warp.js`, where it reads a source pixel), and full resolution as it is made
  from the sensor (`demosaic.js`, where it reads a site). So a retouch is there at every zoom, in every tile, in
  the masks made from the picture, and in the export; at 100 % the sensor's pixels match the editing copy inside
  a spot as well as outside it (0.8 of a level, the same as anywhere).
- The source is a whole number of the sensor's colour pattern away (6 pixels: 2 of the editing copy's), so each
  site takes a site of its own colour. Each pass first notes which spots are near the pixel it is making (a
  bit each, `nearby`); a pixel near none, which is nearly all of them, pays nothing more.
- **Clone** copies the source as it is. **Heal** and **Remove** also bring it to what surrounds the spot: sixteen
  samples of the editing copy round the spot and round the source give, for each colour, the stops to add at the
  centre and across and down (a tilted plane), so a source from brighter sky comes in at the spot's own
  brightness. Remove differs from Heal only in looking further afield for its source.
- `findSource` picks the source: of 48 or 72 places round the spot, the one whose surroundings are most like
  the spot's own once that plane is allowed for. It can be dragged anywhere.
- A spot is kept in mask units (as masks are) with its tool, feather and opacity, in the edit's `spots`; the
  engine gets them with the geometry (`setGeometry({ spots })`), so a change lays the picture out again (once, not
  each frame). 32 spots at most.
- Limits, said plainly: spots do not build on each other (each reads the photo as shot, so a spot laid over
  another's result does not see it); Heal matches brightness and colour as a plane, not the full blend Lightroom
  solves for, which shows only where the surroundings change sharply across the spot; Remove is not content-
  aware fill. A feathered edge fades over at most the outer 0.62 of the radius.
- On the board: a tap makes a spot with the chosen tool; the red ring is the chosen spot, the dashed ring its
  source; the dial sets Size, Feather and Opacity for the chosen spot and the next; Visualize is the design's
  high-contrast view of the photo; UNDO SPOT and CLEAR ALL.


Step 6b, the brush (`engine/brush.js`):

- A brush mask's weight is painted. A stroke is kept as the points the finger went through, in mask units,
  with the brush it was made with (radius, feather, flow, erase) and an id. `lay()` puts it down as soft round
  dabs a quarter of a radius apart: add lays weight on (flow at a time, so slow passes build up), erase takes
  it off. The dabs fall in the same places whether a stroke is laid at once or as it grows, so painting live
  and drawing again after Undo or a reload give the same picture (checked: 0 difference).
- The weights live in one texture, four layers of 1024 on the long side (`r8unorm`, 2.8 MB), made when a photo
  first has a brush mask; the frame pass reads a layer between its four nearest values (binding 9). The CPU
  keeps each layer in 16 bits so low flow adds up. `sync()` carries a grown stroke on from where it stood and
  sends only the rectangle touched; anything else (Undo, another photo's masks) is laid again from nothing.
- A photo takes four painted masks (of its eight). Size, Feather and Flow are the brush's, kept by the board,
  not the edit: they shape the next stroke. A stroke is one step of the history. RESET MASK clears the paint.
- History steps share what was painted (`past.js` `copy` no longer deep-copies a mask's points: `masks.js` never
  changes them in place), and IndexedDB stores shared arrays once.


Step 6a, masks (`engine/local.js` is the place to read first):

- **A mask is a weight, 0 to 1, for each place in the picture.** Linear: in full at its first line, gone by its
  second (Feather is how much of the way between them the fade takes). Radial: in full inside, fading out to
  its rim. Colour range and brightness range: how near the place's own colour or lightness is to what a tap
  picked (Range is how near counts, Feather how softly it ends). Amount scales it; Invert turns it round.
- **Its adjustments are added to the photo's own, pixel by pixel, in the frame pass** (`wgsl.js` `main`,
  `locals()`): exposure, highlights, shadows, texture, clarity and dehaze are added to the photo's values before
  those stages run; white balance (Temp, Tint) is a gain on each colour; contrast, whites and blacks are the
  photo's own curve (`tones`) laid on with the mask's numbers; saturation and hue turn and scale the colour in
  Oklab. Nothing is in the colour table, so a mask costs one sum a pixel, and 100 % and export match the screen
  (checked: three masks on a cropped, straightened, tilted photo, within one level).
- **Where a mask lies is kept in mask units**: the upright, uncropped picture, in units of its width. The frame
  carries one 3 × 3 from the picture as shown to those units (`toMask`: the crop's own matrix and enlargement,
  the same numbers `warp.js` uses; checked against `toSensor` to 0.0000 px over turned, flipped, cropped and
  tilted pictures). Crop or turn the photo and the mask stays on what it was laid on.
- Range masks read the pixel before the photo's own exposure and tone (at the shot's base exposure), so moving
  Exposure does not move what they select. Colour is compared as Oklab a and b over lightness, which does not
  change with brightness. `engine.toneAt` reads the same from the editing copy for the tap.
- The settings block is now 3632 bytes (`wgsl.js` `USIZE`): after the curve come `mh` (the 3 × 3), `mi` (how
  many masks, the one shown in red, the base stops) and `mk` (seven rows a mask, eight masks at most).
- The edit holds `masks` (kind, number, values, invert, where it lies or what it picked), part of history and
  versions. A saved look does not carry masks.
- On the board: with a photo open the add menu offers Linear, Radial, Color, Luminance. A gradient is taken
  hold of on the photo: a linear one by either end or its middle, a radial one by its middle (move) or rim
  (size; along one axis near that axis's end). A range mask takes a tap. OVERLAY lays the chosen mask over the
  picture in red (drawn by the engine, so it is the real weight); it comes off while the dial turns. The red
  only shows in the Masks board's slot (`data-masks`), never in a tile or a file.
- Not built: detection (Subject, Sky …: step 9), Noise for a mask, more than eight masks.
- Strengths are first guesses: Temp ±100 is ±0.35 stops on red against blue, Hue ±100 is ±180°.


Step 5, looks kept on the phone (`editor/app/looks.js`, their own IndexedDB database `th-looks`):

- **`.cube` looks.** IMPORT › Files reads `.cube` files (`cube.js`: 3D tables up to 65 a side, values 0 to 1) and
  says, file by file, what was added and why another was not. They show under PRESETS, each tile this photo
  wearing it. One can be on a photo at a time, on top of the film simulation and every slider: a tap puts it
  on, a tap on the one that is on takes it off, the dial sets its amount (0 to 150 %). The edit holds its id
  (`cube`) and amount (`Cube`). In the engine it is one more stage inside the colour table, on the finished
  sRGB value just before the point curve (flag 262144; its size in `size.z`, where the unused quarter-turn was;
  its place in the table buffer in `tab.w`; its amount in `air.w`). These files are nearly always made for a
  finished sRGB picture; one made for log video will look too strong, and nothing in the file says which.
- **Looks of one's own.** MINE › Save current asks for a name and keeps the whole edit. Putting one on brings
  everything but what is the photo's own: exposure, white balance, lens corrections, crop. DELETE (two taps)
  removes a look kept on the phone.
- With a photo open PRESETS and MINE show only what is really there. RECIPES still plays the design's samples
  (step 8), and the Amount dial does nothing for a look of one's own.
- Not done: search (it earns its place once preset packs can be read, step 8), `.xmp`, `.lrtemplate`, `.zip`.
- A bug this turned up, fixed: a tile drawn off screen used to put its own edit in the photo's place while the
  GPU worked, so a tap that landed meanwhile was lost when the photo's edit was put back. Now the frame is sent
  and the photo's edit restored in the same breath (`session.js` `unseen`): nothing can run in between.


Step 5, the colour tools. None of them costs anything per frame:

- **Mixer, grading and the point curve are inside the colour table** (`wgsl.js` `develop`, text in `grade.js`
  `TOOLS`). The mixer works in Oklab: each of eight colours has a place round the hue circle, a pixel takes
  a share of the two its hue lies between, and greys are left alone. Grading adds a tint (the wheel's hue as a
  direction in Oklab, times its saturation) and a brightness change for shadows, midtones and highlights by
  brightness, with Blending (how wide the ranges overlap) and Balance (where they meet), and once for the whole.
  The point curve is the last thing in the table, on the finished value: one curve for all three colours, then
  one for each, through the same monotone cubic the board draws (128 samples a curve in the settings).
- The settings block grew to 2672 bytes: `mx` (8 rows), `gr` (5 rows), `crv` (128 rows); flags 32768, 65536,
  131072 switch each on. `grade.js` turns the photo's values and curve points into those rows; a null means off.
- **Vignette and grain are in the frame pass**: the vignette before the table (so it darkens like exposure), by
  the pixel's place in the cropped picture; grain after it, a speck for about 1.5 sensor pixels, so it looks
  the same at every zoom and in the file.
- The edit holds the new values under names: `Mix <Colour> Hue|Sat|Lum`, `Grade <Zone> Hue|Sat|Lum`, `Blending`,
  `Balance`, and `curve` (points for RGB, R, G, B; null while straight), each part of history and versions.
- On the Edit board: Mixer and Grading under Color, Curve under Light. The dial turns the chosen mixer value,
  the chosen range's brightness, Blending or Balance, and in Curve lifts the point last touched. A section's
  count includes them.
- The wheels and the curve read a touch by their own size on screen: the page is scaled to the phone
  (`boot.js`), so design pixels are not screen pixels. (The Masks and Heal boards did; fixed as
  each was made real.)
- Checked through the board on a landscape and a portrait sample (each control changes the photo the right
  way, one history step a gesture, Reset puts the picture back exactly, a reload keeps it), and an export
  with everything on matches the screen to about one level in every patch.
- Strengths are first guesses for the owner's eye: grading's tint at full saturation is 0.08 in Oklab, the
  mixer turns a hue up to 29°, the vignette reaches two stops at the corners.


Step 4, the Library. Ratings, flags, filters, sorting and culling were already real. Added:

- A photo's tile is its edit: 1.5 s after the last change the session keeps a 480 px JPEG of it in OPFS
  (`thumb/<id>.jpg`) and marks the record `edited`; back as imported, the tile is the camera's JPEG again.
- The subtitle shows what the site keeps on the phone (`navigator.storage.estimate()`).
- Deleting: the design has no delete control, so the Rejects filter's subtitle is the control. It reads
  "N rejects · tap here to delete them"; a first tap asks, a second within 5 s deletes the RAF, its JPEGs, its
  record and its edit. Not shown while culling mode is on.
- "From a card or the camera" opens the same file picker (it can browse a card); "Watch a folder" says it
  is not possible yet in Chrome on Android.

Not done: camera import over USB (the plan leaves it out), and nothing renames or moves a photo.

Step 3 turned out to be two different machines, not one:

- **3a, done: Clarity, Texture, Dehaze.** No full-size filtering. `mask.js` makes three small guided-filter
  masks from the picture: the tone mask (cells of 8, also Highlights and Shadows), a finer one (cells of 4) and
  a haze mask (the dark channel, He et al., as in darktable's haze removal; the air's colour from `haze.js`).
  The frame pass reads them per pixel: Clarity and Texture scale what a pixel adds to its area's brightness,
  Dehaze takes the air's share out. Because the masks are picture-sized and tiny, 100 % views and export get
  the same result by the same lookup. Strengths are first guesses for the owner's eye (Dehaze was halved after
  +100 turned skies purple).
- **3b, sharpening: done.** Every full-size view now runs the frame pass into a 16-bit float texture and a last
  pass (`finish.js`) that sharpens and dithers: an unsharp mask on brightness (Amount, Radius, Detail). The
  editing copy is never sharpened (a third of the size: it would not show). Export develops each tile 4 px
  past its edges so both sides of a join see the same neighbours. On a sample at 100 %, fine detail
  (Laplacian spread) is 10 unsharpened, 15 at the default, 21 in the camera's own JPEG.
- **3b, noise reduction: done**, at full size only, in `full.js`'s region path between the demosaic and the warp,
  cached with the demosaic (it runs when the rectangle or its two sliders move, not per frame). Values are
  first rescaled by the sensor's noise at the shot's ISO (`noise.js`: darktable's own X-E5 profile; ISO from
  the camera JPEG's Exif) so that noise is size 1 everywhere: thresholds are then in "times the noise", and a
  low-ISO photo passes untouched (62 dB against itself at the default). Colour noise: a guided filter of the
  colour differences by brightness over cells of 8; brightness noise: an edge-stopping blur in two steps
  (`dm.out` to a second buffer and back, so the warp's source never changes). A sensor rectangle is drawn 36 px
  past what the picture needs, for the neighbourhoods.
- Tested by adding the profile's ISO 6400 noise to a clean photo's sensor data: 38.3 dB unfiltered, 39.2 at the
  default (Color noise 25), 40.5 with Noise 50 as well. Past Color noise 50 or Noise 50 it gives detail away
  faster than it removes noise. No real high-ISO RAF was at hand: the owner's own are the real test.
- Left out of step 3 then, done since (above): export's output sharpening and Defringe.
- The dial's window spans the real range of controls that don't run −100..100 (`adjust.js` `SPAN`).

How geometry works (step 2a), for whoever touches it:

- `warp.js` runs once whenever the geometry changes, never per frame: it writes `flat`, a copy of the photo
  already laid out as the picture (upright, lens faults undone), in the editing copy's packed form. The frame
  pass, the tone mask and the 3D table are unchanged and read `flat` one pixel for one.
- From a picture point back to the sensor: crop centre and straighten angle, the perspective's 3 × 3, flips,
  quarter turns, then the lens table (`lens.js`) once for each colour. `toSensor()` is the same maths in JS;
  `reach()` gives the sensor rectangle a rectangle of the picture draws on.
- The crop (`crop.js`) is the Crop board's own model: the picture in a box, turned, tilted as seen from a fixed
  distance, flipped, enlarged until the frame is covered. `frame()` turns it into one 3 × 3 (box to picture) and
  an enlargement; `geometry()` hands those to the pass. The board previews with the design's CSS transform from
  the same numbers: preview and engine agree to about a pixel in 640.
- While the Crop board is up (its slot is `data-base`) the engine shows the picture uncropped; the crop is laid
  out when another board's slot takes the photo.
- A crop changes the picture's size: `gpu.js` `lay()` makes `flat`, `out`, the tone mask and the readback
  buffer anew, and the canvas takes the size at the next shown frame. `full.js` reads the size from the
  geometry each time.
- Lens data: a RAF's raw directory 0xf000 holds 0xf00b (distortion), 0xf00f (fringing), 0xf010 (brightness);
  the method is darktable's "embedded metadata" correction. Checked against the camera's JPEG on an 18 mm
  shot: patches were off by a mean of 4.3 px (of 1288) without it, about 0.5 with.
- Corner gain can exceed 1, so `flat` is stored divided by the largest gain and the frame pass multiplies it
  back (`wb.w`).
- A full-size view draws on more of the sensor than itself (lens stretch, margin, above all a straighten
  angle). Its demosaic buffers hold 1.6 times its pixels in any shape; `view.room()` is the largest rectangle
  that always fits, and zoom and export step by it.
- Export develops each band in tiles (`room()` of 1024 × 256), so a straightened band doesn't draw on a huge
  sensor rectangle.
- Not handled: Fuji's 1.25× crop modes (darktable scales the table by 1.25 for them).

Left for later in step 2: Upright (automatic perspective) reads "LATER"; every Crop control is a history step
named just "Crop"; a small picture with another crop (a version's tile) lays the whole editing copy out again
the fine way (use `draft` for tiles if that proves slow on the phone).

Every check script runs on a portrait sample too: #98 shipped a pass sized by the sensor, not the picture,
and only a portrait photo showed it (fixed in #99).

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
- Never leave the photo's edit swapped for another across an `await`: taps arrive in between. Off-screen
  pictures go through `session.js` `unseen`, which restores it before returning.
- The page is scaled to the phone (`boot.js`): a board that reads a touch must divide by its own size on screen,
  not assume design pixels.
- Headless Chrome draws each off-screen picture in about 3 s (a phone's GPU: a fraction of that): a check
  script must wait for what it reads, not for a fixed time (`session.busy()` says whether a frame is still owed). A tile's `img` holds the camera's JPEG (also a
  `blob:`) until its own picture is made.

## What is left, and who it waits on

Left out on purpose or not reached, none of it blocking:

- Upright (Crop reads LATER) and Fuji's 1.25× crop modes; Crop's history steps are all named "Crop".
- Noise for a mask; detection masks (Subject, Sky, Background, People, Object).
- Search on the Looks board; `.xmp`, `.lrtemplate` and `.zip` looks; recipes (the board still shows samples).
- Watermark and Display P3 on export; camera import over USB; renaming or moving a photo.
- Retouch spots that build on each other; a true content-aware Remove.
- `docs/engineering/ENGINE-STATUS.md` is out of date: this file replaced it. A pointer from the docs is owed (a
  docs change runs the full test suite, so it goes in a change of its own).

Step 8 (sliders that answer like Lightroom's, then `.xmp` presets and recipes) needs the owner's reference
exports from Lightroom. Step 9 is the owner's decisions: detection models, Auto white balance, profiles on their
Worker, backups, replacing the old editor.

## Waiting on the owner

Everything since step 1 was checked in headless Chrome on a software GPU, never on the phone. What only the owner
can tell:

- **Speed and memory on the A15.** How long a photo takes to open, how the dial feels, how long 100 % and an
  export take, and whether the tab ever reloads (a photo keeps about 80 MB on the GPU for its sensor pixels, 35 MB
  for the editing copy, and each full-size view its own buffers).
- **How the controls feel.** Every strength is a first guess: Clarity, Texture, Dehaze, Sharpening, the two Noise
  sliders, the mixer, grading, vignette, grain, the masks' Temp and Hue, Defringe, the heal's feather.
- **Touch.** The pinch, painting a mask, laying a gradient, dragging a heal source, two fingers against one on
  the Masks and Heal boards: all were driven by synthetic events here.
- **Their own photos.** High-ISO RAFs for noise reduction, a dusty sky for heal, a backlit edge for Defringe,
  five or six RAFs they would really edit.
- Whether the Library's delete (the Rejects subtitle, two taps) is acceptable or wants a real button.
