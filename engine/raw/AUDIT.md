# The editor, audited part by part (begun 2026-11-15)

The owner asked for a complete audit of the photo editor, read and run by one reader, with every finding written
down and **no code changed** until the audit has been compared with the true ceiling. This is that record.
[REVIEW.md](REVIEW.md) is the earlier talk about how good the editor is; [STATUS.md](STATUS.md) says what is built.

How to read a finding. **Proven**: reproduced here, with the measurement. **By reading**: seen in the code, not
run. **Suspect**: a mechanism that fits, not shown to be the cause of anything. Severity: **A** a wrong picture, a
lost photo or edit, or something the owner would feel on every use; **B** a real fault, small or rare; **C** a
nicety, or a note for whoever works there next.

What every run here was: the editor in headless Chromium on a software GPU (SwiftShader), at 412 × 915 and
390 × 844, with JPEGs and made-up mosaics. The repository holds no RAF and no camera profile, so **nothing here
was checked on a real RAF, with an Adobe profile, or on the phone**. Where that matters it is said.

## Part 1: the frame, colour, full size, sharpening, noise, geometry, export, and the app's core

Read whole: `engine/wgsl.js`, `gpu.js`, `dcp.js`, `grade.js`, `mask.js`, `full.js`, `finish.js`, `deconv.js`,
`denoise.js`, `noise.js`, `noise-fit.js`, `warp.js`, `lens.js`, `mend.js`, `demosaic.js`, `export.js`,
`reduce.js`, `files.js`; `editor/app/session.js`, `adjust.js`, `zoom.js`, `store.js`, `save.js`, `past.js`,
`dc.js`, `boards/DialPlate.js`.

