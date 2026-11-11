# Photos: the road map to the end game (agreed 2026-11-11)

Proposed to the owner, who asked to see the whole road with no stops and with new features added, and then
said go (answers below). Work through it in order. [REVIEW.md](REVIEW.md) holds the reasoning (every step of the pipeline,
ours against the best known); [STATUS.md](STATUS.md) says what is built. Step numbers in brackets are REVIEW.md's.

Sizes: **S** one pull request, **M** several, **L** a project of its own. "New" marks a feature not asked for
before. Every quality item is measured before and after, and anything that does not earn its place is dropped
and written down.

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
holds none, so only Faster's picture is held by CI. Left of the list below: the starting Sharpening and Color
noise, export defaults (the Export board already remembers its presets), the view's clipping levels, storage,
and a starting point for each camera and lens.

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
- A second, coarser scale for colour noise (M).
- **The fitted view (27): mostly so already.** The sensor's own pixels, with noise reduction and sharpening, are
  drawn from 40 % zoom up (`zoom.js`), not only at 100 % as REVIEW.md said; below that a 40 MP photo is shown
  at under a sixth of its size and neither would be seen.
- Speed, once the testing page gives real numbers (M): shaders kept compiled between visits, the first picture
  sooner, exports faster. Targets to be set from the phone's first run, not guessed here.

## Stage 4: answering like Lightroom

- Slider strengths fitted to the owner's exports (15 to 17, S once they exist).
- `.xmp` presets brought in (19, M).
- **Copy an edit and paste it on many** (new, S). **Match a series** (new, M): even out exposure and white
  balance across photos of one scene.
- **Edit by reference** (new, M): bring any picture's look (its tones and colours) onto a photo as a starting point.
- Optional, last: film simulations fitted to the camera's own JPEGs (13, M). The owner uses Adobe Color, so this
  only matters if the camera's looks are wanted exactly.

## Stage 5: one Photos app

- JPEG and HEIC open in the new editor (M). The Drive library moves over (M). It works with no signal (M).
  The old editor is retired.
- **Culling** (new, M): swipe through a shoot at full speed on the camera's own JPEGs (no decoding), keep or
  reject, then only the keepers are developed.
- **The library grows up** (new, M): ratings, flags, albums, search by date, camera, lens, ISO; bursts and
  brackets shown as one stack; two photos side by side.
- **Bring in from the card or the camera** (new, M): pick a folder on a card reader; over USB if the phone allows.
- **Export many** (new, M): a queue that works through a whole album with the screen off.
- **Share** (new, S): hand a finished file straight to another app.
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

- **HDR merge** (new, L): a bracket of RAFs into one file with the range of all, aligned, ghosts handled.
- **Panorama** (new, L): frames stitched, at a reduced size if 4 GB demands it.
- **Stacking for noise** (new, M): a burst averaged, which buys stops no single-frame denoiser can.

## Stage 9: output and finish

- Display P3 with a profile embedded (25, M). HDR output for phone screens (25, L). A smarter JPEG encoder (26, S).
- **Film grain that behaves like film, halation and bloom** (new, M). **Borders, a watermark, sizes for where a
  photo is going** (new, S to M). **A contact sheet and print layouts** (new, M).
- **An edit saved as a `.cube` table** (new, S), to use the owner's look elsewhere.

## Stage 10: the Thunderhead in Photos

- With facts only: "the photos from Saturday on the 35 mm", a week's keepers as a briefing tile, reminders to
  back up or clear the card.
- With pictures: an edit proposed in words and applied as an ordinary, undoable edit; the best of a burst
  picked; captions and keywords written.

## Running through every stage

- Each change is measured, on the harness and then on the phone.
- STATUS.md, REVIEW.md and this file are kept true, so a later session can carry on from them.
- The owner is asked only for money, deleting data, access, and anything that reaches other people.
