# Photos: the road map to the end game (agreed 2026-11-11)

Proposed to the owner, who asked to see the whole road with no stops and with new features added, and then
said go (answers below). Work through it in order. [REVIEW.md](REVIEW.md) holds the reasoning (every step of the pipeline,
ours against the best known); [STATUS.md](STATUS.md) says what is built. Step numbers in brackets are REVIEW.md's.

Sizes: **S** one pull request, **M** several, **L** a project of its own. "New" marks a feature not asked for
before. Every quality item is measured before and after, and anything that does not earn its place is dropped
and written down.

## The road from 2026-11-12: close the gap with Lightroom

The owner, on 2026-11-12: the goal is a product as good as or better than Lightroom; the work had become
running in circles; they want to manage less. What went wrong, said plainly: the stages below were a list of
features, not a plan to close a measured gap; too many decisions went back to the owner as menus, tests and
file transfers; and "as good as Lightroom" was never written down as something that can be measured. This
section replaces the order of what is left. The stages below stay as the record of what was built and why.

**How the work runs now**

- The agent chooses the order and the method. No option menus. The owner hears one short report a milestone:
  the scoreboard before and after. The owner is asked only for money, deleting data, access, and anything
  that reaches another person.
- The owner is not asked to test. Their one job is the yardstick below, once, and saying what annoys them
  in real use.
- Well-specified pieces go to a cheaper model at medium effort, and the agent reviews what comes back.
- The best existing code is looked for first, under any licence (notices kept, GPL and AGPL sources kept
  available). Outside code is read before it is used.

**The scoreboard against Lightroom Mobile (2026-11-12)**

| | Today | Against Lightroom |
|---|---|---|
| Colour and tone | Adobe's own profiles through the DCP model | should be level; not yet checked on the owner's files |
| Fine detail | level with the best classical demosaics; the network (exports, 200 % in) about 1 dB past them | ahead on the first measure: see below |
| High-ISO noise | classical noise reduction; the network takes it out as it goes | ahead on the first measure, with a caveat: see below |
| Speed on the owner's phone | editable in 8.1 s, 100 % view 1.3 s, a slider frame 17 ms, a full-size JPEG 58 s | the gap felt on every edit |
| Tools | the global tools, healing, looks, stacking | no masks (parked by the owner) |

What the scoreboard rests on. The phone's numbers are the owner's run of the testing page on build 72e3d2a
(all eight pictures the same as the reference; decode 1.4 s on 8 threads; 202 MB of JS heap at most). The
detail and noise rows are a shoot-out on known pictures laid out as X-Trans mosaics and scored against the
truth, in dB (mean over the scenes; higher is better):

| | ours | best classical (darktable, LibRaw) | small neural nets |
|---|---|---|---|
| clean, sharp set | 41.8 | 41.8 | 43.0 to 43.1 |
| clean, second set | 38.5 | 38.1 | 39.7 to 40.9 |
| ISO 3200 | 38.9 to 39.1 with our noise reduction | 37.6 | 40.3 (joint denoise) |
| ISO 12800 | 36.8 with our noise reduction | 34.4 | 38.2 (joint denoise) |

So the demosaic is as good as classical gets, and the way past it is a network that demosaics and denoises
together. The two tried were a 159 k-weight one (CC BY-NC 4.0) and a 1.2 M-weight one (MIT/Apache, trained
on DIV2K); both looked clean on real X-E5 crops. Lightroom itself is not scored yet: that is milestone 1.

