# Photos: the road map to the end game (proposed 2026-11-11)

Proposed to the owner, who asked to see the whole road with no stops and with new features added. **Nothing
here starts before the owner says go.** [REVIEW.md](REVIEW.md) holds the reasoning (every step of the pipeline,
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

## So that nothing stops: the owner's answers wanted once, up front

1. Backups go to the owner's Google Drive: yes or no.
2. Models may be downloaded to the phone once (10 to 60 MB each): yes or no.
3. Training a network may use a rented GPU (money) or only this session's CPU (free, smaller networks).
4. The Thunderhead may look at photos (they would leave the phone to reach it), or only at their facts
   (date, camera, lens, rating), or neither.
5. The old editor may be retired when stage 5 is done.
6. Lightroom or Capture One exports and a high-ISO RAF, whenever they come: nothing waits on them but stage 4.

## Stage 0: agreed already

- Merge the hot-pixel pull request.
- A reminder or a rule goes through after a web read when its words are the owner's own.

## Stage 1: protect and prove

- **The testing page** on the phone (28, M): timings of each stage, peak memory, the known scenes on the phone's
  own GPU against reference numbers. Results kept on the Worker so runs can be compared.
- **Pictures checked in CI** (28, M): made-up mosaics rendered and compared on every change.
- **Backup** (29, M): edits and originals to Drive, and back again on a new phone.
- **Storage that stays** (new, S): ask the browser to keep the editor's storage for good, and show what it said.
- **Nothing lost on a crash** (new, S): an export or an import that was cut off picks up where it stopped.

## Stage 2: the editor's own settings (M)

It reads none today. Speed against quality (demosaic Best or Faster; noise reduction and sharpening shown from
50 %). What a new photo starts with (profile, Noise by ISO, Sharpening, lens corrections, hot pixels, Auto tone).
Export defaults (format, quality, size, output sharpening, metadata, file name). The view (clipping levels,
double-tap zoom, the histogram). Storage (how much to keep; whether an original leaves the phone once backed up).
New: **a starting point for each camera and lens**, so a new body or lens gets its own defaults.

## Stage 3: quality that costs little

- Flat areas (7, S). Strong colours brought into range (22, S). The worm check on foliage (S).
- Fringing before the demosaic (5, M) if the measurement earns it. Dead pixels and a black level for each colour (S).
- A second, coarser scale for colour noise (M). The fitted view shows noise reduction and sharpening (27, M).
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

## Stage 10: the Thunderhead in Photos (only as far as answer 4 allows)

- With facts only: "the photos from Saturday on the 35 mm", a week's keepers as a briefing tile, reminders to
  back up or clear the card.
- With pictures: an edit proposed in words and applied as an ordinary, undoable edit; the best of a burst
  picked; captions and keywords written.

## Running through every stage

- Each change is measured, on the harness and then on the phone.
- STATUS.md, REVIEW.md and this file are kept true, so a later session can carry on from them.
- The owner is asked only for money, deleting data, access, and anything that reaches other people.
