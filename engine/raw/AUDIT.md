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
| 1.6 | C | By reading | **A 16-bit TIFF holds about 11 bits in the highlights.** The full-size frame is written as half floats (`full.js:106`), whose step between 0.5 and 1 is 1/2048. Finer than 8 bits by eight times; not 16. |
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
| P.3 | B | Proven (the phones' logs) | **A best-quality export takes two minutes on the 4 GB phone**, nearly all of it the network on the GPU. `laid: 129` in both phones' logs: the network was given 1.29 times the photo (the fix of 2026-11-14, `export.js` `NET_SIDE`, is in the build the 8 GB phone ran, and its log still says 129: either that export ran before the fix reached the phone or the fix does not do what its comment says. Not settled here). |
| P.4 | C | By reading | The dial's own record never says whether a full-size view was being made when the finger came down (`DialPlate.js:60` passes `false` for `busy`), so the logs cannot tell a turn that waited on the network from one that did not. |