**Lightroom Mobile, scored (2026-11-12).** The owner developed the clean and the ISO 3200 test mosaics of set A in
Lightroom Mobile (Android) and sent the 16-bit TIFFs through Files for the workshop. Scored as every other
developer is, Lightroom came 3.8 dB under our demosaic, but a tenth of that picture's error was in smooth areas:
tone and colour its rendering changes that the scorer's greys and matrix do not undo. So the fair measure takes
tone and colour out square by square (each colour's best gain and offset in every 16 x 16 pixels) and lays on each
developer's best 9 x 9 filter, which undoes sharpening, blur and a part-pixel shift, for every developer alike.
What is left is how truly each drew the detail, in dB:

| | ours | the network | darktable Markesteijn 3 | LibRaw 3-pass | Lightroom Mobile |
|---|---|---|---|---|---|
| clean | 42.2 | 43.2 | 41.8 | 41.8 | 39.9 |
| ISO 3200 | 40.1 (with our noise reduction) | 40.7 | 38.4 (none) | 38.4 (none) | 37.9 |

So on these pictures Lightroom Mobile is about 2.4 dB behind our demosaic and 3.4 behind the network on a clean
picture. What this does not settle: the mosaics are made from photographs, not shot through the X-E5's lens and
sensor, and Lightroom met them as a camera it has no profile for; at ISO 3200 it is not known how much noise
reduction Lightroom applied (the file asked for none). The owner's own RAFs with Lightroom's exports are the
check that counts, and they have no truth to score against, so that one is by eye, side by side.

**The standard benchmarks (2026-11-12).** So that nothing rests on our own test pictures alone, the same
contenders were scored on the two sets demosaicing papers use, Kodak (24 pictures) and McMaster (18), laid out
as X-Trans mosaics the same way (mean over the pictures, dB; the plain score):

| | ours | best of darktable and LibRaw | the network |
|---|---|---|---|
| Kodak, clean | 36.2 | 35.8 | 41.2 |
| Kodak, ISO 3200 | 34.8 (with our noise reduction) | 33.6 (none) | 37.8 |
| McMaster, clean | 35.8 | 35.8 | 38.4 |
| McMaster, ISO 3200 | 34.0 (with our noise reduction) | 33.0 (none) | 36.4 |

These pictures are small and 8-bit, and their truth is not free of aliasing, so they are easier on a network
trained on pictures like them than 40 megapixels from a sensor will be; the lead on the owner's files is
likely smaller. The order is the same on every set measured. In the editor the network scores as it does
in PyTorch over a whole set (39.97 against 39.96 dB at ISO 3200; 42.64 against 42.71 clean, where the editor
tells it of ISO 100's noise and the PyTorch run told it of none).

**A larger network: not now (the owner asked, 2026-11-12).** The step already taken is the large one. In the
2025 contest for this very task, networks of under a million weights scored close to ones fifty times the
size; the estimate for a larger one trained for the X-E5 is 0.3 to 0.8 dB more, hard to see at 100 %, for
one to three weeks of a free GPU. What may be worth training is a short fine-tune against a fault seen in a
real photo: zippering along sharp edges, fine repeating lines, clipped strong colours. First the owner's
RAFs beside Lightroom's exports, on the compare page (`/lab/editor/compare/`).

**Milestones, in order**

1. **A fixed yardstick.** About ten of the owner's real RAFs with Lightroom's export of each, sent once from
   Settings › Files for the workshop (`scripts/workshop.mjs` reads them). From then on "as good as
   Lightroom" is measured here, on the owner's own photos, without asking them again.
2. **Speed.** A photo editable in about 2 s and a full-size export in about 10 s on the owner's phone.
   First, numbers from real use with no work for the owner (built): the editor keeps how long each open, the
   full-size pixels, the first full-size view and each export took, with the decoder's start-up split into its
   code, its WebAssembly and its threads (`lab/editor/app/timings.js`), and home passes them on to the
   workshop's folder (`th/workshop/timings.js`; Settings › Privacy and data › Editor timings turns it off).
   What is known so far: on the phone the decode is 1.4 s of an 8.1 s open, and here the decoder's start-up
   is 0.15 s, so the other 6.7 s is the phone's start-up or a download; the decoder is now started while the
   Library is on screen. The full-size pipeline does about 1.2 megapixels a second on the phone, which is
   what makes a 40-megapixel export take 58 s.
3. **Picture.** The owner, 2026-11-12: the absolute highest quality, not a fast model; an export on the best
   model, the editing screen on a fast one at 100 % and the best one closer in; all of it smooth. So the
   model is chosen on measured quality alone and made fast afterwards.
   - Built: Starfish's X-Trans network (joint demosaic and noise reduction, 1.2 M weights, MIT or Apache;
     `frontend/lab/engine/nets/starfish-xtrans/`) runs in the editor as a demosaic stage
     (`frontend/lab/engine/neural.js`), from its authors' own WebGPU export. It agrees with the PyTorch
     model to 93 dB. Exports use it, and so does what shows from 200 % in, once the photo rests; the dial
     never waits on it. Settings › Photos › Neural detail turns it off, and a phone whose GPU will not have
     it falls back by itself.
   - The owner compared them on the compare page on 2026-11-12: "The network is best." So it also makes
     what shows at 100 %, once the photo rests. On the owner's phone it passed its proof and took 0.8 s for
     a screenful at 200 % (about 0.16 megapixels); a photo opened in 2.3 s with the decoder started early
     (its start-up is 4.6 s, 3.7 of them its eight threads), and the usual 100 % view took 1.2 s.
   - Looked at and not taken: vkdt's jddcnn (2.2 M weights, X-Trans weights for clean and noisy pictures)
     scored about 40 dB on the clean small set and 36 to 37 at ISO 3200, under both Starfish (42.7, 40.0) and
     our own demosaic. Our green with the network's colour, and the mean of the two, were no better than the
     network alone on photographs. On the engine's own chart (bench-ref.json) the network is 1.9 dB truer
     overall and 1.5 in colour but 3.4 dB behind in green: it was trained on photographs, and a chart of
     fine lines is hard on it.
   - A little more from the same network: developing the picture turned and flipped all eight ways and
     averaging gains 0.25 dB (0.34 in green) on the clean small set, at eight times the work. Kept in mind
     for an export once its time on the phone is known.
   - Next: a larger network of the same kind trained for the X-E5's own noise (NAFNet-class; the survey of
     2026-11-12 found no open X-Trans model stronger than Starfish, and that the strongest general ones need
     retraining for the 6 × 6 pattern). That needs a GPU: Kaggle's free tier is enough, in the owner's name.
   - Lightroom on Android has no AI Denoise or Enhance (forum evidence, September 2026), so on the owner's
     phone the bar is Lightroom's standard development.
