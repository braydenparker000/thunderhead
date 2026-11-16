# The editor: handoff after the audit (2026-11-16)

For whoever carries on, a person or a model that was not here. Read this, then [AUDIT.md](AUDIT.md) (every
finding, with its measurement), then [../../AGENTS.md](../../AGENTS.md). [STATUS.md](STATUS.md) says what is
built, [ROADMAP.md](ROADMAP.md) what was agreed before the audit.

## Where things stand (updated 2026-11-16, second session)

- The audit's fixes are built, on `claude/zealous-brahmagupta-bnap32`, in one pull request (the owner, 2026-11-16:
  "build build build and ship all at once ... less PRs, quicker to live"). What each did, as measured here:

| # | Fix | Measured (software GPU; the phone not checked) |
|---|---|---|
| 3.1 | `net-fringe.js`: red and blue laid on green's places before the network (each site read round where the lens drew it, carried by its ratio to green; green beside a site weighted four times a corner's); the lens pass no longer undoes fringing after the network | known picture, fringed, colour in the outer ring: 27.3 → 34.0 dB clean (usual 34.0), 27.3 → 33.9 at ISO 3200 (usual 33.7); centre 33.2 → 35.9. Real files, speckle at the right edge: public RAF 6.1 → 1.1 (usual 1.6), one of the owner's at ISO 800 36 → 9.2. Rims gone by eye. No reference picture moved (no fringing there) |
| P.1, P.4 | `session.js` `draw`/`cover`, `zoom.js`: from 100 % an edit draws the view alone; the fitted photo 300 ms after edits rest. The dial's log says `busy` | `tests/lab-editor-zoomed-browser.test.mjs` (fails without it). The phone's log is the real proof |
| 1.1, 1.2 | `DialPlate.js` (the set-aside patch) | its test fails without it |
| 1.4 | `reduce.js`: Lanczos-3 in linear light, each result held between the least and most of its central taps; output sharpening of a reduced file eased by what the old softness took (`0.892 a − 0.216`) | zone plate through `reduce.js` itself (sRGB numbers, as the export hands them): moire 12.0 → 7.4, contrast at half the limit 0.91 → 1.00, at 0.8 0.76 → 0.94; a bright bar leaves nothing darker than the dark side. 26 MP → 1.8 MP: 0.4 s → 1.3 s here. Page and thread still the same to the byte |
| 8.1 | `store.js`: a 480 px tile at import, made in the background for older photos; the grid lazy; the cull view reads the camera's JPEG when shown | 12 RAFs: 6.5 s of decoding → 0.14 s; tiles 320 × 480. Import costs about 0.6 s a RAF more here |
| 4.1 | `session.js` `level`: the lean read with no straightening | `raf6.mjs`: −0.6, −0.6, −0.6 |
| 8.4 | `ViewTools.js`: before drawn with the present crop | `raf8.mjs`: both halves one scene; before 79.3 = the hold's |
| 1.3 | `wgsl.js` `moved`: an offset under the floor | `exact.mjs`: level 0 → 0. bench-ref.json made again: frame, cut, edited moved at most 0.0013; nothing else |
| 8.10 | `app/name-sheet.js` | `tests/lab-editor-small-fixes-browser.test.mjs` |
| 8.11 | `editor.css` reduced-motion rule | the same test |
| 2.1 | `decoder.js`: a thread whose decode failed is let go once its other work is done | the same test |