| # | Sev | Kind | Finding |
|---|---|---|---|
| 1.1 | A | Proven | **The dial moves by itself after the finger lifts.** `DialPlate.js:24` puts the wheel on the value's own place whenever the board is drawn again and the two differ by more than 1°. A value is rounded to its step, so on any control whose step is over 2° of the wheel the wheel jumps up to half a step some hundreds of ms after the lift (Noise: held at −178.09°, at −176.4° 500 ms later). Open to it: every 0 to 100 control (3.6° a step: Noise, Color noise, Detail, Grain, Grain size, Chrome, Blending, Defringe), Sharpening and Amount (2.4°), Radius (14.4°), Temp below about 5200 K. Not: Exposure, Tint, the ±100 controls. It happens only when the finger stops more than 1° from the rounded place, so "at times". A fix was drafted and set aside (the wheel follows only a change made elsewhere; a coarse step clicks in as the finger lifts), with a test that fails on today's code. |
| 1.2 | B | Proven | **The arrow keys cannot move Radius.** A press turns the wheel 3.6°, under half of Radius's 14.4° step, and 1.1 puts it back: six presses left 1.0. The same fix lets presses add up. |
| 1.3 | B | Proven | **Black is never quite black.** `wgsl.js:274` `moved()` holds a colour to no less than 2⁻¹² before the table's move is laid on, so a channel at 0 comes out at 2⁻¹² (0.8 of a level of 255). An untouched picture's level 0 exported at a mean of 0.78 (every other level within 0.08); a zero channel of a strong colour likewise ((255, 0, 0) → (255, 1, 1) on most pixels). For a RAF under Adobe's default curve the floor works out at 0.64 of a level. Invisible, but "an untouched export is the file's own pixels" is false at zero, and no histogram reaches 0 (`scope.js:21` counts ≤ 1 as clipped, which hides it). |
| 1.4 | A | Proven | **A reduced export is softer and has more moiré than it should.** `reduce.js` brings a band to size by an area average. On a zone plate taken 7728 → 2048: moiré left past the small picture's limit 13.6 of 255 (Lanczos-3: 6.1); contrast kept at 0.8 of the limit 78 % (Lanczos-3: 100 %), at half the limit 91 % (102 %). REVIEW.md row 23 calls the area average "the same" as the best known; it is not. Every Small export, and any export under full size. Output sharpening partly hides the softness and does nothing for the moiré. |
| 1.5 | B | Suspect | **The wheel's picture is one 47 MB image.** `assets/dial-strip.webp` is 1648 × 7200 (twelve frames); it took 244 ms to decode here. Chromium keeps it as one texture, and a simulated memory-pressure notice made it throw the texture away and make it again (trace: one `CreateImageData` and `UploadImage` after the notice). Large images are drawn after the rest of a tile, so the wheel may be missing for that long after heavy work or a return from the background. Not caught on screen here; needs the phone. Only 98 of each frame's 150 rows are ever shown on the boards (the Library's cull shows all 150), and the phone needs 1081 px of its 1648. |
| 1.6 | C | Proven | **A 16-bit TIFF holds 1024 levels a stop.** The full-size frame is written as half floats (`full.js:106`). In a TIFF made from the real file the top stop (32768 to 65535) held 938 distinct values of 32768 and the next 1024 of 16384: eleven bits in the highlights, finer than 8 bits by eight times, not 16. |
| 1.7 | C | By reading | PNG export is 8 bits only (`files.js:117`). |
| 1.8 | C | By reading | The export's 16-to-8-bit dither (`files.js:34`) is a flat random number for each channel on its own; the screen's (`wgsl.js:71`) is triangular and the same on all three, "no colour speckle". The file's has a little colour speckle at one level, and its noise changes slightly with the value. |
| 1.9 | C | By reading | `film()` (`wgsl.js:139`, the curve for sensor data with no profile) weighs linear ProPhoto by Rec. 709's luminance numbers; `LUM` two lines above is ProPhoto's. Only photos developed with no profile. |
| 1.10 | C | By reading | A look's `.cube` table and a profile's RGB table are read between eight points (`grade.js:115`, `wgsl.js:140`); the engine's own table is read tetrahedrally (`wgsl.js:93`) for the reason its comment gives. The same reason holds for a look's. |
| 1.11 | C | By reading | `store.js:17` opens the database anew for every read and write and never closes it; `tx` (`store.js:23`) answers when the request succeeds, not when the transaction is committed. No loss seen; a save that reports done a moment before it is durable. |
| 1.12 | C | By reading | `dcp.js:77` `D50` is unused (the adaptation uses its own, slightly different, numbers on line 82). |
| 1.13 | C | Proven | A picture whose sides are not multiples of three loses a row or two at the right and bottom (`picture.js`, by design, said in its comment): 1200 × 800 exports as 1200 × 798. For a RAF the decoder crops the same way. |

Checked and sound in this part: the DNG colour maths (`dcp.js`: forward matrix, Bradford for a matrix alone,
Temp and Tint; a round trip through Temp and Tint moves the gains by under 0.004 of a stop between 3000 and
7500 K, 0.016 at 2500 and 12000); the order of the frame against the DNG specification; the hue-preserving tone
curve; the table's reading and its square-root form; the tone masks' guided filter; the noise transform (it is
darktable's own, with darktable's numbers); the deconvolution; the lens tables; the resize's weights (they sum to
one); the JPEG's restart-marker join; saving when the page is hidden; an export's resume, cancel and wake lock;
the history's branching and its 60-step cap.

## Real files, from here on

From Part 2 on the editor was also run on real 40 MP X-Trans RAFs: a public-domain X-T5 file from raw.pixls.us
(XF 18 mm f/2, ISO 125) and six of the owner's X-E5 files (XF 23 mm f/2.8, ISO 100 to 800), which the owner said
to take from the Worker's workshop folder (`scripts/workshop.mjs`). They were kept outside the repository and
are in none of its files. Still on a software GPU, and with no Adobe profile (the camera matrix and the filmic
curve stand in), so colour as the owner sees it is still unchecked. Also read: the two `editor-timings.json`
files the phones sent (a 4 GB phone on build 6f38b35 and an 8 GB phone on build 3762dda; the editor's code has
not changed since 3762dda).

## Part 2: the decoder, the second look, pictures

Read whole: `engine/raw/src/lib.rs`, `hot.rs`, `Cargo.toml`; `engine/decode-worker.js`, `demosaic-again.js`,
`picture.js`; `editor/app/decoder.js`.

