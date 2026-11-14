# The photo editor: status and plan

The working note for whoever continues (a person, or an agent after its context was compacted). Read this
first, then [../../docs/engineering/ENGINE-RESEARCH.md](../../docs/engineering/ENGINE-RESEARCH.md) for the reasoning.
[REVIEW.md](REVIEW.md) (2026-11-11) is the talk with the owner about how good the editor is, what the forums and the
science say is best, and what would close the gaps.
[ROADMAP.md](ROADMAP.md) is the road agreed from there to the end game: **work through it in order**.
It lives in `engine/raw/`, not under `docs/`, so that updating it stays a lab-only change (the fast checks:
`scripts/lab-scope.mjs` counts only `frontend/lab/<page>/` and `engine/<crate>/`).
`docs/engineering/ENGINE-STATUS.md` is older (it stops before white balance presets); this note replaces it.

The owner shoots a Fujifilm X-E5 (40 MP X-Trans, lossless RAF) and edits in Chrome on a Galaxy A15 (4 GB,
Mali-G57), an A35 next. This is their main editor for months without a computer. They want Lightroom quality.
The editor's look (the camera-plate material) is approved. Its layout was reworked on the owner's notes of
2026-11-10: see "The interface" below. The owner has said the code is the agent's own to shape, that quality
comes first, and that a heavy feature may take up to about ten seconds on the phone if the result earns it.

## Live