4. **Finish.** What the owner picked on 2026-11-12: Display P3 with a profile and a better JPEG encoder;
   borders, a watermark and sizes for where a photo is going; grain, halation and bloom; HDR output and
   print layouts; the small sensor fixes and the high-ISO extras not already covered by milestone 3; the
   Library's actions menu.

Parked by the owner on 2026-11-12 until they ask: masks, panoramas and other multi-frame work, the
Thunderhead in Photos, and the classic Photos app's Drive work ("drive is just not worth it for now").

## The end game

Photos on the phone is the whole of the owner's photography, from the card to the finished file:

- Pictures as good as desktop Lightroom at low ISO (detail is there already), and within reach of the neural
  denoisers at high ISO.
- A full workflow: bring in, cull, edit one or many, merge brackets and panoramas, export, share.
- Every photo and edit backed up, usable with no signal, on any screen that runs Chrome.
- Proven on the real phone on every change, not on a server's software GPU.
- The Thunderhead knows the library: it can find, sort and suggest, when the owner allows it.

What it will not be, said plainly: DxO's or Adobe's denoise (years of training on hardware we do not have),
generative fill of Adobe's quality, or anything that needs more than the phone's 4 GB.

## The owner's answers (2026-11-11): go, with no stops

1. Backups go to the owner's Google Drive, **but nothing may depend on it**: the editor works whole without Drive.
2. Models may be downloaded to the phone once.
3. Training uses only free computing (this session's CPU), and only if the result can actually be good: if it
   cannot, say so and do not sink time into it.
4. The Thunderhead may look at the photos.
5. The old editor may be retired when stage 5 is done.
6. Lightroom or Capture One exports and a high-ISO RAF come when they come: nothing waits on them but stage 4.

## Stage 0: agreed already

- Merge the hot-pixel pull request.
- A reminder or a rule goes through after a web read when its words are the owner's own.

## Stage 1: protect and prove

- **The testing page** on the phone (28, M): **built 2026-11-11** (`/lab/engine/`, "Test this phone"; STATUS.md).
  Results are text to copy and the last runs are kept in the browser, not on the Worker: a coding session cannot
  read the Worker's private data, and the page's network policy stays closed this way. Waiting on the owner's
  first run for real numbers.
- **Pictures checked in CI** (28, M): **built 2026-11-11** with it (`tests/lab-engine-pictures-browser.test.mjs`):
  a change that moves a picture by more than a rounding step fails until the reference is made again on purpose.
- **Backup** (29, M): **built 2026-11-11.** The Library's Import sheet has "Back up to Drive": originals not yet
  there go through Photos' own import, each edit (with rating and flag) as one small file, and Photos' Edit
  brings both back on a phone that has nothing kept. It runs on Photos' page, the one page allowed to reach
  Drive; the editor's page still reaches nothing outside the site. Nothing depends on it: signed out, the row
  only says so. It is a tap, not automatic: the editor cannot reach the network to do it by itself.
- **Storage that stays** (new, S): **built 2026-11-11.** The browser is asked at start to keep the photos for good;
  when it will not promise, the Library says so beside the space used.
- **Nothing lost on a crash** (new, S): **built 2026-11-11.** A set picked again after an import was cut off copies
  only what is missing; a file left with no record is cleared after an hour; an export the page did not live to
  finish is offered again in the Library, once (`tests/lab-editor-keep-browser.test.mjs`).

## Stage 2: the editor's own settings (M)

**Begun 2026-11-11** (Settings › Photos › Editor, all kept on the phone and read when used): New photos open in
(the camera's film simulation, or Adobe Color), Noise reduction by ISO, Auto tone on new photos, Double-tap zooms to
(100 or 200 %), Full-size detail (Best, or Faster: the first look alone). Checked on a real RAF by hand: the repo
holds none, so only Faster's picture is held by CI. Left of the list below: the view's clipping levels and storage.
(Export defaults: the Export board's two files are kept on the phone since the export of many, stage 5.)

**A start for each camera and lens: built 2026-11-11** (`app/starts.js`; Looks › Mine › AS START). The open photo's
look is kept as where every photo from its camera with its lens begins: its sharpening and colour noise (so the
two settings the list had for those are not needed), lens corrections by hand, profile, curve, a look, everything
but what is each photo's own (Exposure, white balance, and Noise, which goes by ISO). A photo opened for the
first time begins there; it is where the photo starts and not an edit, so its history begins with it and Reset
goes back to it. A tap on START ✓ clears it. The camera and lens come from the photo's Exif (stage 5).

It reads none today. Speed against quality (demosaic Best or Faster; noise reduction and sharpening shown from
50 %). What a new photo starts with (profile, Noise by ISO, Sharpening, lens corrections, hot pixels, Auto tone).
Export defaults (format, quality, size, output sharpening, metadata, file name). The view (clipping levels,
double-tap zoom, the histogram). Storage (how much to keep; whether an original leaves the phone once backed up).
New: **a starting point for each camera and lens**, so a new body or lens gets its own defaults.

## Stage 3: quality that costs little

- **The worm check: done 2026-11-11, clean.** Leaves and stems in focus, distant bare trees and smooth
  out-of-focus greens, on real 40 MP files in the real editor at Sharpening 40 and 100: no worm or maze patterns,
  no halos. At 100 a flat sky shows more grain, as it should. (A purple strap and purplish shadowed steel looked
  like false colour and were checked against the camera's own JPEG: they are that colour.)
- **Flat areas (7): nothing to do.** Where every way is as level as the best, the demosaic already takes the mean of
  all four greens (`pick`), which is what a "dual demosaic" blends in.
- **Strong colours (22): done 2026-11-11.** A colour the screen cannot show is no longer cut off at its edge: its
  strength is taken down in Oklab with lightness and hue held, and a colour within a tenth of the edge eases in
  (`wgsl.js` `fit`, baked into the colour table: no cost per pixel). Over a wheel of strong colours the hue error
  falls from 5.3° (23° at worst) to 0.1°; colours inside the range do not move. On real photos it touches
  0.01 to 0.06 % of pixels, 2.8 % with Saturation at +50. Tried first and dropped: easing each channel in towards
  the brightest (the film industry's gamut compression): hue no better than cutting off (5.8° to 7.2°), and
  colours that were fine moved.
- **Fringing (5): done 2026-11-11, and the largest gain of the stage.** Measured first, as planned: undone after
  the demosaic it cost 3 dB at half a pixel and nearly 7 at one, and the sample lenses have 0.6 to 4 pixels of it
  over most of the frame. The demosaic now reads red and blue from where the lens drew them
  (`quality/README.md`, "Colour fringing"): 2 to 5.5 dB back, false colour whole. Left: a second round of the
  colour pass, which may win back part of the green.
- Dead pixels and a black level for each colour (S).
- **The colour table at the edge of the screen's range: done 2026-11-11** (new; found on JPEGs, stage 5). The frame
  reads its colours from a table, between its points, and the table held the finished colour: cut off at the
  screen's range and encoded. A table read between points blurs a hard cut. Measured against the engine's exact
  path (every pixel developed itself) on three real RAFs: a stop over, highlights blown to white came out tinted
  (244 of 255 in one colour) on 3 to 4 % of the photo; at Saturation +40, 1.5 to 2 % of pixels were off by more
  than 3 levels, 22 at worst. Now the table holds only how far the colour is moved, in ProPhoto, and each pixel
  does the last steps itself (to the screen's colours, the cut, the encoding, a look's table, the point curve:
  `wgsl.js` `finish`). After: blown highlights are white; off by more than 3 levels at Saturation +40 on 0.004 to
  0.24 % of pixels, as shot on none. The frame takes the same time on the software GPU (3.2 s before and after;
  three copies of the finishing steps in the shader cost 23 % until they were made one). Left in the table, and
  the source of what error remains: the easing of strong colours at the edge (`fit`), a few pixels in ten
  thousand on a real photo. A test now holds the table to the exact path
  (`tests/lab-engine-pictures-browser.test.mjs`).
- A second, coarser scale for colour noise (M).
- **The fitted view (27): mostly so already.** The sensor's own pixels, with noise reduction and sharpening, are
  drawn from 40 % zoom up (`zoom.js`), not only at 100 % as REVIEW.md said; below that a 40 MP photo is shown
  at under a sixth of its size and neither would be seen.
- Speed, once the testing page gives real numbers (M): shaders kept compiled between visits, the first picture
  sooner, exports faster. Targets to be set from the phone's first run, not guessed here.

## Stage 4: answering like Lightroom

- Slider strengths fitted to the owner's exports (15 to 17, S once they exist).
- **`.xmp` presets: built 2026-11-11.** The Looks board's IMPORT reads a Lightroom preset and keeps it in Mine
  (`app/xmp.js`, on the reader the editor before has): the Light and Color sliders, Texture, Clarity, Dehaze, the
  mixer, grading, the point curves, Sharpening, Noise, Vignette and Grain, by name. Exposure, white balance,
  crop and profile stay the photo's own. It says how many settings it had no control for. Until the strengths
  are fitted (above) a preset lands near what it does in Lightroom, not on it. Camera recipes are left.
- **Copy an edit and paste it on many: built 2026-11-11** (`app/clip.js`). Versions has Copy edit and Paste edit;
  the Library's Import sheet pastes the copied edit on every photo it is showing (so: flag the series as picks,
  show Picks, paste), on a second tap. What goes across is the look of the picture (every adjustment, the
  profile, the curve, a look); the crop, the spots and the masks stay each photo's own. Pasting is a step of the
  photo's history, so Undo takes it off. Each photo is opened in turn to take it, so its tile shows the edit: a
  few seconds a photo. Found on the way and mended: opening a photo while a frame of the one before was being
  drawn could leave the editor drawing nothing, and so could a frame that failed.
- **Match a series: built 2026-11-11** (`app/clip.js` `matchOn`). With a photo open, the Library's sheet matches every
  photo it is showing to it: each gets the open photo's white balance, and its Exposure is set by how the two
  were shot (shutter time × ISO ÷ f-number squared, from each photo's Exif), so a scene shot at changing
  settings comes out as bright in every frame. It is the camera's own numbers, not a guess from the pictures,
  so two frames of different things are not pulled together. A photo with no shooting data gets the white
  balance alone; a JPEG beside a RAF is left. For this each photo now keeps what its Exif says of the shot
  (below, stage 5).
- **Edit by reference** (new, M): bring any picture's look (its tones and colours) onto a photo as a starting point.
- Optional, last: film simulations fitted to the camera's own JPEGs (13, M). The owner uses Adobe Color, so this
  only matters if the camera's looks are wanted exactly.

## Stage 5: one Photos app

- **JPEGs open in the new editor: built 2026-11-11.** The Library's picker takes them; a JPEG is kept as it is with
  a small copy for its tile, opened as a picture and not as sensor data (`engine/picture.js`): its editing copy is
  the mean of 3 × 3 of its pixels in linear light, its own pixels stand where the sensor's would for 100 % and
  export, its tone curve is straight, and it starts with no sharpening or noise reduction (the camera did both).
  Every control, the masks, retouching and export then work on it as on a RAF. Held by the first test that takes
  a photo through the whole editor (`tests/lab-editor-jpeg-browser.test.mjs`): with nothing moved, an export is
  the file's own pixels to within one level of 255. Getting there found two faults (below). Longer than a
  texture holds (8190 pixels) it is reduced once. Left: HEIC (Chrome does not decode it), a file in a wider colour
  space than sRGB is brought into sRGB by the browser, and the date it was taken is the file's, not its Exif's.
  - A camera matrix with no profile brought the shot's white to D50 by scaling XYZ, not by Bradford's adaptation
    as the DNG specification has it and as the way back to the screen does: colours were off by up to 45 levels
    (`dcp.js` `adapt`). It touched only photos developed with no profile; the reference pictures were made again.
  - The colour table is read between its points, which blurs the hard edge of what a screen can show: a deep
    blue inside that edge came out 28 levels off. For a picture the table now holds only what the edit adds and
    each pixel works the rest out exactly. Measured for RAFs next and mended for every photo (stage 3).
- The Drive library moves over (M). **Begun 2026-11-11:** Photos' Edit hands a JPEG to the new editor as it does a
  RAF (`apps/photos/to-editor.js`), unless the JPEG already has an edit in the editor before: that one keeps
  its edit there. Left before the old editor can go: the shelf itself (browsing Drive's photos from the new
  Library), an edit made here reaching the Worker's shelf preview, HEIC and DNG, and the old edits brought over.
- **It works with no signal: built 2026-11-11.** Opened once with a signal, the editor, its engine and the decoder
  are kept (13 MB the first time, then only what a release changed) and open with none; an older release's
  editor still opens when a newer one has not been fetched yet (`sw.js` `keepEditor`, `/lab/offline.json`,
  `tests/lab-editor-offline-browser.test.mjs`). The owner's "Keep the editor for offline use" turns it off.
- **Culling: there already** in the Library (CULL: the camera's own JPEGs, stars, pick and reject, rejects deleted
  for good). Left: swiping, and developing only the keepers.
- **The library grows up** (new, M): ratings and flags are there. **Begun 2026-11-11:** each photo keeps what the
  camera wrote of the shot (when by its own clock, the camera, the lens, ISO, shutter, aperture, focal length:
  `engine/exif.js` `shot`), photos brought in before get it once at the next start, the Library is in the order
  the camera's clock gives (a JPEG's was the file's time), and the line under a photo's name says how it was
  shot. **Find: built 2026-11-11.** A field at the top of the Library: every word typed must be in what is kept of
  a photo (its name, RAF or JPEG, the camera, the lens, `iso 3200`, `f/5.6`, `23mm`, `1/250`, `2026-03-14`,
  `march`, pick, reject, edited). What Find shows is what paste, match and export then work on. Left: albums,
  bursts and brackets shown as one stack, two photos side by side.
  - Found on the way and mended: **every export carried a wrong shutter time, aperture and focal length.** A
    fraction in Exif is two numbers of four bytes; the reader took one, so what went into the file was where
    the value had been kept, not the value. Exports made before this have those three wrong (the date, the
    camera, the lens and the ISO were right). `tests/lab-engine-exif.test.mjs` now holds it, in both byte orders.
- **Bring in from the card or the camera** (new, M): pick a folder on a card reader; over USB if the phone allows.
- **Export many: built 2026-11-11** (`app/save.js` `saveMany`). The Library's sheet exports every photo it is showing
  (so: show Picks, export), each as it is edited, with the files the Export board has on; those two files are
  now kept on the phone between visits (the export defaults of stage 2). Each photo is opened, developed from
  its own pixels and saved to Downloads in turn; the screen is kept awake meanwhile, because a web page cannot
  work with the screen off. Left: carrying on after the page is closed part-way, and a zip of the lot.
- **Share: there already.** The Export board hands the files it saved to the phone's share sheet (`ExportPlate.js`).
- A layout for a tablet or a laptop (new, M): the same editor with room to breathe, and keys.

## Stage 6: detail and noise, the large step

- **Neural noise reduction** (8, L): a small network that takes the mosaic and gives the picture, trained on
  public-domain RAFs with our sensor's noise laid on, run in tiles as a one-off action on a photo. A stop or
  more over today's is a fair hope; the testing page says what the phone can carry.
- A neural demosaic for low ISO out of the same work, kept only if it beats today's on our scenes.
- Large blown areas rebuilt by segments (4, M).

## Stage 7: masks and retouching

- Subject, sky, background and people found by a model (20, L), each usable as any mask is.
- Seamless heal (21, M), then a true remove (L). Noise and sharpening for a mask (S).
- **Portrait tools** (new, M, after people masks): skin smoothing that keeps texture, eyes and teeth.
- **Lens blur** (new, L): a depth estimate and a background softened by it. Only if the phone carries it well.
- Upright by itself (11, M).

## Stage 8: more than one frame

- **HDR merge: built 2026-11-12, for a bracket from a tripod** (the same "Stack the photos shown"; `engine/stack.js`
  `summer`). A bracket is the stack's sum with each frame counted by its exposure: a sensel is worth all the
  light it gathered in the frames where it did not clip, over the time they were open. Measured on the made-up
  scene at 1, 4 and 16 times the exposure: deep shadows come out at a twelfth of a frame's noise, highlights are
  the short frame's as it was, and no band between them is brighter or darker than the scene. The result is a
  raw photo at the shortest frame's exposure (nothing more is clipped than was in it), opened as bright as the
  middle frame, with the range there for Highlights and Shadows to use. The frames must share ISO, aperture and
  the camera's DR setting; the shutter time is what differs. Left: things that moved between frames (ghosts)
  are not looked for, frames shot by hand are not laid on each other, and a bracket wider than ±2 stops keeps
  less than all of its longest frame's fineness (16 bits hold four times the camera's scale, not sixteen).
- **Panorama** (new, L): frames stitched, at a reduced size if 4 GB demands it.
- **Stacking for noise: built 2026-11-12, for frames from a tripod** (`engine/stack.js`, `app/stack.js`; the Library's
  sheet, "Stack the photos shown for noise"). The frames are averaged as sensor data, sensel by sensel, before
  any colour is made, so the stack is a raw photo still: it is kept as one (16 bits, at four times the camera's
  scale, so the average holds two more bits than a frame), stands in the Library beside its frames, and opens
  like any RAF, with the camera's profile, the demosaic, the lens corrections and every control. Noise falls with
  the square root of the count (sixteen frames: a quarter, measured), and the engine is told so (its noise model
  and the Noise it starts with go by ISO ÷ frames). A frame shot otherwise than the first (ISO, shutter,
  aperture) is left out, and so is one that has moved by more than half a sensel against it, read from the two
  editing copies (noise does not disturb the reading: 0.02 of a pixel at the worst tried). Up to 64 frames, one
  in memory at a time. Left: frames shot by hand (they must be laid on each other first, which means making their
  colours before averaging), and a stack's own file in the backup (its frames are backed up).

## Stage 9: output and finish

- Display P3 with a profile embedded (25, M). HDR output for phone screens (25, L). A smarter JPEG encoder (26, S).
- **Film grain that behaves like film, halation and bloom** (new, M). **Borders, a watermark, sizes for where a
  photo is going** (new, S to M). **A contact sheet and print layouts** (new, M).
- **An edit saved as a `.cube` table: built 2026-11-11** (`app/cube-out.js`; Looks › Mine › AS .CUBE), to use the
  owner's look elsewhere. A table answers one colour with another, so it carries Contrast, Whites, Blacks,
  Saturation, Vibrance, the mixer, grading, the point curve and a `.cube` look that is on; not what works by
  area or place (Highlights, Shadows, Texture, Clarity, Dehaze, masks), nor what is the photo's own (Exposure,
  white balance, the camera's profile). 33 points a side, made by the engine's own frame with each point
  developed exactly: with nothing moved, every point answers itself. Its answers are in 8 bits.

## Stage 10: the Thunderhead in Photos

- With facts only: "the photos from Saturday on the 35 mm", a week's keepers as a briefing tile, reminders to
  back up or clear the card.
- With pictures: an edit proposed in words and applied as an ordinary, undoable edit; the best of a burst
  picked; captions and keywords written.

## Running through every stage

- Each change is measured, on the harness and then on the phone.
- STATUS.md, REVIEW.md and this file are kept true, so a later session can carry on from them.
- The owner is asked only for money, deleting data, access, and anything that reaches other people.