| # | Sev | Kind | Finding |
|---|---|---|---|
| 2.1 | B | By reading | **A decoder that fails once may keep failing.** `decoder.js` starts a new thread only when the thread itself dies (`error`). A decode that traps inside WebAssembly (out of memory on a large RAF, a file rawler chokes on) is caught in `decode-worker.js` and answered as an error, and the same thread, with whatever that decode left held, takes the next photo. Nothing lets go of it but a reload. |
| 2.2 | C | By reading | **The decoder holds its largest moment for good.** WebAssembly memory never shrinks: after one 40 MP decode the thread keeps the RAF's bytes, the sensor data (80 MB) and two copies of the editing copy's worth (`proxy()` clones 35 MB it could hand over, `lib.rs:43`) for as long as the page lives, on a 4 GB phone. Not measured here. |
| 2.3 | C | Proven | The public X-T5 file opened whole: 7728 × 5151 (the sensor's last row is left off, as 1.13), its Exif, lens data and film simulation read, no error. |

Checked and sound: the binning (each 3 × 3 cell's reds and blues are centred on the cell, so the editing copy has
no colour shift); the clipped flags and `chroma()`; hot pixels (cautious, tested); the second look against
Markesteijn's own second pass; a JPEG's orientation and colour space on both its paths; a failed or left-behind
answer from the thread.

## Part 3: the network (what an export and a rested 100 % view are made by)

Read whole: `engine/neural.js`. Run on the real files.

| # | Sev | Kind | Finding |
|---|---|---|---|
| 3.1 | **A** | Proven | **The network leaves colour fringes where the lens spreads colours, and the usual demosaic does not.** The usual demosaic reads red and blue from where the lens drew them (`demosaic.js` `lead`: done 2026-11-11 because undoing fringing afterwards "cost 3 dB at half a pixel and nearly 7 at one"). The network is given the sensor data as recorded and the fringing is undone after it, in the lens pass (`full.js:142`): the very order that was measured and dropped for the usual demosaic. Measured as fine colour speckle (red minus green against its own local mean, rms, levels of 255), usual against network: the public file (18 mm f/2) centre 2.3 / 1.9, left edge 1.2 / 3.1, right edge 1.6 / 6.1, on solar panels near the right edge 1.4 / 10.8; the owner's 23 mm f/2.8: centre 1.7 / 0.9, 1.0 / 0.8, 2.5 / 1.0; edges 1.5 / 5.0, 1.2 / 2.8, 2.5 / 5.6, 2.1 / 5.3. So the network is the cleaner of the two in the middle of the frame and two to seven times worse towards its edges. Seen at 4 ×: purple and green rims on every hard edge and a cable drawn purple on the 18 mm; red and cyan dots along a hard edge on the 23 mm. Exports are made by the network unless the setting is off, and so is what shows from 100 % once the photo rests: this is in the owner's exported files now. The owner's choice of "the network is best" (2026-11-12) was made on the compare page; whether at the frame's edge is not recorded. |
| 3.2 | C | Proven | No seam between the network's windows: the same place made from two rectangles, 200 pixels apart, differs by 2 levels at most (the dither), mean 0.47, the same as the usual demosaic's. |

Not yet read in this part: `net-pace.js`, `net-tune.js`, `net-auto.js`, `net-ways.js`, `net-both.js` (how the
network's work is cut up and timed), `noise-fit.js`'s use by `full.js` on real files.

## What the phones' own logs say

The editor notes how the page kept up (`app/moved.js`: a frame over 34 ms is "slow"). From the two files sent:

| | 4 GB phone | 8 GB phone |
|---|---|---|
| Dial turned, photo fitted | 83 frames, none slow, worst gap 33 ms | 74 frames, 1 slow, worst 42 ms |
| Dial turned, photo at 300 % (11 turns each) | 11 % of frames slow, worst gaps 67 to 133 ms | 25 % slow, worst 75 to 166 ms |
| Pinch, pan, glide (24 and 26 gestures) | 4 % slow; four stalls of 200 to 277 ms and one of 1155 ms | 1 % slow; stalls of 168, 193 and 283 ms |
| A photo opened | 2.8 to 5.3 s | 2.5 to 2.7 s |
| 100 % turning sharp | median 0.6 s, to 10 s the first time | median 1.0 s, to 3.4 s |
| A 40 MP JPEG by the network | 119 and 121 s (107 s of it the GPU) | 53 s |

| # | Sev | Kind | Finding |
|---|---|---|---|
| P.1 | **A** | Proven (the phones' logs; the cause here) | **The dial stutters when the photo is zoomed in.** Fitted, a turn is smooth on both phones. At 300 % one frame in nine (4 GB) or one in four (8 GB) is late, with gaps to 166 ms. A turn's frame draws the fitted photo and the full-size view both (`session.js:162` `draw()` → `gpu.js:196`), though at 100 % and beyond the view covers the fitted photo whole. On the software GPU with a phone's screenful (1083 × 1939): both 6483 ms, the view alone 2533, the fitted photo alone 4065: 62 % of a zoomed turn's frame goes on a picture that cannot be seen. `draw(false)` already draws the view alone. |
| P.2 | B | Proven (the phones' logs) | **Zooming and panning stall now and then**: 200 to 283 ms on both phones, once 1155 ms. The road map's own line for this ("no frame over 33 ms during a gesture") is not met. Cause not found here: the log does not say what the page was doing in the gap. |
| P.3 | B | Proven (the phones' logs) | **A best-quality export takes two minutes on the 4 GB phone**, nearly all of it the network on the GPU. `laid: 129` in both logs: the network is given 1.29 times the photo, which is what one window a piece comes to (of a window's 1056 pixels each way, 30 at each side are context, 16 the lens pass's margin and 12 the join's: about 940 are kept). |
| P.4 | C | By reading | The dial's own record never says whether a full-size view was being made when the finger came down (`DialPlate.js:60` passes `false` for `busy`), so the logs cannot tell a turn that waited on the network from one that did not. |

## Part 4: masks, the brush, heal, crop and level

Read whole: `engine/local.js`, `brush.js`, `heal.js`, `mend.js`, `crop.js`, `level.js`; `editor/app/masks.js`,
`app/heal.js`; `boards/MaskPlate.js`, `CropPlate.js`, and `HealPlate.js`'s size and dial. Driven on the real RAF.

| # | Sev | Kind | Finding |
|---|---|---|---|
| 4.1 | B | Proven | **Auto level undoes itself on a second press.** `CropPlate.js` (`auto`) reads the lean from the picture as it is now cropped and straightened (`session.js` `level()` → `pixels()`), then sets Angle to minus that, where it should take it off the angle already set. On the real file: as opened the picture leans 0.64°; after AUTO the angle is −0.6 and it leans 0.08; after a second AUTO the angle is −0.1 and it leans 0.52; after a third −0.5. |
| 4.2 | C | Proven | The Heal board says a spot's size two ways at once: the dial's window in pixels on screen ("12 px") and the row under it as the dial's own 0 to 100 ("6") (`HealPlate.js:37, 83`). |
| 4.3 | C | By reading | A painted mask is 1024 pixels on its longer side (`brush.js` `LONG`), so its finest edge is 7.5 sensor pixels wide on a 40 MP photo whatever the brush's feather. |
| 4.4 | C | By reading | A radial mask cannot be turned: its axes always lie along the upright picture's (`local.js` writes its turn as 1, 0; the board has no handle for it). |
| 4.5 | C | By reading | How fast a slow brush stroke builds up depends on how often the phone reports the finger (`brush.js` lays at least one dab for each reported move): the same stroke builds faster on a 120 Hz screen than on a 60 Hz one. Drawn again it is always the same. |
| 4.6 | C | By reading | A range mask at full size reads each sensor pixel's own colour, the fitted photo each 3 × 3 mean: at 100 % a colour or brightness range has a noisier edge than the fitted photo showed. |

Checked and sound. A radial mask's centre, a linear mask's end, a brush stroke's first point, a heal spot and its
source were each followed through a quarter turn, a flip, a 7° straighten, a perspective tilt and a crop: each
stays on the same sensor pixel to within one (`raf5.mjs` in the audit's scratch). The heal's fit is the membrane
solution on a disc to its third harmonic, and the shader adds up the same terms `heal.js` fits. The source's
offset is a whole pattern in every pass. The mask and spot limits (eight masks, four painted, 32 spots) are held
where they are added. The crop's perspective and its "least enlargement that covers".

## Part 5: Auto, white balance, haze, looks' tables, the files an export writes

Read whole: `engine/auto.js`, `autowhite.js`, `white.js`, `haze.js`, `cube.js`, `look.js`, `profiles.js`, `icc.js`,
`exif.js`, `export-thread.js`, `export-worker.js`. Files made from a crop of the real RAF through `app/save.js`
(JPEG at 60, 95 and 100, PNG, 16-bit TIFF, a reduced and sharpened JPEG; sRGB and Display P3; metadata All,
Copyright only and None) and read with other tools: Pillow, littlecms and ImageMagick (libtiff).

| # | Sev | Kind | Finding |
|---|---|---|---|
| 5.1 | C | Proven | Every file opened in the other tools at the right size. Exif carried right (1/160 s, f/4, ISO 125, 18 mm, the lens, upright, the export's own size, no place); with None nothing but the profile a P3 file needs; with Copyright only the artist alone. |
| 5.2 | C | Proven | The Display P3 profile is well formed (littlecms reads it as "Display P3", version 4.3) in a JPEG, a PNG and a TIFF, and a P3 file brought back to sRGB by littlecms matches the sRGB file to 1 level at most (mean 0.23). |
| 5.3 | C | Proven | No step at a JPEG's joins: rows at the 256-row joins differ from the PNG by 1.14 levels, the other rows by 1.15. |
| 5.4 | C | Proven | The TIFF is valid to libtiff (little-endian, tags in order, 16 bits, no compression) and matches the PNG to within the PNG's own dither. libtiff warns of three things carried over from the camera's Exif: tag 50341 (PrintIM), the interoperability pointer inside the Exif directory, and a copyright text that holds a zero byte. Harmless; a stricter reader might complain. |
| 5.5 | C | By reading | A `.cube` file that states an input range other than 0 to 1 in Resolve's way (`LUT_3D_INPUT_RANGE`) is read as if it were 0 to 1 (`cube.js:13`: only `DOMAIN_MIN` and `DOMAIN_MAX` are checked). |
| 5.6 | C | By reading | The exported file's Exif still names the camera's firmware as its Software and the camera's own DateTime; nothing says the file was developed here but the note in its comment. |

Checked and sound: Auto tone's arithmetic against the shader's `relight`; Auto white balance (votes on the locus,
the camera's white as a prior); the eyedropper; the air light; Adobe's look files and the DNG spline; the zip
readers' bounds; the ICC profile's layout field by field; the Exif tree's reading in both byte orders and its
writing; the export thread's hand-over, its two-band limit, cancel and failure.

## Part 6: looks, presets, recipes, copy and paste, starts

Read whole: `editor/app/looks.js`, `xmp.js`, `recipes.js`, `recipe-map.js` (its head), `pack.js`, `cube-out.js`,
`starts.js`, `clip.js`.

| # | Sev | Kind | Finding |
|---|---|---|---|
| 6.1 | C | By reading | A look saved as a `.cube` table is read back from an 8-bit frame (`cube-out.js`: `px / 255`), so its answers have 256 levels; said in its own notes. On video graded hard it can band. |
| 6.2 | C | By reading | A Lightroom preset's parametric curve (its Shadows, Darks, Lights, Highlights regions) has no control here and is counted among what was left; its point curve is laid on. The strengths are Lightroom's numbers on this editor's dials, not matched (said in `xmp.js`). |
| 6.3 | C | By reading | Pasting an edit on many carries Noise, which is set by each photo's ISO, and the lens corrections by hand, with everything else (`clip.js` `laid`): a series at mixed ISO takes the copied photo's Noise. |

Checked and sound: a look kept once however often its pack is picked; a pack's size limits and its refusal of
what it cannot read; wearing a look leaves the photo's exposure, white balance, crop, masks and spots; the
match's exposure arithmetic; a start laid on a new photo's whole history.

## Part 7: stacking and backup

Read whole: `engine/stack.js`, `editor/app/stack.js`, `app/backup.js`, `app/kept-view.js`, `app/export-kept.js`.

| # | Sev | Kind | Finding |
|---|---|---|---|
| 7.1 | B | By reading | **A photo is marked as in Drive when its upload is handed over, not when it has finished.** `backup.js` `run` writes `source: photos:<id>` as the upload is registered and counts a photo "handed to the browser to finish in the background" as backed up; the page then goes back to the editor. If that upload later fails with the page gone, nothing takes the mark off, the Library says "Everything here is in your Drive", and the photo is never offered again (`!p.source`). Whether Photos' own import always finishes or reports such an upload was not followed here. (The owner parked Drive on 2026-11-12.) |
| 7.2 | C | By reading | In a stack of frames shot alike, a sensel over 0.9 of the range takes the first frame alone (`stack.js` `summer`, `app/stack.js` `CLIP`): bright areas get none of the stack's noise gain. They need it least. |

Checked and sound: the sum of a bracket (each sensel's light over the time it was open, to its first clipped
frame); a frame that moved or was shot otherwise left out; the stack's levels and the ISO its noise answers to;
the kept picture shown only for the edit it was made from; an export's kept bands keyed by photo, edit, method,
settings and build, and cleared.

## Part 8 (begun): the Library

Read whole: `boards/LibraryPlate.js`, `app/tiles.js`, `scope.js`, `fling.js`, `taps.js`, `moved.js`, `timings.js`,
`haptic.js`, `told.js`. Run with twelve real RAFs.

| # | Sev | Kind | Finding |
|---|---|---|---|
| 8.1 | **A** | Proven | **Every Library tile is the camera's whole preview.** An X-E5 RAF carries a 4416 × 2944 JPEG (13 MP, 4 to 5.5 MB); `store.js` keeps it as the photo's picture and the grid shows it in a tile 137 pixels wide (`index.html:378`, a plain `<img>`, every photo's at once, none left for later). With twelve RAFs, drawing the grid took 92 decodes and 7.4 s of decoding on four desktop cores (0.1 to 0.14 s a tile); a phone is slower. Every photo's file is also looked up before the Library first shows (`store.js` `init`), so opening the app takes longer with every photo kept. A tile of an edited photo is already a small picture (480 pixels, `saveTile`); an unedited one is not. Scrolling a roll of hundreds decodes hundreds of 13 MP pictures. |
| 8.2 | C | By reading | The Library reads the whole roll again, and every photo's search words, at every change of the open photo (`LibraryPlate.js` `hear` → `roll()`), and redraws every tile. |
| 8.3 | C | By reading | The histogram reads the whole fitted frame back from the GPU (17 MB) and counts it on the page each time the photo has changed while the View board is up (`scope.js`); the 100 % view's small map does the same at each rest (`zoom.js:261`). Neither runs while a finger moves. |

Checked and sound: delete, the seven days, bring back, empty (each two taps); the three "many" actions armed by
a second tap within five seconds; a cancelled export of many; Find's words.

### Part 8, continued: the View, Export, Curve and Grading boards, the drum and the rows

Read whole: `boards/ViewTools.js`, `ExportPlate.js`, `Drum.js`, `Row.js`, `Strip.js`, `CurveOverlay.js`,
`GradeWheel.js`. Driven on the real RAF.

| # | Sev | Kind | Finding |
|---|---|---|---|
| 8.4 | B | Proven | **Before and after do not show the same picture once a photo is cropped.** The "before" is the photo as imported, drawn whole (`ViewTools.js` `tile('before:', first.st, 0)`: the first step has no crop), and laid into the cropped picture's box. With a crop to the right half and a 6° straighten: left of the line the whole uncropped scene, squeezed to the crop's shape; right of it the crop. Press and hold shows the same squeezed whole. A crop is the commonest edit there is. |
| 8.5 | B | Proven | **The fitted photo carries false colour on fine lines.** The editing copy is each 3 × 3 block of the sensor averaged by colour with no demosaic, so a thin line lands on the block's reds, greens and blues unevenly. On the solar panels of the real file its fine colour speckle is 6.7 / 9.1 (red and blue against green, rms levels), where the sensor's own pixels brought to the same size give 1.9 / 3.8. It shows where the editing copy is near one of its pixels to a screen pixel: a crop, or any zoom short of the 40 % at which the sensor's pixels take over (`zoom.js:263`), and on every board that shows only the editing copy (Crop, Export's preview). Saturation makes it plainer. |
| 8.6 | C | Proven | On the View board the line under a photo's name wraps to a second row at 412 wide ("… · ISO" / "125"): its header has three keys where Edit's has two. |
| 8.7 | C | By reading | A point of the curve cannot be taken off again (`CurveOverlay.js`: a touch adds or moves; only Reset straightens the whole channel), and the curve's two ends move up and down only: the black point cannot be pulled along the floor. |
| 8.8 | C | Proven | With no camera profile on the phone a RAF is developed by the camera's matrix and a plain curve, yet the boards still name its film simulation ("DSCF0021 · PROVIA · edited"). If the private profile set is ever lost from the phone's storage, nothing says so. |
| 8.9 | C | By reading | The Export board's long-edge dial steps 64 pixels in 3.2° of the wheel and its choices by a third of the window: both are open to 1.1 (the wheel moving after the finger lifts). |

Checked and sound: the drum's settle and flick; a row's fade where it runs on; a strip bringing its chosen tile
to the middle; the grading wheel's hues against the engine's (`towards`); an export's two taps, its estimate,
cancel and the share sheet; the histogram's counts.