| What | Where |
|---|---|
| The test bench (2026-11-11): `/lab/engine/`, "Test this phone". One tap develops a made-up photo whose colours are known on the phone's GPU and compares it with a reference GPU's numbers, then times every stage on the Library's newest RAF (decode, first picture, a slider's frame, a screenful at 100 %, a full export) and the memory it took. The result is text to copy; the last eight runs stay in the browser. CI holds the same pictures to the reference on every change | `bench.js`, `bench-ui.js`, `known.js`, `bench-ref.json`, `engine/raw/checks/ref.cjs`, `tests/lab-engine-pictures-browser.test.mjs` |
| Decode on every core, hot pixels mended, 3×3-binned editing copy, the sensor's own pixels for full size | `engine/raw`, `frontend/lab/engine/decode-worker.js` |
| Colour: Adobe camera profiles and looks (the owner's private zip, in IndexedDB; never commit or serve them) | `dcp.js`, `gpu.js`, `profiles.js` |
| Light and Color sliders, white balance presets, eyedropper, Auto tone, Reset | `wgsl.js`, `mask.js`, `auto.js`, `editor/app/session.js` |
| Geometry: one pass lays the photo out as the picture; the lens's own corrections (distortion, fringing, darkened corners) from the RAF; Distortion and Vignetting by hand | `warp.js`, `lens.js` |
| Sharpening (Amount, Radius, Detail), Defringe, and noise reduction (Noise, Color noise) on the sensor's own pixels: 100 % and export | `finish.js`, `denoise.js`, `noise.js`, `full.js` |
| Effects: Clarity, Texture, Dehaze (each from a small mask, so they cost one lookup a pixel and match at every zoom) | `mask.js`, `haze.js`, `wgsl.js` main |
| Crop board: crop with aspect, straighten (and Auto level), quarter turns, flips, perspective (Vertical, Horizontal, Scale) | `crop.js`, `level.js`, `boards/CropPlate.js` |
| Full size: X-Trans demosaic of the rectangle looked at (Markesteijn's green, chosen first by the greens alone and then again by all three colours; vkdt's red and blue, read from where the lens drew them), developed by the same frame pass | `demosaic.js`, `demosaic-again.js`, `full.js`, measured by `engine/raw/quality/` |
| One photo across the tools: the picture lives in its own layer under the boards and keeps its zoom and place from Edit to Looks, Masks and Heal. Free pinch from fitted to 300 %, drag, double-tap for 100 %; on Masks and Heal two fingers zoom and move the photo, one works the tool | `editor/app/zoom.js` (a board's `data-keep="photo" data-zoom` slot is only a window onto the layer; `data-zoom="tool"` for a tool board) |
| Undo and history (every step keeps the whole edit), versions, saved with the edit | `editor/app/past.js`, `session.js` |
| View board: before/after against the photo as imported, histogram and clipping overlay | `boards/ViewTools.js`, `editor/app/scope.js`, `tiles.js` |
| Curve (RGB and each colour, over the photo's histogram), colour mixer (eight colours), grading (three ranges and the whole, Blending, Balance), Vignette, Grain | `grade.js`, `wgsl.js`, `boards/CurveOverlay.js`, `boards/GradeWheel.js`, `boards/EditPlate.js` |
| Profiles (the camera's renderings) as pictures on the Edit board's last face; the Looks board for `.cube` looks brought in (Presets), and edits saved as looks and Lightroom presets (`.xmp`) brought in (Mine): each a small picture of this photo wearing it, in a strip in the panel | `cube.js`, `editor/app/looks.js`, `editor/app/xmp.js`, `boards/Strip.js`, `boards/LooksPlate.js`, `boards/EditPlate.js` |
| Masks board: a brush, linear and radial gradients laid on the picture, ranges of colour and of brightness picked with a tap; each with its own Light, Color and Effects adjustments, Amount, Invert; shown in red | `local.js`, `brush.js`, `wgsl.js` main, `editor/app/masks.js`, `boards/MaskPlate.js` |
| Heal board: Heal, Clone and Remove spots, each replaced from a source the engine picks nearby (it can be dragged); Size, Feather, Opacity; Visualize | `heal.js`, `mend.js`, `warp.js`, `demosaic.js`, `editor/app/heal.js`, `boards/HealPlate.js` |
| Library: tiles that show the edit, an Edited filter, what the photos take on the phone (and whether Chrome has promised to keep it), deleting rejects for good; a set picked again copies only what is missing; a cut-off export is offered again | `boards/LibraryPlate.js`, `editor/app/store.js`, `editor/app/save.js` |
| JPEGs: brought in, opened as pictures (no camera profile, a straight tone curve, no sharpening to start), edited, retouched and exported as a RAF is; with nothing moved an export is the file's own pixels | `engine/picture.js`, `full.js`, `app/store.js` `copyIn`, `tests/lab-editor-jpeg-browser.test.mjs` |
| Copy an edit and paste it: on the open photo (Versions), or on every photo the Library shows (its Import sheet); the crop, spots and masks stay each photo's own | `app/clip.js`, `tests/lab-editor-clip-browser.test.mjs` |
| Export many: every photo the Library shows, with the Export board's files (kept on the phone), one after another with the screen kept awake | `app/save.js` `saveMany`, `tests/lab-editor-many-browser.test.mjs` |
| How each photo was shot, kept from its Exif (camera, lens, ISO, shutter, aperture, focal length, the camera's clock) and shown under its name; a series matched to the open photo by it (white balance, and Exposure by the stops between the shots) | `engine/exif.js` `shot`, `app/store.js`, `app/clip.js` `matchOn`, `tests/lab-engine-exif.test.mjs`, `tests/lab-editor-match-browser.test.mjs` |
| Find in the Library (name, camera, lens, ISO, shutter, aperture, focal length, date, flag); a look saved as a `.cube` table for use elsewhere | `boards/LibraryPlate.js` `words`, `app/cube-out.js` |
| A start for each camera and lens: the open photo's look kept as where new photos from that camera and lens begin (not Exposure, white balance or Noise) | `app/starts.js`, `tests/lab-editor-match-browser.test.mjs` |
| Stacking for noise: RAFs of one scene from a tripod averaged as sensor data into a new raw photo (noise ÷ √frames); frames that moved or were shot otherwise are left out | `engine/stack.js`, `app/stack.js`, `app/decoder.js`, `tests/lab-engine-stack.test.mjs`, `tests/lab-editor-stack-browser.test.mjs` |
| With no signal: the editor, its engine and the decoder are kept by the service worker once opened with a signal, and open without one | `frontend/sw.js` `keepEditor`, `/lab/offline.json` (`scripts/stage.mjs`), `editor/boot.js`, `tests/lab-editor-offline-browser.test.mjs` |
| Backup to the owner's Drive, asked for with a tap in the Library's Import sheet and run on Photos' page: originals through Photos' own import, each edit as one small file, both brought back by Photos' Edit on a bare phone. Nothing depends on it | `editor/app/backup.js`, `apps/photos/backup-screen.js`, `apps/photos/to-editor.js`, `tests/lab-editor-backup-browser.test.mjs` |
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

## The interface (reworked 2026-11-10 on the owner's notes)

The owner's ten notes, in short: the panel took too much of the screen; a drum on the left for the sections with
the adjustments flying out of it; grading and the curve must not cover the photo; the crop could not be moved or
zoomed; profiles belong at the end of Edit's sections and presets on Looks, neither over the photo; drop the dial
where a screen does not need it; the app should feel like one thing, not pages; no photo counter; a dial that can
be flung and still scrubs finely; two taps on the dial in place of Reset, and a small Auto.

What was built, and where:

- **One photo layer** (`app/zoom.js`). The canvas sits in one element under `#stage`; a board's
  `data-keep="photo" data-zoom` slot is a window whose rectangle the layer follows, gliding when another board's
  window takes over. Boards that use it have transparent roots (`#frame` is black). Crop and Export still take
  the canvas into their own frames (`hooks.away`). A zoomed photo keeps its size on screen when the room changes.
- **The panel** is 210 design pixels on most boards (it was 315): the value's window, the dial, and one row with
  a drum and its markings. It grows only where a face needs it (Curve 340, a grading wheel 262, Masks 246) and
  the photo's room gives way (`transition` on the window's height and the panel's top).
- **`boards/Drum.js`**: the vertical drum. Faces are a board's sections; drag, flick (up to 2.5 faces) or tap
  above or below the middle. **`boards/Row.js`**: the markings beside it, each flying out from the drum
  (`pop0..9` in `editor.css`); `entry` makes a boxed key, `hot` a red one.
- **`boards/DialPlate.js`**: the shared dial. A drag turns it one for one; let go while moving and it runs on
  (decays over about a third of a second, stops under a finger); two taps within 360 ms call `onreset`; `auto`
  puts a small key in the window; `left` fills from the left end (0-upwards values); `slim` is the window alone,
  dragged like a slider; `onhold` tells a board when the dial is in use (Masks takes the red off meanwhile).
  Every board's dial is this one now: a value is given as a position −5..5 and its text.
- **Edit** (`boards/EditPlate.js`): faces Light, Curve, Color, Mixer, Grading, Effects, Detail, Optics, Profile.
  The curve and one grading wheel at a time (`boards/GradeWheel.js`) are in the panel. Profile is a strip of
  pictures (`boards/Strip.js`) sorted All, Film, Adobe, B&W, with Amount in a slim window.
- **Crop** (`boards/CropPlate.js`): the frame always fills the room; the photo is dragged and pinched under it;
  eight handles (corners and sides). Faces Straighten, Aspect, Rotate, Geometry; Auto level is the key in the
  dial's window and Reset a key in the row. Crop still shows the photo in its own frame, not the shared layer.
- **Looks** (`boards/LooksPlate.js`): faces Presets and Mine, the same strip, Import, Save current and Delete as
  keys in the row. The recipe samples are gone until recipes are read.
- **Masks** (`boards/MaskPlate.js`): the masks are pills along the panel's top with Add and the overlay's eye;
  faces Mask, Light, Color, Effects. **Heal** (`boards/HealPlate.js`): the drum chooses Heal, Clone or Remove;
  Undo spot and Clear all are keys in the row.
- The sample pages (`edit/`, `looks/` …) hold copies of the templates they play. They are brought up to date by
  script from `index.html` (each page's board and what it imports); do not edit them by hand.

The View board's history is a row and its versions a strip in its panel, which grows for them; Export has the
same panel as the rest (its two files as cards along the top, Save in the header) and shows the photo in the
shared layer. The Library is as it was. The page behaves as an app under the finger: keys give when pressed, a tap
leaves no grey flash, nothing pulls to refresh, and a long press brings no browser menu (`editor.css`, `boot.js`).
A choice on a dial (Export's sharpen amount, metadata, file name) steps with a short turn (`DialPlate` `span`).
A board is found as it was left (`dc.js` `keep`: Edit's section and control, Heal's tool and brush, Export's
settings, the Library's filter), until the page is reloaded. The header's histogram key opens the View board.
While the sensor's pixels are being made for a zoomed photo a dot beats on the zoom badge. The View board's
header says how long the photo took to open and to turn sharp, and Export's message how long the save took
(`session.js` `took`): the owner can read the phone's speed off the screen.
The full-size passes (demosaic, noise, sharpening, the 16-bit frame pass, the last pass) start compiling as soon as
a photo's sensor pixels are on the GPU, not at the first zoom: on the software GPU the first 100 % then turns sharp
in about 3 s where it took 11. Saving develops the photo once for all its files (`export.js` `develop` takes the
list), not once for each: Full and Small together cost one development.
The header's Export key is blue on every board now (Edit's was, the others' were red).

Check scripts (not in the repo) drive each board in headless Chromium on a landscape and a portrait RAF: the drum
(tap, drag, flick), the dial (drag, flick, two taps, Auto), profiles and looks as strips under the photo, masks,
brush, heal, crop gestures, zoom across boards. Run them one at a time on a frozen copy of the tree: two at once
on the software GPU give false failures.

## The quality pass (begun 2026-11-10)

The owner asked whether each part is truly the best it can be, and said to choose quality over speed (up to about
ten seconds for a heavy feature is acceptable). The order agreed: demosaic, full-resolution Texture and Clarity,
noise reduction, deconvolution sharpening, a proper heal blend. Each step is measured before it is changed.

- **Demosaic: done.** `engine/raw/quality/` holds the harness and what it said (its README). vkdt's green was
  the weak part: 2 to 3 dB behind Markesteijn's. The engine now makes green Markesteijn's way (four guesses a
  red or blue site, the smoothest kept, judged by the greens alone: five light passes instead of three) and keeps
  vkdt's ratio-to-green red and blue, which carry less false colour than Markesteijn's own. On the sample at
  100 % the solar panels' fine lines no longer break into coloured dashes. `info.wb` (the shot's white balance)
  is now needed by `demosaicer`: the guesses compare a site's own colour with green.
- **The area tools at full size: done.** Highlights, Shadows, Clarity, Texture and Dehaze judge a pixel's
  brightness against an area mask made from the editing copy. At full size they used the single sensor pixel's
  own brightness, so Texture and Clarity also lifted the one-to-three-pixel band (grain, and what Sharpening
  already handles) that the fitted photo never showed. A full-size view now takes that brightness over three
  pixels each way (`wgsl.js` `lightAt`), which is what one of the editing copy's pixels is: the tools do at
  100 % and in an export what the fitted photo showed. Measured as the mean difference between the 100 % view
  averaged three by three and the editing copy under it (of 255): plain 1.24; Texture +100 went from 1.46 to
  1.31, Clarity +100 from 1.42 to 1.29. Texture below zero now smooths the middle detail and keeps the finest
  (1.25 to 1.31), which is how Lightroom's behaves.
- **Against darktable's own code** (4.6.1, installed in the session; `quality/README.md` says how): its demosaic
  scores 38.1 dB on the roofs crop where ours scored 36.9, all of the lead in green, with more false colour than
  ours. Letting each red and blue site trust its own reading by half closed half of that (37.5) at no cost in
  colour (`demosaic.js` `OWN`). What is left is Markesteijn's own choice of way, judged on all three colours: it
  needs red and blue made four ways first (about 0.5 to 0.8 dB of green). RawTherapee could not be scored: it
  misreads the harness's DNG. darktable's denoise and sharpening could not be scripted from its command line.
- **The demosaic's second look: done** (2026-11-11, `demosaic-again.js`). That choice of way is now made, without
  making red and blue four times: the first look's picture stands in for them, three of the four greens are made
  again from it, and the ways are chosen by brightness and both colour differences. On five scenes from four
  40 MP X-Trans bodies: 1.0 to 2.4 dB more green and 0.4 to 1.2 dB overall than before; ahead of Markesteijn's
  three passes in four of five and in false colour in all (`quality/README.md`, "The second look", which also
  says what else exists for this sensor: the next real step would be a neural demosaic, a project of its own).
  Cost: the demosaic takes about twice as long and 8 bytes a pixel more while it runs; not yet timed on a phone.
- **Hot pixels: done** (2026-11-11, `src/hot.rs`, in the decoder so the editing copy, 100 % and exports all get
  it). A sensel that stands at least three times above every same-colour site near it, alone, is given their mean
  before the demosaic can spread it into a coloured cross. Nothing to set: it changes nothing in an ordinary photo
  (nine checked) and leaves a star alone. Not yet seen on a real long exposure of the owner's.
- **Colour fringing, undone in the demosaic: done** (2026-11-11, `demosaic.js` `lead`, `lens.js` `fringeOf`; the
  warp then leaves red and blue alone for full-size views). Undone after the demosaic, as before, half a pixel of
  it cost 3 dB and a pixel nearly 7 on a known picture; now 1 and 2 dB, with false colour back to what it is
  without any (`quality/README.md`, "Colour fringing"). The sample lenses fringe by 0.6 to 4 pixels over most of
  the frame, so this is most of every photo's outer part. The editing copy is as before (its pixels are three
  sensor pixels wide). The demosaic takes about a third longer where there is lens data.
- **Strong colours: done** (2026-11-11, `wgsl.js` `fit`). A colour the screen cannot show keeps its hue and
  lightness and gives up strength until it fits, where it used to be cut off at the edge with its hue bent
  (5.3° on average over a wheel of strong colours, now 0.1°). In the colour table, so free per pixel.
  `render(…, { edge: false })` cuts off as before, to compare; CI holds both pictures.
- **8-bit files already dither** (`files.js` `eight`: each value is rounded up or down by chance in proportion),
  so a smooth sky does not band in a JPEG or PNG; the screen's dither is `wgsl.js` `DITHER`.
- **Colour noise at large scale: measured, left** (2026-11-11). On the roofs crop at ISO 12800 the colour step
  (Color noise 25) wins 1.1 to 1.7 dB of colour at 1 to 8 pixels but only 0.4 dB at 16 (47.7 dB against 54.6
  without noise): what is left there is about one level of 255 in the midtones, more in lifted shadows. Color
  noise 50 makes 16 pixels worse (44.4): it starts to blur real colour. A coarser second scale would be the fix
  if blotches show on a real high-ISO photo.
- **Noise reduction: done.** The colour step stays. The brightness step weighs a neighbour by the 3 × 3 patch round
  it against the patch round the pixel, not by one value against one (`denoise.js` `blur`): at ISO 6400, +0.5 dB
  overall and +0.8 dB of green over the old step, and ahead of a plain non-local means. A photo not opened before
  starts with Noise by its ISO (`session.js` `noiseStart`, kept with the edit as `noise0`); photos opened before
  keep 0.
- **Sharpening: done.** The photo's own Sharpening is now deconvolution (`deconv.js`, Richardson and Lucy, eight
  rounds, on the rectangle's linear brightness before the picture is laid out), not the unsharp mask: on a known
  picture blurred by 0.8 of a pixel it wins back 2.5 dB where the mask won 0.9, and with ISO 1600 noise 2 dB against
  0.5. Sharpening 40 takes the spread out, less takes part of it, more goes past it; Radius is the spread (1 is 0.7
  of a pixel); Detail is how little is held back as noise. `finish.js` keeps the unsharp mask for a mask's own
  Sharpness. Changing Sharpening at 100 % re-makes the rectangle (demosaic, noise, sharpening): heavier than it
  was. The export's pieces overlap by 12 pixels now, not 4.
- **Heal: done, a small gain.** The correction that brings a source to a spot's surroundings may bend (to third
  order: `mend.js`, `heal.js` `fit`; eight rows a spot, not five): 6 % less error at the rim. A true
  gradient-domain blend was not built: the measurement did not promise enough.
- Cost, to check on the phone: while a rectangle is made the engine holds about 20 bytes a pixel more than this
  morning (demosaic 12, noise 8; sharpening works in the noise step's buffers), and a 100 % view runs about 45
  passes where it ran 10. In headless Chromium saving the Full and Small files of a 40 MP photo takes about 6 minutes.

## The network (2026-11-12)

- `frontend/lab/engine/neural.js` stands where `demosaic.js`'s `demosaicer` does and writes the same form (two
  u32 a pixel, clipped colours flagged), so everything after it is unchanged. It runs Starfish's export as it
  is (`nets/starfish-xtrans/`: `graph.txt`, a `.wgsl` a pass, `weights.bin`; `f16/` where the GPU has half
  floats, `f32/` where it has not: the software GPU has not). A rectangle is made a window of 1056 × 1056
  at a time, 30 pixels of each side being context; each window has its own settings and bindings, because
  several are laid in one frame's commands. Our own passes are `cut` (a window of the sensor at green's scale,
  with each site's noise from noise.js at the photo's ISO) and `place` (the middle back at the sensor's scale).
- `full.js` `view(..., best)` takes it in place of the demosaic and skips noise reduction (the network took the
  noise out). The Noise dial says how much of the photo's noise the network is told of: all of it at the
  ISO's own start, less below, more above.
- An export asks for it (`app/save.js` `netOn`); if it fails the export is made again the usual way and the
  network is not tried on that phone for a day (a week until 2026-11-13; the Export board now says so, with BEST
  AGAIN). The same when the page did not live to finish an export the
  network was making (`cutOff`): a phone that takes the tab back for the work must not do so every time. From 100 % in (200 % at first), `app/zoom.js` `finer` makes what shows with
  it once the photo rests and lays it over the live view; an edit's first frame takes it away and it comes
  back 400 ms after the last frame. It is never part of a dial's frame.
- Before a device uses it, the network proves itself there once (`proof`): shown a small grey picture with a
  slope across it, it must give that picture back to within 0.02 of the sensor's range (the software GPU: 0.002).
  A GPU that gives anything else is not used, and the views are made the usual way. The half-float copy a
  phone runs cannot be run on the software GPU here, so this is what stands between a driver's fault and a
  wrong export.
- What is not known: how long it takes on the owner's phone. An export's timing says (`net`, `gpu`, and the
  first pieces' steps; `fine` for the 200 % view), in the timings the phone passes on.
- The lens's colour fringing, which the usual demosaic undoes as it goes, is undone after the network by the
  lens pass (warp.js is told the colours are not yet aligned). Full-size detail: Faster has no meaning for it.

## Keeping the photos safe (2026-11-12, from the audit)

The originals may be nowhere but this phone, so losing one is the worst thing the editor can do. An audit of
`app/` and `engine/` found these, each checked in the code and now closed:

- **A save that failed was silent.** `session.js` `save` now says so on the photo (`unsaved`): the phone's storage
  full is the likely cause.
- **A change could die with the tab.** The edit is written the moment the page is hidden or left (`boot.js`),
  not only 400 ms after the last change.
- **Delete was for good.** `store.remove` now only takes a photo out of the Library: it stays on the phone
  for `KEEP_DAYS` (7) and `restore` brings it back with its edit; `init` lets go of what is older, and `empty`
  does so at once. The Library's sheet has "Bring back" and "Empty" rows. A deleted photo picked again from
  the phone's files comes back and is not copied twice.
- **The clean-up could delete every original.** `sweep` removed any original with no record: had the records
  been lost and the files kept, all of them. It now gives such an original a record again (`adopt`, "Recovered
  …" in the Library) and removes only what is no picture.
- **A reset graphics chip froze the photo without a word.** `gpu.js` says so (`th-gpu-lost`, unless the device
  was let go on purpose) and `session.js` keeps the edit and opens the photo anew.
- **A decoder thread that fell over hung every later open.** `decoder.js` tells everything waiting on it and
  starts a new thread at the next request.
- **A full-size build that failed was silent,** leaving export saying "still loading". It now says so.
- The import and export progress had lost its count and bar to a comment laid mid-line (`LibraryPlate.js`).

Still open from that audit: two tabs on one photo overwrite each other (no lock); an import that fails for
want of room says "could not be read"; nothing tests masks, heal on a RAF, rotate and flip, versions, history
across a reload, or TIFF export. The features found missing or half-made are listed in ROADMAP.

## The compare page (2026-11-12)

`/lab/editor/compare/?open=<photo id>` (the Compare tile on the editor's Versions board opens the photo there):
the photo as edited, made by each way the engine has (Classic: the demosaic looking twice; Faster: once; Network),
beside the camera's own JPEG and any picture added on the page (Lightroom's export as a JPEG or PNG: a browser
does not read TIFF). Each way is a layer of 512-pixel tiles, each tile made once (`full.js` `view(..., 'twice' |
'once' | true)`, one engine job at a time, what shows first) and kept, so changing the way only changes which
layer shows and zooming (100 to 300 %, hard pixels) draws nothing. A tap flips between the last two ways;
Split lays them either side of a line; Difference shows where they disagree, eight times over; Blind hides
the names until one is picked, and a pick is kept as a mark (where on the photo as fractions, how far in, the
two ways, the one picked; never which photo) that rides in the timings file. Not yet: a picture laid over the
photo is only stretched to its size, not lined up tile by tile or matched in tone, and it is held whole in
memory.

## The interface's faults (2026-11-12, from the interface audit)

The audit walked every board on a phone-sized screen and listed what was wrong; these are closed, each with
its check in `tests/lab-editor-faults-browser.test.mjs`:

- **The sample never shows in the app.** A board asks `app/shown.js` what to show: the open photo, or the one
  being opened by its own name with "Opening…", or that none is open. The design's sample (its picture,
  DSCF0412, its made-up values) plays only on a screen of the design on its own.
- **No black gap or wrong picture on a second open.** The camera JPEG is decoded before it is put on, and the
  canvas goes in only once its first frame is drawn (`session.js` `open`).
- **EDIT on the culling screen opens the photo on screen**, not the first one.
- **Crop follows Undo and History** (frame and size at once), and its steps say what they did (the size,
  "rotated", "flipped", "straightened 1.5°") instead of all being "Crop".
- **Undo says what it took back** ("Undid Exposure +0.80", `app/told.js`).
- **The white balance eyedropper works by touch** and is put away when the board changes.
- **An empty Library says so** with a button to choose photos; a filter or Find with no match says that.
- **Crop and Export say the same size**, the one an export makes (`shown.outSize`); a JPEG is called a JPEG;
  the guessed megabytes are gone.
- **A tap outside the Import sheet closes it**; what the app cannot do yet (Watch a folder) is not offered.
- **Every control has 44 px of touch room** (`.hit` in `editor.css`), and a row that runs on past an edge
  fades there so it shows there is more.

Still open from that audit: a JPEG's export is a pixel short on a side that does not divide by three
(`engine/picture.js`); the histogram's clipping labels wrap.

## The Weekly Fuji recipes (2026-11-12)

First on the Looks board's Presets face is a card, **Fuji recipes** (tag WEEKLY): the film simulation recipes
Fuji X Weekly publishes (Ritchie Roesch, fujixweekly.com), 394 of them, grouped by the sensor each was made
for, X-Trans V first. A tap on one puts it on the open photo as one step of the history (Undo takes it back):
it takes the place of the photo's look and leaves what is the photo's own (Exposure, crop, lens corrections,
masks, spots). The board then says what was only near and what is not here.

The list is `frontend/lab/editor/assets/weekly-fuji-recipes.json` (77 KB, read only when the card is first
opened): each recipe's name, its camera settings and the path of its page. None of the site's words or
pictures are in it, and the page holds no address of the site (the editor reaches nothing outside this site).
It was read from the site's own recipe pages on 2026-11-12, one request at a time; it does not update itself.

A recipe is made for the camera's JPEG engine; here each setting is laid on the nearest control
(`app/recipe-map.js`, checked without a browser in `tests/lab-editor-recipes.test.mjs`):

| The recipe's setting | Here |
|---|---|
| Film Simulation | the profile of that family among the photo's own (with its black-and-white filter where there is such a profile) |
| Highlight, Shadow | Highlights and Shadows, 12 a step (Shadow turned over: +1 is darker), and a third as much on Whites and Blacks |
| Dynamic Range 200, 400 | Highlights 10 and 20 lower. Near only: the camera does it at the shot |
| D-Range Priority | Highlights held and Shadows lifted, in place of the two tones. Near only |
| Color | Saturation, 6 a step |
| Sharpness | Sharpening 40, 8 a step |
| High ISO NR | Noise scaled from where the photo's ISO starts it, a tenth a step: −4 keeps 60 %, +4 140 % (2026-11-13; it was 5 a step taken away, which made Noise 0 on almost every photo) |
| Clarity | Clarity, 8 a step |
| Grain Weak, Strong; Small, Large | Grain 9, 18; Grain size 25 (where it starts), 45 (2026-11-13: halved from 18, 36 and 60, far heavier at 100 % on a 40 MP photo than the camera's; still guesses until the camera's JPEGs are measured) |
| Color Chrome Effect, FX Blue: Weak, Strong | Chrome and Chrome Blue 50, 100: their own controls (below) |
| White Balance | a light or a temperature of the recipe's, else the shot's own; then the Red and Blue shift as Temp and Tint |
| Exposure Compensation, ISO | not applied: they are for the shooting |
| Monochromatic Color (toning) | grading's Global wheel: one hue and saturation over the whole picture. The hue from the setting's direction (warm 40°, green 130°, cool 220°, magenta 310°), the saturation 2.5 times its length, to 45 |

These strengths are first guesses, set where each dial's range puts the camera's steps. **Not measured yet**
against the camera's own JPEGs: that needs a few RAFs shot with a recipe set, beside their JPEGs. Still only
near: Dynamic Range and D-Range Priority (the camera does them at the shot; a dynamic-range shoulder would make
them true). Toning lays the tint once, on grading's Global wheel; whether its strength matches the camera's
±18 is one of the guesses to measure.

**Chrome, Chrome Blue and Grain size (2026-11-12)** are controls of their own on the Edit board (Chrome and
Chrome blue with Saturation and Vibrance under Color; Grain size beside Grain under Effects), turned by hand like
any other and carried by presets, looks, copy and paste and the history. Chrome is Fujifilm's Color Chrome
Effect: a strong colour a little darker the stronger it is (Oklab's lightness down by up to 7 % at 100, about
0.3 stops, eased in from Oklab chroma 0.06 to 0.2, so greys and skin are left), every hue but the blues; Chrome
Blue the same for cyan-blue to blue. It is in the colour table (`grade.js` `chrome`, after the mixer), so it
costs nothing a frame. Measured on the software GPU, a JPEG of flat patches: Chrome 100 takes a red (208, 32, 32)
to (193, 9, 19), 0.33 stops darker, and a green (32, 160, 64) to (5, 148, 52), 0.25 stops; 50 about half; a grey
and a pale (200, 184, 168) do not move, skin (224, 172, 140) by one level. Chrome Blue 100 takes a blue (32, 64,
208) to (26, 52, 197) and a sky (90, 150, 220) to (84, 144, 213), and leaves the red. Grain size 0..100 starts
at 25, which is the grain as it was to the byte (checked against the build before it); 60 makes each speck 2.2
times as large and 100 5.7 times (0: 0.56 times), run smoothly into each other rather than as squares, about as strong. At 0
(Grain size at 25) the pictures are the same bytes as before: `bench-ref.json` did not change.
`tests/lab-engine-pictures-browser.test.mjs` checks all of it.

## Less waiting (2026-11-12, from the fluidity review)

- **A turn of Noise or Sharpening at 100 % no longer demosaics again.** Both work on the demosaiced
  rectangle in place, so every turn of either used to make it again from the sensor, which is most of the
  work at full size. `full.js` keeps the rectangle aside as it was made and copies it back; another
  rectangle, or a changed geometry (a retouch spot, the crop), makes it anew. With the network the copy
  also serves Sharpening, but not Noise: the network is told how much noise to take out. Measured on a
  software GPU, a 900 × 900 view: a turn of Sharpening 10.7 s before, 0.7 s after, the picture the same to
  the last value (`tests/lab-engine-pictures-browser.test.mjs`). Not measured on the phone yet: the
  timings file will show it as shorter `detail` times.
- **The network is compiled behind the photo.** Where it will be used (the owner's setting, a RAF), `full.js`
  reads, compiles and proves it a moment after the full-size photo is ready, so the first rest at 100 % only
  has to run it. What that first view costs was not being timed (the clock started after it was made): a
  `fine` timing now carries `made`, the milliseconds the network's view took to make when it had to be.
## Export off the page, and Cancel (2026-11-12)

An export's work on the processor (each band brought to a file's size, output sharpening, the writers) now runs
on its own module thread (`engine/export-worker.js`, started by `export-thread.js` for each export); the page
keeps only the GPU's part and the reading back. The code moved to `engine/reduce.js` unchanged, and each band is
given to the thread, not copied; no more than two wait on it at once (a 40 MP band is about 30 MB). A JPEG's
bands still go to the decoder's thread to be encoded, through the page: one copy of the encoder in memory. Where
the thread cannot start, all of it is done on the page as before (`develop(..., { worker: false })`), and the
files are the same to the byte either way (each export's dither now starts from the same place, `files.js`
`reseed`). An export takes an `AbortSignal`, looked at between pieces: the GPU's view is let go, the thread is
stopped, nothing is downloaded, and `save` / `saveMany` reject with an AbortError (`save.js` `cancelled`), which
leaves no mark of a cut-off export and does not turn the network off. The Export board shows CANCEL while it
saves, then "Export cancelled".
Measured on this software GPU (tests/lab-editor-export-smooth-browser.test.mjs: 7728 × 1100, a full-size JPEG
sharpened for print and a 2048 one for a screen): all on the page, a band held the page for 445 ms and the frames
stopped for 417 ms; on the thread no task of the page's reached 50 ms and the longest gap between frames was
17 ms (up to 300 ms on a busy machine, with no long task: the software GPU drawing the frames, so that gap is
only told). The test fails on a task of 250 ms. Not yet measured on the phone; the Library's Export many takes a
signal but has no Cancel key yet.

## Under the finger (2026-11-12)

Three things to make the editor feel more fluid on the phone. **Ticks** (`frontend/lab/editor/app/haptic.js`): a
short buzz (`navigator.vibrate`) when the dial passes the value's start or reaches an end of its range
(`boards/DialPlate.js`; the Edit board tells the dial where its value starts, `adjust.js` `startDial`), when the
drum's face clicks into place (`boards/Drum.js`), on Undo and Redo (`app/told.js`) and when an export is done
(`boards/ExportPlate.js`, and Export many in `app/save.js`). Never one per pixel of a drag, at most one every
40 ms, off with the new setting `photos.haptics` (Settings › Photos › Editor › Haptics, on at first) and on a
phone set to reduce motion. **A fling** (`app/fling.js`): a zoomed photo let go while one finger still moves it
glides on and slows to rest; past an edge it gives (at most 48 design pixels) and comes back inside; any new touch
stops it where it is. Only the transform changes while it glides; the detail is made once it rests (a detail
asked for while fingers move or it glides waits for that: `zoom.js` `settle`). **Two fingers tapped undo a step,
three redo one** (`app/taps.js`, `told.js` `redo`), said by the line over the photo: all fingers down within
120 ms, up within 250 ms, none moved 10 px, all on the photo, so the end of a pinch, a tap on the controls or a
finger already at work with Heal's or Masks' tool is none.
Held by tests/lab-editor-touch-browser.test.mjs, with a stub for the vibration: what the phone is asked for is
checked, how it feels is not, and none of it has been tried on the phone yet. On this software GPU a fling glides
for about 40 frames, the worst 17 to 33 ms apart, and gives 18 to 25 px at the edge.

## The edit at once when a photo is opened again, and Export many's Cancel (2026-11-13)

Opening a 40 MP RAF takes about 2.3 s on the phone, and until it was developed the screen showed the camera's
JPEG, not the owner's edit. Now, when an edit is kept, the frame its Library tile is made from (`session.js`
`keepTile`, 1.5 s after the last change, between the dial's frames) is also kept the screen's size: the editing
copy, cropped and edited, 1600 pixels on its longer side at most, a JPEG at 0.85 (`app/kept-view.js`). In Chromium a
JPEG at 0.85 was smaller than a WebP of the same quality on the editor's sample photo (64 KB against about 90 KB at
46.9 dB; a WebP at 0.85 is 17 KB but visibly softer at 45.0 dB) and encodes ten times faster; a 40 MP photo's should
be about 60 to 100 KB. It lies beside the tile in the phone's private files (`view/<id>.pic`), with a mark of the edit it was
made from (the saved edit without its history) in the photo's record; it is made again only when that mark
changes, and not while a finger is down. On open (`firstPicture`) it shows in place of the camera JPEG only when its
mark is the mark of the edit saved now: an edit changed another way (another tab, a paste on many) shows the camera
JPEG as before. The developed picture still takes over after its first frame. A cropped photo's kept picture is its
cropped frame, so it sits where the developed picture will, at its size (the zoom layer lays the photo out by the
picture's own shape); only the Crop board, which shows the photo uncropped, would see it change if a photo were
opened straight onto it. Deleting a photo takes its kept picture at once (`store.remove`; also `empty`, `sweep`);
the Library's storage figure counts it (the browser's own estimate); backups never carry it. The open's timing now
has `first` (ms from the tap to the first picture of the photo on screen) and `kept: 1` when that was the kept one.
A photo edited before this change, or brought back after a delete, has none until its edit next changes.

**Export many** has a CANCEL key beside its count while it runs (44 px of touch room): the file in hand is given up,
the photo that was open comes back, and the Library says "Export cancelled · 1 file from 1 photo in Downloads".

Held by `tests/lab-editor-reopen-browser.test.mjs` (frames recorded from the tap: the first picture under the
photo's name is the kept edit by a pixel against both pictures, no frame without one, no jump at the swap, the
developed picture the same edit; a stale one, a cropped one, a deleted one; Cancel). Not yet seen on the phone: the
timings file will say how long `first` is there.
## The two Autos (2026-11-13)

**Auto white balance** (`frontend/lab/engine/autowhite.js`, `gpu.js` `autoWb`, `adjust.js` `autoWb`): "Auto" beside
"As shot" in the Edit board's white balance menu (the menu is built from `session.js` `WB`, so neither template
changed). It reads the editing copy's camera colours, a 3 × 3 mean every few pixels (about 40 000 samples, clipped
ones left out), and asks of each bright one what light it would be under if it were grey (the profile's own
`whiteOf`). Only answers within 40 tint of the locus and between about 2 300 and 12 500 K vote, weighted by
brightness, by nearness to the locus and by a prior around the camera's white (0.6 at 80 mired warmer or 70 bluer).
The light with the most votes wins, read as the mean colour of the pixels that agree with it (within 15 mired and 10
tint), not of the whole frame. How sure it is: the share of the photo that agrees, weighed as the votes are. Under 6 %
it keeps the camera's white ("Auto: kept the camera's white, nothing neutral to go by"); from 6 to 15 % it moves that
share of the way; past 15 % the whole way. The answer is held to 2 500–10 000 K and ±40 tint, rounded to 50 K and a
whole tint, and set as the white balance "Auto" (a step "White balance · Auto", which Undo takes back; `past.js`
compares its Temp and Tint as it does Custom's). Measured (tests/lab-engine-autowhite.test.mjs, made-up scenes from
the engine's own colour temperatures, two cameras): a grey ramp and colour patches at 3 200, 5 500 and 7 500 K with
the camera's white 1 000 K off either way land within 16 K and 0.1 tint; grass and a sunset with the camera at 4 800,
5 500 and 6 500 K are weak (at most 4.8 % agreeing, the sunset on the JPEG camera) and keep the camera's white; a
clipped sky and noisy shadows change nothing. In the browser test a JPEG lit at 4 300 K came out at 4 300 K and its
grey patch within 0.2 of 255 of neutral. Limits, plainly: it is an estimate, never compared with Lightroom's Auto
or tried on real photos yet. A warm surface filling the frame (a face, a wooden wall, an orange sky) looks exactly
like grey under a lamp, and only the prior keeps it from being "corrected"; sky votes for a bluer light the same
way. A photo whose light is more than about 100 mired from the camera's white is only partly corrected. A pasted
edit carries Auto's Temp and Tint from the photo it was copied from; it does not read the new photo again.

**Auto for the Light controls says what it did** (`adjust.js` `auto`): its step is "Auto" with what moved as its
value, most moved first by the dial's own scale, at most four ("Exposure +0.75 · Shadows +22"), and the board's
hint line says the same for four seconds; the header's Undo says "Undid Auto Exposure +0.75 · …". A second tap that
would change nothing says "Auto: nothing to change" and makes no step. Undo, not a second tap, now takes Auto back
(the setting's line says so). Held by tests/lab-editor-autowb-browser.test.mjs.

## From the owner's phone (2026-11-13)

The owner exported photos on the phone and was disappointed; the timings and the exported file showed four faults.

- **A cut-off export quietly switched the phone to the lesser way for a week.** An export by the network that the
  phone cut off (or that failed) left the network off for 7 days, and the next export was the usual way with no
  word. Now `save()` holds the screen's wake lock as Export many does (a multi-minute export with the screen off is
  what gets cut off), the stand-down is one day, and the Export board says it before saving: "Best quality was
  stopped by the phone last time, so this export uses the standard method. BEST AGAIN turns it back on.", with
  BEST AGAIN (44 px of room) clearing it (`save.js` `netWhy`, `bestAgain`).
- **How long an export will take.** The board says "About 2 min, from this phone's past exports" before saving:
  the median ms a megapixel of this phone's last five exports by the same way (network or not), times the pixels
  of the files that are on; with no past export it says nothing. While saving: "Saving · 1 min 20 s left", from
  the rate so far, changed at most once a second and never more than a fifth upward (`app/eta.js`).
- **Quality 100 made a 63 MB file.** At the encoder's 100 every table is 1. The board's 90..100 is now the
  encoder's 90..97 (`files.js` `encoderQuality`; up to 90 unchanged; colour still whole from the board's 90).
  Measured on the owner's 40 MP photo: 100 63 MB, 97 37 MB, 95 28 MB, 95 with half the colour 21 MB. The board
  shows no JPEG size estimate, so there was none to change.
- **The recipes' High ISO NR and grain were too strong** (the table above): NR now scales the photo's own start
  (−4, which 302 of the 394 recipes say, keeps 60 %), and grain is halved.
- **Every export says how it was made.** A file with metadata on carries one line of JSON (under 1,500 bytes): the
  release, the way (network, classic, faster), the controls moved from their start, white balance, look, crop,
  how many masks and spots, the board's quality. A JPEG's COM right after the Exif, a PNG's tEXt `Comment`, a TIFF's
  ImageDescription; no name, no place. `node scripts/export-note.mjs <file>` prints it, from a cut-off JPEG too.

Held by `tests/lab-editor-export-eta.test.mjs` (the arithmetic, the mapping, the note in each writer),
`tests/lab-editor-export-board-browser.test.mjs` (wake lock, the notes in real exports, the board's lines and BEST
AGAIN) and `tests/lab-editor-export-smooth-browser.test.mjs` (quality 100's tables not all ones, 57 % of the bytes
of the encoder's own 100 on a test photo). Not yet seen on the phone.

## The network was told a quarter of the noise (2026-11-13)

Found on the owner's own photos, after an export that looked grainy at 100 %. The network (`neural.js`) smooths
by the noise each sensor site is said to have, and it was told `noise.js`'s table: darktable's profile for the
camera. That profile is not a raw site's noise. darktable measures it on a demosaiced picture, through the
finest band of a wavelet (a quarter of a pixel's variance for white noise), so for a site it is about 17
times too low in variance: the X-E5's full well (22,900 electrons at ISO 125) puts a at 2.2e-4 at ISO 640
where the table has 1.3e-5, and the owner's ISO 640 photo measures 2.7e-4. The network took out a quarter of
the noise and left the rest as speckle.

Now `full.js` tells it the photo's own: `noise-fit.js` reads a and b (variance = a·x + b) from the sensor
data, from the flattest blocks at each brightness (greens one pattern apart, about a slope; Foi and others'
method, as vkdt and Starfish's own estimator use it), a ninth of the photo, 61 ms for 40 megapixels on a
desktop. A fit outside 0.15 to 3 times what the sensor can be at that ISO is not believed and the sensor's
own figure stands. The made-up test photo says its own noise, so the reference pictures did not move.

Seen at 100 % on three real photos (ISO 125, 250, 640), before and after: the speckle goes and the texture
under it stays. Measured: the fit is 1.20, 1.36 and 0.55 times the sensor's own figure on those three, so
either may be a third off; telling the network too little is the worse error.

Then the owner looked at the pairs: the dark brick was far better, but a painted wall in middling light looked
better before. Told all of the noise, the network takes the wall's fine grain with it, and the wall goes smooth.
Telling it less (tried: the light's share of the noise at a half, a quarter, an eighth) only trades one for the
other, and brings the colour speckle back with the grain.

So the network is still told all of it, and its last pass (`neural.js` `place`) puts grain back: at each site,
what the network took (the site's own value less the network's, no more than three of its noise), returned as
brightness only, every colour by the same factor, so no colour speckle returns; and less of it where light is
near its noise, so shadows stay clean (half at a signal to noise of 8). The Noise dial sets the share
(`noise-fit.js` `dialled`): three quarters at the dial's start, all of it and everywhere at 0, none from 25 past
the start, where the network is also told of more noise than there is. Seen at 100 % on the owner's ISO 640
photo: the wall has its texture again without the speckle, the brick's shadows and the sky are as clean as with
none put back; and on the ISO 125 and 250 photos the grain is hardly there to see. It costs nothing to speak of:
one more read of the sensor in a pass that was there already.

An export by the network now also times one window a pass at a time, once a week, while its files are being
finished (`neural.js` `bench`, the timings' `op0` to `op12`: cut, the network's eleven, place), so the phone
says which of the passes the time goes in.

Not done here: the classic noise reduction (`denoise.js`) still uses the table, as it was tuned with it.
The Noise dial starts at 0 below ISO 400, so there more grain than the start's cannot be asked for yet.

## An export is never made a lesser way, and carries on where it stopped (2026-11-13)

The owner's words: the best method always, never the classic one in its place. Until now an export by the
network that failed was made again the usual way without a word, and one the phone cut off turned the network
off for a day. Both are gone.

- `export.js` `develop` asked for the network refuses where the network cannot run (`NoBest`, with why: the
  view's `lost`); nothing is written. At 100 % the editor says once that the standard view is what shows.
- Its bands are kept as they are made (`editor/app/export-kept.js`: the browser's private file system, a file a
  band, about 320 MB for 40 megapixels while it is being made). An export that fails is tried once more from
  there at once; one that stops again, or dies with the tab, leaves its bands, the Export board says how much
  is made already, and Save makes only the rest. The same file to the byte (tested). Cancel clears them; so does
  finishing, any edit (another export), and three days.
- Only the setting turns the network off. BEST AGAIN is gone with the reason for it.

Not done: an export still needs the page in front (a phone gives a hidden tab's GPU nothing); what is new is that
coming back loses one band's work, not the whole export.

## The network's passes, tried another way on each phone (2026-11-13)

Counted: a window (about a megapixel) is 35 thousand million multiply-adds, two thirds of them in the two 3 × 3
passes from 288 channels to 144, most of the rest in six 1 × 1 passes. The owner's phone makes a window in about
8 s. The passes as exported stage each tile's input and weights in the workgroup's own memory first, which pays on
a desktop GPU; a phone's GPU (Mali) has no such memory, and Arm's advice for it is not to copy there. Not assumed:
measured, on the phone itself.

- `net-tune.js` `ways` writes each of the nine middle passes to read its input and weights where they lie: the
  same sums in the same order, the same bindings and dispatch. The three 3 × 3 passes have a second way, sixteen
  outputs to an invocation over half the dispatches, so each input read feeds twice the sums. `tune` runs every
  pass every way on a real window, compares each result with the exported pass's (24 places across the output),
  and times them.
- A pass is run another way only where that agreed and took under 0.85 of the time; the fastest such. The choice
  is kept on the phone; `neural.js` compiles the chosen passes next time and still proves the whole network before
  using it (a choice that fails to compile or prove is forgotten).
- It ran with the weekly timing of the passes, after an export (until the engine test page took the measuring over: see below). The timings carry
  all three (`op0`..`op12` as exported, `alt0`..`alt10` read in place, `wid0`..`wid10` sixteen at a time; -1 none,
  -2 it disagreed).

On the software GPU here (a CPU, so no guide to a phone): the 1 × 1 passes 3 to 9 times faster read in place, the
large 3 × 3 passes the same read in place and 1.5 times faster sixteen at a time; every result identical, and the
picture the same to the last bit. What the phone finds is in its next timings. If the large 3 × 3 passes do not
gain there, they need another way, written with the phone's numbers in hand.

## A shot's film simulation, found by family (2026-11-13)

Found while comparing renders with the camera's own JPEG: a photo shot in CLASSIC Neg opened as CLASSIC
CHROME. `session.js` `asShot` passed over every simulation whose profile is a look's table (CLASSIC Neg,
NOSTALGIC Neg, BLEACH BYPASS, Sepia on the X-E5) and took the first label that began with the same word. It
now uses `recipe-map.js` `profileFor`, as the recipes card does. The decoder names BLEACH BYPASS as that (it
said ETERNA BB, which matched ETERNA), and a black-and-white shot by its kind and filter from the saturation tag
(Monochrome, ACROS, Sepia, +R, +Ye, +G), not just "B&W".

Measured the same day, not yet acted on: the camera's in-camera settings (highlight and shadow tone, colour, Color
Chrome, FX Blue, white balance shift, D-Range Priority) are all in the maker notes, and none but the film
simulation is applied when a RAF opens, as in Lightroom. On the owner's photos the camera's JPEG differs most
where Color Chrome and FX Blue are Strong (a blue sky far darker than ours with Chrome Blue at 100) and by its
tone settings (Shadow -2 lifts the darkest tones about a stop). `recipe-map.js`'s strengths were guesses; these
photos are what they can now be fitted to.

## The camera's own push, read from the RAF (2026-11-13)

A RAF records how far the camera pushes its sensor data to make the JPEG (its raw header's tag 0x9650, the raw
exposure bias: -0.72 stops on a usual shot). We went by the maker notes' DR setting alone, which says nothing of
DR Auto, of D-Range Priority (a stop or two more), or of the extended low ISOs (data a stop over, pulled back).
Measured against the camera's JPEG, pixel by pixel on small copies: the owner's ISO 100 night shot opened 1 to 2
stops brighter than the camera's, and the CC0 sample (D-Range Priority) about a stop darker. With the RAF's own
figure (`exif.js` `pushOf`, given as the DR number the developer adds back) both sit within about a third of a stop
of the camera's through the middle tones. A photo already edited keeps the brightness its edit was made at (its
saved edit has no `push` mark and more than its opening step).

Seen and left: on every photo compared, ours is about 0.3 stop brighter than the camera's through the middle. The
0.25 stop baseline was measured on the sample before its D-Range Priority was known; one neutral photo (PROVIA,
all settings 0) is not enough to move it for every photo. To settle with more neutral shots.

## New photos open in Adobe Color (2026-11-13)

The owner starts from Adobe Color, not the camera's film simulation, so that is now what "New photos open in"
(Settings > Photos > Editor) starts at; the film simulation is the other choice. A photo opened before keeps the
profile it has. With that, opening a RAF with the camera's own recipe laid on is not wanted and is not planned:
the recipes stay something the owner puts on.

## Color Chrome, fitted to the camera's JPEGs (2026-11-13)

Our render of the owner's RAFs against the camera's own JPEG inside each, pixel by pixel on small copies, sorted
by how saturated each colour is. With no Color Chrome in camera (a neutral PROVIA shot) the camera's lightness
over ours is the same at every saturation. With it at Strong the camera's strong colours are 12 to 15 % darker
than ours (a clear sky most of a stop), and at Weak about 8 %. Ours at 100 moved that sky by 0.02 stop: it worked
before the tone curve, on a chroma a sky never reaches there.

`grade.js` `chrome` now works on the developed colours (after the tone curve, as the camera does), by saturation
(chroma over lightness in Oklab, so a dark leaf counts as a bright one): nothing below 0.03, all from 0.18, up to
15 % off the lightness. On the Strong photo the camera's lightness over ours is within 3 % at every saturation
(it fell 12 % across them before); on the Weak one within 3 % at 60, which is what a recipe's Weak now sets.
A photo that already has Chrome on will look deeper than it did: that is the correction.

Not fitted yet: the highlight and shadow tone steps and the colour step. The dial fits did not separate them
from the baseline (every film-simulation photo wants about 0.2 to 0.4 stop less exposure to match the camera).

## The network measured on the engine test page (2026-11-13)

What the owner's slower phone said of an export on the build with the first tuner: 40 megapixels in 438 s, a
window in 5.6 s (the two 3 × 3 passes from 288 channels 1.9 s each), and every pass written another way
turned down. That tuner gave one mark to a way that would not compile and to a way whose result differed, and
held 16-bit sums to a tolerance made on a GPU that has none; it could not say which it was. It is replaced.

`/lab/engine/` has "The network on this phone" (`net-ui.js`, `net-bench.js`): one tap, a minute or two.

- Each pass every way (`net-tune.js` `tune`, the ways in `net-ways.js`): compiled with whatever the GPU's
  compiler says kept; timed, the least of two; its result against the exported pass's on the same input as
  numbers (the difference over the result's own size, the largest difference, values not finite counted). Three
  ways now: read in place; for a 3 × 3 pass, sixteen outputs to an invocation; one pixel and thirty-two outputs
  (the pixels of a workgroup lie together, where the exported pass's are four rows apart as its staging wanted).
- The choice is made on the whole picture. The window is made by the exported network in half floats, by the
  fastest way of each pass, and by the exported network in full floats, the truth both are held against. The
  ways are kept only if their picture is as near the truth as the exported half-float one is (mean and 999th of
  a thousand, in levels of 255 after a screen's curve), and the whole window clearly faster. If not as true,
  the way furthest from its exported pass is dropped and the rest tried again. Two orders of one 16-bit sum
  round apart; that is not an error, and the full-float picture says how much of it there is.
- The CPU, for the same work (`cpu-bench.js`, `engine/netcpu`): the heavy pass written for a CPU in WebAssembly's
  vector maths (the input pixel by pixel, eight outputs' weights to an input value, four pixels at a time),
  checked to the last bit against a plain loop, timed on one, two, four and all cores, with and without a fused
  multiply-add. Thousand millions of multiply-adds a second, beside the GPU's for that pass.
- The result is text to read and copy, kept on the phone, and its numbers go with the editor's timings.

An export no longer tries other ways: it times the passes as the phone runs them (`timed`), once a week.

Not checkable here: the software GPU has no half floats, so the ways' 16-bit code first compiles on a phone. The
page's report says what the phone's compiler says of each.

## What the slower phone found, and what followed (2026-11-14)

The owner ran the page's test on the slower phone (Arm, Valhall, half floats; 211 s). Every way of every pass
compiled and made the exported pass's result to the last bit, so the first tuner's refusals were its own fault.

| a window, ms | as exported | read in place | 16 outputs | 1 pixel × 32 |
|---|---|---|---|---|
| whole | 5391 | 2220 | | |
| 3 × 3, 288 to 144 (each of two) | 1877 | 765 | 1227 | 1364 |
| 3 × 3, 37 to 144 | 297 | 100 | 157 | 175 |
| 1 × 1 (six, together) | 1302 | 689 | | 1244 |

Read in place is 2.4 times faster on the whole window and was kept; the picture is the same (0 levels apart), and
both are 0.075 levels from full floats on average (0.75 at the 999th of a thousand): what half floats cost. Full
floats take 6271 ms as exported. The wider ways lose, so more sums held at once is the wrong direction on this GPU.
The CPU on the heavy pass's work: 4.6 to 5.6 thousand million multiply-adds a second on one core, 13 to 16 on all
eight, where the GPU now makes 14.9: about as fast as each other.

What followed:

- Two narrower ways for the 3 × 3 passes (`net-ways.js`): the four pixels of a 2 × 2 block, whose 4 × 4
  neighbourhood is read once a channel (sixteen reads where four pixels apart take thirty-six), with eight outputs
  to an invocation, and with four. Not yet run on a phone.
- A browser's ways chosen without anyone asking (`net-auto.js`): a moment after the network is first compiled,
  each pass is timed each way on a small part of a window, and the fastest that makes exactly the exported
  result is kept, the whole small window then held to be the same to the last bit. Exactness is its whole test; a
  way that only rounds apart is the test page's to judge, and what that page kept is replaced only by something
  exact and clearly faster. Once for each set of ways. A browser driven by a test is left alone.

Next, in this order: the export's overlap (it feeds the network overlapping pieces: maybe 15 to 30 %); then the CPU
beside the GPU, which the numbers above say is worth building.

## An export's pieces fit the network's windows (2026-11-14)

On the slower phone an export took 1.5 to 1.8 times as long a megapixel as a bare window. Reckoned on one of the
owner's photos (no network run: the pieces an export cuts, and the windows each needs): a piece was 960 × 512 of
the picture, and with its edge and the lens's reach (about 80 sensor pixels on this lens) nearly every piece
spilled a few pixels into a second window, which was made for them with all its context: 96 pieces, 171
windows, the network given 169 % of the photo. `full.js` `room` now keeps a network view's rectangle inside one
window (990 sensor pixels a side) wherever on the picture it lies, and an export asks for pieces that fill one
(`export.js` `NET_SIDE`): 54 pieces, 54 windows, 140 %. What is left is the context round each window, the edge
each piece is made past for sharpening, and the lens's reach; less than that would need the network's result
kept across pieces.

With larger pieces an export by the network says how far it is a piece at a time, not a band; and its timings
carry `laid`, what the network was given as a percentage of the photo, so the phone says what this came to.

## The CPU and the GPU at once, measured before it is built (2026-11-14)

On the slower phone the CPU's eight cores make the network's heavy pass about as fast as its GPU does (15.9
against 14.9 thousand million multiply-adds a second, each alone). If the two could work at once, an export
could give some of its windows to the CPU and take up to half the time. But a phone's CPU and GPU share its
memory and its heat, and the GPU's driver needs a core, so the speeds may not add, and the whole network on the
CPU is a large thing to build on a guess.

So the engine test page's network test now ends by measuring it (`frontend/lab/engine/net-both.js`): the GPU
runs its heavy pass again and again, as the phone will run it (the ways just kept), first alone, then while half
the cores, all but two and all of them make the same kind of layer; then the best of those is kept up for four
more stretches, to see whether it holds as the phone warms. The report says each pair, the sum against the GPU
alone, and the stretches; the numbers go with the timings (`gpu1`, `tog`, `togn`, `togl`).

What it decides: if the two together, kept up, are well above the GPU alone (say 1.4 times), windows on the CPU
are worth building, on as many cores as the best pair used. If they are not, the time is in the phone, not in
how its work is divided, and the CPU stays out.

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

- Upright (Crop reads LATER) and Fuji's 1.25× crop modes.
- Noise for a mask; detection masks (Subject, Sky, Background, People, Object).
- Search on the Looks board (and in the Weekly Fuji recipes); `.lrtemplate` and `.zip` looks; the recipes' strengths measured against the camera's JPEGs.
- Watermark and Display P3 on export; camera import over USB; renaming or moving a photo.
- Retouch spots that build on each other; a true content-aware Remove.

Step 8 (sliders that answer like Lightroom's, then `.xmp` presets and recipes) needs the owner's reference
exports from Lightroom. Step 9 is the owner's decisions: detection models, Auto white balance, profiles on their
Worker, backups, replacing the old editor.

## Waiting on the owner

Everything since step 1 was checked in headless Chrome on a software GPU, never on the phone. What only the owner
can tell:

- **Speed and memory on the A15.** How long a photo takes to open (the frame's shader has grown with every step:
  on the software GPU the first frame came within about 12 s at step 5 and takes about 18 s now; a real GPU may
  not notice, but it is the first thing to look at), how the dial feels, how long 100 % and an
  export take, and whether the tab ever reloads (a photo keeps about 80 MB on the GPU for its sensor pixels, 35 MB
  for the editing copy, and each full-size view its own buffers).
- **How the controls feel.** Every strength is a first guess: Clarity, Texture, Dehaze, Sharpening, the two Noise
  sliders, the mixer, grading, Color Chrome, vignette, grain and its size, the masks' Temp and Hue, Defringe, the heal's feather.
- **Touch.** The pinch, painting a mask, laying a gradient, dragging a heal source, two fingers against one on
  the Masks and Heal boards: all were driven by synthetic events here.
- **Their own photos.** High-ISO RAFs for noise reduction, a dusty sky for heal, a backlit edge for Defringe,
  five or six RAFs they would really edit.
- Whether the Library's delete (the Rejects subtitle, two taps) is acceptable or wants a real button.
