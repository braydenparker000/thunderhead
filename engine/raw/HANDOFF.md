# The editor: handoff after the audit (2026-11-16)

For whoever carries on, a person or a model that was not here. Read this, then [AUDIT.md](AUDIT.md) (every
finding, with its measurement), then [../../AGENTS.md](../../AGENTS.md). [STATUS.md](STATUS.md) says what is
built, [ROADMAP.md](ROADMAP.md) what was agreed before the audit.

## Where things stand

- The audit is finished and nothing in the product was changed. The only files added are AUDIT.md, this file and
  the audit's scripts in [checks/audit/](checks/audit/), on the branch
  `claude/thunderhead-photo-editor-review-2ye8x9`. No pull request is open.
- One fix was written and then taken back out at the owner's word: the dial's (finding 1.1 and 1.2). The owner
  said go on 2026-11-16 and it is now applied (`DialPlate.js`, with its test in
  `tests/lab-editor-faults-browser.test.mjs`, which fails without the fix and passes with it).
- **What the owner asked for next, in their words: "Then we'll compare to true ceiling and true best
  behavior."** So the next step is that talk, not code. For each finding below, "the ceiling" is this audit's
  view of the best known behaviour, to start that talk from. Fix nothing until the owner has said which.

## How this owner works (learnt the hard way in this session)

- **Audit before change.** "It's your repo" did not mean "mend as you go": a fix made during the review was
  unwelcome. Say what you will change and wait for the word.
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