- **Second round, the same day** (the owner: "start on export speed ... research how the image should be displayed at
  all zoom ranges ... then implement ... make sure the UI is free of glitches"):

| # | Fix | Measured here (software GPU; the phone not checked) |
|---|---|---|
| P.3 | `net-cpu.js`, `net-cpu-worker.js`, `engine/netcpu` (`conv3r`, `conv1r`, `head`): an export by the network hands windows to the CPU's cores while the GPU makes the others; the GPU still does each window's `cut` and `place`. `export.js` `pacer`: the CPU takes a piece only while the GPU's remaining pieces would outlast it, and drops out at four times the GPU's time | a CPU window's raw values within 1.2e-6 of the GPU's; an export helped by the CPU differs from one without in 52 of 6.7 M values, by one level. The phone's own numbers (`tog` 32 against `gpu1` 18.5) predict about 119 s → 70 s on the 4 GB phone: **its next `save` log (`cpu`: pieces, `cores`) is the proof** |
| 8.5 | `proxy-hq.js`: once the sensor is on the GPU the editing copy is made again from full resolution, as Lightroom makes its smart previews: the usual demosaic (fringing left to the copy's own lens pass) a 1026-pixel tile at a time, each shrunk to a third by Lanczos-3 in linear light, held to its 3 x 3 (no ringing), for the copy's brightness; its colour from each colour's own sites (a Gaussian as wide as the decoder's box), which keeps the demosaic's moire on the finest patterns out. A JPEG: Lanczos-3 from its own pixels. A GPU that would take over 30 s (timed on two tiles) keeps the decoder's copy. 2026-11-16, after the owner saw the fitted photo as "kinda low quality" beside the camera's JPEG (a Gaussian alone, sigma 1.1 then 0.82, came first and was softer or no sharper) | the known photo: pixel-to-pixel step 0.0150 → 0.0167, false colour 0.0040 → 0.0033 (−17 %); the owner's RAF fitted at a phone's size: fine texture 9.08 → 9.53 (+5 %), colour speckle 4.16 → 3.76 (−10 %); 40 MP on a software GPU: 306 s, so kept. The camera's JPEG is still punchier (contrast, Fujifilm's sharpening): sharpening at full resolution before the shrink, as an export does, showed +9 % against +5 % here |
| — | **Taken out 2026-11-16, the day it went live.** `present.js` shrank the fitted frame to the screen's own pixels on the GPU (Lanczos-3 in linear light). It took the zone plate's false ripple from 16.5 to 7.4, but the owner saw the fitted photo as much softer on the phone: on their RAF, detail 26.5 → 24.5 on a brick wall, with wires and mortar lines fainter (linear-light averaging thins dark lines). The browser's own shrink is back. A crisper GPU shrink (in the picture's own numbers, a shorter filter) is the way to try again, judged on the phone | — |
| — | `editor.css` `.zl`: zoom's sharper layers fade in; from 200 % they show as crisp pixels | by reading |
| — | `zoom.js` `follow`: the photo glides whenever its window moves or resizes, not only as a board takes it (it jumped 14 to 42 px when a board's panel settled after it showed) | the glide's frames cannot be seen on a software GPU: **check on the phone** |
| 8.6, 8.12, 8.13, 8.15, 4.2 | headers on one line with an ellipsis; the curve's readout top left; a focus ring for keys only; the white balance menu shuts as the dock rises; Heal's Size in pixels in the row too | by reading and the boards looked at |

- **Third round, the same day** (the owner: "Do 2,4,5,6,7 in one pr"), after the owner found the fitted photo low in
  quality beside the camera's JPEG. Found on the way: **the fitted photo showed no Sharpening and no Noise at all** (only
  100 % and exports apply them), so it was softer than any export of it.

| # | Change | Proved here (software GPU; the phone not checked) |
|---|---|---|
| 2 | `zoom.js` `detail`: below 40 % too, once the photo rests, its full resolution is drawn in tiles onto the still canvas at the screen's size (Sharpening and Noise as an export makes them); not on Masks (its red mask is on the fitted photo); only where this phone's own time a sensor pixel (`perPx`, measured on every tiled view) says it is done in 10 s (`LOW`), else the copy stays. `detail` timings are noted at fit too | `tests/lab-editor-hq-browser.test.mjs`: the layer at the screen's size, with more than 1.1 times the copy's fine detail at Sharpening 100. Fixed with it: an edit is told before its frame begins, so a still canvas could stay over a one-tap edit; it is now hidden once the frame has begun |
| 4 | `session.js` `wideScreen`: on a `(color-gamut: p3)` screen the photo, its 100 % view and the still canvases are drawn in Display P3 (canvases set up for it, `gpu.js`/`full.js`/`zoom.js`); tiles, the histogram, kept pictures, `.cube` tables and sRGB exports stay sRGB (`unseen`, explicit `wide`); after any export the screen's colours are put back | the same file: the canvas is P3, sRGB's red reads (234, 51, 35) in P3's numbers, the histogram's pixels stay (255, 0, 0) |
| 5 | `export.js` `clock.parts`; `save.js` `helped`; the Export board: "Saved to Downloads · 72 s · CPU made 9 of 40 parts" | by reading: the phone's next export says it |
| 6 | `moved.js`: whatever can hold a frame up marks itself (`th:frame`, `th:part`, `th:tile`, `th:map`, `th:board`, `th:copy`) and the browser's long tasks are watched; a gesture's log says what ran in its worst gap (`ran`) | the same file: a frame held 400 ms by a tile says `tile` |
| 7 | `flip.js`: fitted, the photo goes to another board's window by its transform alone (the layer takes its place at once, then a transform eases the photo from where it showed); zoomed in, the window's edges still glide | the same file: only `transform` animates, the layer's box is not eased, it lands on its fitted place |

- **Fourth round, the same evening: the editor rebuilt to be safe on a small phone** (the owner: "Let's design the system
  from the ground up exactly how it should work"). After the third round went live, a photo opened over and over on the
  owner's Galaxy A35 ("Opening…", the camera's JPEG, again). The mechanism, read in the code: a lost GPU device made the
  session open the photo again, with no limit, into the same loss (and Chrome refuses a page the GPU after two of its
  crashes in two minutes). The likely loss: GPU memory and work at once in the first seconds after opening. Measured on the
  owner's 40 MP RAF (software GPU, every buffer counted): the photo itself about 190 MB (sensor 76, copy 34, its laid-out
  form 34, the lens's 17, the frame 17, masks and the colour table about 10); the copy made again 125 MB more at first (58
  now); the zoomed-out view's full-size passes 130 more, both running at once at the open: 523 MB, where the afternoon's
  version held about 270 there. The design agreed with the owner, built in one pull request:

| Part | What | Proved here |
|---|---|---|
| No loop | `session.js` `th-gpu-lost`: a reset opens the photo once more, light (no copy made again, no Starfish), and says so; a second is only said. Both in the timings (`lost`) | `tests/lab-editor-guard-browser.test.mjs` |
| Memory | `engine/gpu-memory.js`: every buffer and texture counted; the budget by the phone's memory (720 MB at 8 GB, 480 at 4–6 GB, 240 below; `?budget=` for checks), lowered for good when the GPU says it ran out. The copy made again asks `room` and is left where it would not fit; Starfish's view and the full-size view are never held together where both would not fit | the same file: a 20 MB budget leaves the copy and the editor stays under it; an out-of-memory error lowers the budget and it is kept |
| Queue | `engine/work.js`: frames, the zoom's views and a finger on the photo hold the GPU; the copy made again and Starfish's compiling wait their turn between slices. What is made is named: under the zoom badge's beating dot, small (`zoom-note.js`) | the same file; `lab-editor-zoomed-browser.test.mjs` sees "Loading full detail" under a beating dot |
| Zoom | `zoom.js`: to a third of the sensor's size the copy, sharpened as an export is (`engine/fit-sharp.js`, 0.24 at Sharpening 40: fine detail 7.42 → 8.44, the export's 8.44); a third to 100 % tiles at rest (`zoom-tiles.js`, kept for a pan back); from 100 % an edit shows the copy at once and the full-size view comes back once it rests, then Starfish's with no cap. The zoomed-out full-size layer of the third round is gone | `lab-editor-hq-browser.test.mjs`, `lab-editor-zoomed-browser.test.mjs`, the guard file's tiles |
| Copy | `proxy-hq.js` in 228-pixel tiles (half the memory), read back 4 MB at a time, after the photo's frames; kept on the phone for the last six photos (`copy-kept.js`) and taken on the next open | the guard file: opened again, nothing made again |

  Not done, and why: the zoomed-out photo is still processed at the copy's size, not the screen's (that would rework
  every tool's sizing: masks, crop, heal, brushes); the turn logs from the A15 will say whether the dial needs it. Only
  the phone can say how much memory a Mali GPU gives Chrome: the timings now carry `mb`, `peakMb` and `budgetMb` on `full`.

- Still open: P.2 (zoom stalls: read the phone's `move` logs, now with `ran`), 1.5 (the dial's
  picture), 7.1 (Drive: parked, ask first), every C note. 4.1 and 8.4 are proved by the audit's scripts, not by a
  committed test.
- **Colour.** Adobe's installers (DNG Converter 18.6, Camera Raw 18.6 for Windows) carry Adobe Standard for the X-E5
  and X-T5 and the Adobe Color/Neutral/Portrait/Vivid looks (the editor reads them all), and the four newest film
  simulation looks, but **not** the "Camera PROVIA/Standard" base and the other film simulations: only their names
  are in the program. Nothing of Adobe's goes into this repository. The true colour check needs one RAF exported by
  Lightroom Mobile in Adobe Color, all else zero, 16-bit TIFF: asked of the owner.
- **Other networks: a shoot-out (2026-11-16).** On the known picture (720 px; clean, ISO 3200, fringed), each fed as
  its own code feeds it (vkdt's `input.comp`/`pu.glsl`; X-veon's `web/src/pipeline`), all scored alike (dB, overall /
  colour / the roadmap's fair measure of detail):

  | | clean | ISO 3200 |
  |---|---|---|
  | Starfish (ours, with 3.1) | **38.1** / **35.5** / 40.4 | **37.1** / **35.4** / 39.7 |
  | X-veon (7.8 M weights, demosaic only, no licence) | 36.1 / 33.9 / **40.8** | 34.6 / 33.4 / **40.1** |
  | vkdt `jddcnn` xtrc (white-balanced in; xtrn worse) | 37.4 / 34.4 / 39.3 | 35.9 / 34.1 / 38.2 |
  | the usual demosaic (+ its NR at ISO 3200) | 36.9 / 34.8 / 38.1 | 35.7 / 34.5 / 38.0 |

  X-veon's lead on the fair measure does not survive a look by quarter: on thin dark lines over texture it is 4 dB
  under Starfish (33.1 against 37.3), it leaves the noise in a smooth sky at ISO 3200 (40.1 against 47.6), and its
  colour shortfall is false colour, not a cast (its best overall gains are 1.00). Starfish stays. Two things it
  showed: **on thin lines over texture the usual demosaic beats Starfish by 2.2 dB** (39.5 against 37.3: Starfish's
  own notes say it can zipper on sharp edges), and fringing is the larger loss for every network that does not lay
  colours right first (3.1). The way past the ceiling is to retrain Starfish (its training code is in its repository,
  `training/xtrans_wgpu/`, MIT or Apache) with lens fringing and thin lines in its training data, as DxO's newest
  network does: a GPU machine's work for hours, not this container's. DxO's own model cannot be used (closed);
  its PureRAW trial can serve as a yardstick if the owner sends its DNGs of a few RAFs. No author was contacted.

## How this owner works (learnt the hard way in this session)

- **Merging is pre-approved** (the owner, 2026-11-16: "You always have my approval to merge and go live"): once
  CI is green, merge and confirm the live `release.json`, without asking again.
- **Audit before change.** "It's your repo" did not mean "mend as you go": a fix made during the review was
  unwelcome. Say what you will change and wait for the word. Once the word is given: build it all and ship it in
  one pull request, and run only the tests that touch it, not the whole suite (2026-11-16).
- **Do the review yourself.** Sub-agents were refused for it twice ("you yourself do it. Deep audit part by
  part. So nothing is missed. No sub agents").
- Say a few words often while working; long silences worry them. Plain words, no jargon, "you".
- A finding counts when it is measured. Say plainly what was proven, what was only read, and what was not
  checked. Their standing worry: "whether every stage is truly of high quality or only looks it".
- Their photos are private. Their RAFs may be fetched (below) but never go into the repository, a commit
  message, a test fixture or a screenshot that is committed. This repository is public.

## How to see the editor work here

Nothing can be run on the phone from a session: a headless Chromium with a software GPU stands in. It is slow
and it is not the phone, so every timing here is relative, never the phone's.

```bash
npm ci
CHROMIUM_PATH=/opt/pw-browsers/chromium node --test --test-concurrency=2 tests/lab-*.test.mjs   # 112 tests, about 17 minutes; 109 pass, 3 skipped
```

Real RAFs (the repository holds none):

```bash
mkdir -p /tmp/audit/raf && curl -sSL -o /tmp/audit/raf/DSCF0021.RAF https://raw.pixls.us/data/Fujifilm/X-T5/DSCF0021.RAF   # public domain, the X-E5's sensor, an 18 mm f/2 with strong fringing
node scripts/workshop.mjs list                    # the owner's own X-E5 RAFs and the phones' editor-timings.json (the owner allowed this on 2026-11-15)
node scripts/workshop.mjs get <id> /tmp/audit/own # keep them outside the repository
```

The scripts in [checks/audit/](checks/audit/) (its README says what each proves) open a RAF through the Library's
own Import sheet and give any rectangle at full size by the usual demosaic or the network. On the software GPU a
RAF opens in about 35 s, a 448 × 448 crop takes 5 s the usual way and 17 s by the network, and a whole 40 MP
export is not practical: export a crop (set a crop rectangle first, as `raf7` did; see AUDIT.md Part 5).

No Adobe camera profile is in the repository (the owner's are private, in the phone's IndexedDB), so here a RAF
is developed by the camera's matrix and a plain curve. Detail, noise, geometry and files can be judged; **colour
as the owner sees it cannot**.

Rules of the house that bite (AGENTS.md has all of them): every source file under 300 lines (`wc -l` 299);
`npm run preflight` before a push; work lands as pull requests the owner merges; a change the owner will notice
gets a line in `frontend/whats-new.json`; a change that moves a picture fails
`tests/lab-engine-pictures-browser.test.mjs` until the reference is made again on purpose
(`engine/raw/checks/ref.cjs`), so say in the pull request why the picture moved and by how much.

## The findings, each with its cause, the ceiling, and how to prove a fix

One pull request each, in this order unless the owner says otherwise. "Done when" is the measurement to show.

### 3.1 The network leaves colour fringes towards the edges (A, the heaviest)

- **Cause.** `full.js` gives the network the sensor data with the lens's colour spread still in it and undoes it
  afterwards in the lens pass (`bend.run(..., !!info.fringe && !net)`). The usual demosaic stopped doing exactly
  that on 2026-11-11 (`demosaic.js` `lead`, `trust`) because it cost 3 to 7 dB.
- **Ceiling.** Fringing is undone before or inside the demosaic (RawTherapee's raw CA correction; DxO's newest
  X-Trans network does it inside). The network should never see misaligned colours.
- **Options, to be measured, not guessed.** (a) Lay red and blue sites on green's places before the network: each
  red or blue site's value read at where the lens drew it, between the nearest sites of its own colour (sparse on
  X-Trans: expect some loss; measure it). (b) Give the network a mosaic whose red and blue sites come from the
  usual demosaic's already-aligned picture, green sites as recorded. (c) Keep the network's green and brightness
  and take colour differences from the usual, aligned demosaic where the spread is over a fraction of a pixel.
  (d) A stopgap only: the usual demosaic for pieces where the lens table says the spread is large (risk: a seam
  where the two meet; AUDIT 3.2 shows how to test for one).
- **Prove it.** `known(n, iso, true)` in `engine/known.js` makes a scene with known fringing and its truth;
  `score()` gives dB overall and for colour. Score usual, network as now, and each option, clean and at ISO 3200.
  Then `checks/audit/raf3.mjs` + `speckle.py` on the public RAF and the owner's: colour speckle at the edges must
  come down to the usual demosaic's or under (today: right edge 6.1 against 1.6; on solar panels 10.8 against
  1.4) **without** losing the network's lead at the centre (today 1.9 against 2.3). Look at the crops at 4 × too.
- **Done when** the network is no worse than the usual demosaic at the edges and still better at the centre, on
  the known scene and on real files. Tell the owner their earlier exports carry the fault.

### P.1 The dial stutters when zoomed in (A)

- **Cause.** Every turn draws the fitted photo and the full-size view (`session.js` `draw()` → `gpu.js` render:
  the `fit` pass, then each view). From 100 % the view covers the fitted photo. Measured: both 6483 ms, view
  alone 2533, fitted alone 4065 (software GPU, a phone's screenful).
- **Ceiling.** A turn costs only what is on screen; frames stay under 16 ms on the phone.
- **Fix to weigh.** While the live view covers the window (`zoom.js`: `z / full() >= 0.999` and the view placed),
  turns call `draw(false)`; the fitted photo is drawn once when the control rests, the zoom drops under 100 %, or
  a board asks for the fitted pixels (`pixels()`, tiles, the histogram, the kept tile: all read the fitted frame,
  and `stamp()` must still move so they know it changed). Mind `again`/`alone` in `session.js`.
- **Prove it.** `checks/audit/raf4.mjs` times the passes; a test that a turn at 100 % makes no fitted pass and
  that the fitted photo is right after the control rests and after zooming out. The real proof is the phone's
  own log (`th.editor.timings`, kind `turn`, `pct: 300`): today 11 % and 25 % of frames late. Also fix AUDIT P.4
  here: `DialPlate.js` passes `false` for `busy`, so the log cannot say a turn waited on the network.

### 1.1, 1.2 The dial moves after the finger lifts; the arrow keys cannot move Radius (A, B)

Done 2026-11-16: `DialPlate.js` and a test in `tests/lab-editor-faults-browser.test.mjs` (297 lines: the cap is 299). The wheel follows only a change made elsewhere; a coarse step clicks
in as the finger lifts (over 2° off). Check the Export board's dial too (AUDIT 8.9) and the slim window.

### 1.4 A reduced export is softer and has more moiré (A)

- **Cause.** `reduce.js` `reducer` is an area average. Zone plate, 7728 → 2048: moiré 13.6 of 255, contrast at 0.8
  of the limit 78 % (`checks/audit/resize.mjs`; Lanczos-3: 6.1 and 100 %).
- **Ceiling.** A windowed-sinc reduction in linear light (Lanczos-3, as darktable and RawTherapee export). Known
  cost: in linear light it can ring darkly beside a very bright edge; hold each result between the least and most
  of the pixels it draws on, or use Lanczos-2 or Mitchell if the ringing shows. Measure, then choose.
- **Mind.** It runs a band at a time on the export's thread: rows must carry over between bands (as `crisp`
  does), the page and the thread must give the same bytes (`tests/` has that test), a same-size export must stay
  untouched, and output sharpening's strengths (`OUTPUT`) were tuned to the soft result: lower them or the Small
  preset will oversharpen. REVIEW.md row 23 calls the area average "the same" as the best: correct that line.
- **Done when** the zone plate numbers match the filter chosen, a real crop shows no halo at 4 ×, and the files
  still pass Part 5's checks.

### 8.1 Every Library tile is the camera's 13 MP preview (A)

- **Cause.** `store.js` keeps the RAF's embedded 4416 × 2944 JPEG and the grid's `<img>` shows it at 137 pixels
  (`index.html` LibraryPlate); `init()` looks up every photo's file before the Library shows.
- **Ceiling.** A tile is a small picture made once (about 480 pixels: `saveTile` already makes one for an edited
  photo), tiles off screen cost nothing, and start-up does not grow with the roll.
- **Fix to weigh.** Make the small tile at import (`copyIn`, `adopt`) and for photos already there in the
  background a few at a time; the grid uses it; keep the camera JPEG for the cull view and for opening; give the
  grid's images `loading="lazy" decoding="async"`; do not await every `jpegUrl` in `init`.
- **Prove it.** `checks/audit/lib.mjs` with twelve copies of a RAF: today 92 decodes and 7.4 s of decoding.

### The B findings, briefly (AUDIT.md has each in full)

| # | Fix to weigh | Proof |
|---|---|---|
| 4.1 Auto level undoes itself | `CropPlate.js` `auto`: take the measured lean off the angle already set (mind the sign under flips) | `checks/audit/raf6.mjs`: a second and third press change nothing |
| 8.4 Before/after on a crop | the "before" is the first step's edit **with the photo's present crop** (`ViewTools.js` `tile('before:' …)`, and the hold) | `checks/audit/raf8.mjs`: both halves show the same scene |
| 8.5 False colour in the fitted photo | decide the switch to sensor pixels by editing-copy pixels a screen pixel, not by 40 % of the sensor; or make the editing copy from a quick demosaic. Measure both | speckle of a fitted crop against the sensor's own reduced (today 6.7 / 9.1 against 1.9 / 3.8) |
| 1.3 Black never black | `wgsl.js` `moved()`: below 2⁻¹² treat the table's move as a plain offset so nothing moved gives the value back (AUDIT 1.3 weighs the choices) | `checks/audit/exact.mjs`: level 0 → 0; the pictures test's reference made again on purpose |
| 8.10 The browser's prompt | a glass sheet of the editor's own for a look's name | no `prompt(` in `frontend/lab/editor` |
| 8.11 Less motion | `@media (prefers-reduced-motion: reduce)` in `editor.css` as EDITOR.md says: rows and tiles in place, the plate fades | a test with the media emulated |
| 2.1 A decoder that failed | `decoder.js`: start a new thread after an error answer from a decode | a test that a bad file is followed by a good one opening |
| 7.1 Backed-up mark | set `source` when the upload is done, not when it is handed over (Drive is parked: ask first) | by reading with Photos' import |
| P.2 Zoom stalls | not found: first make the `move` log say what ran in the worst gap (a full-size part, a tile, a map, a board redraw) | the phone's next log |
| P.3 Two-minute export | the network's time on the GPU; ROADMAP's CPU-beside-GPU and tuning notes are the leads | the phone's `save` log |
| 1.5 The wheel's 47 MB picture | suspect only: log the strip's decode on the phone before changing anything | the phone |

The C notes need no order; take them with whatever touches the same file.

## What the audit could not reach (do not assume these are fine)

The phone itself; colour through the owner's Adobe profiles; a whole 40 MP export by the network; ISO above
800; the Drive backup end to end; two tabs at once; a phone short of space. The network's tuning files
(`net-auto`, `net-tune`, `net-ways`, `net-both`, `net-pace` past its head) were skimmed, not read line by line,
and the engine test page, the compare page and `HealPlate.js` past its dial were not read. AUDIT.md lists them.
