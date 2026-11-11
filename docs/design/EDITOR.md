# The photo editor: design spec

The new Photos editor, designed with the owner on the design canvas (2026-11-08 to 11-09) and approved
screen by screen. It replaces the current editor (`frontend/apps/photos/edit/`) and the LightCraft lab
when the new engine is ready; nothing here reuses the old editor's UI. The boards in
[editor/boards/](editor/boards/) are the exact reference: open one in a browser beside the build at the
same size. Sections marked **[open]** still need the owner's call.

Reference size is 412 × 915 css px (the Galaxy A35 in Chrome). Every layout must also hold at 390 × 844.

## The idea

The bottom of every screen is **the camera's top plate**: matte black, bead-blasted aluminium. A real
knurled **command dial** sits in a slot in it, like the X-E5's. Under the thumb, everything is metal
and engraved. Anything that floats over the photo is **liquid glass**: the tool dock, the curve, the
grading wheels, menus, sheets. Glass over the image, metal under the thumb.

1. **One value at a time, on the dial.** Every one-dimensional setting is turned on the dial. Two-
   dimensional controls (the tone curve, the grading wheels, crop corners, heal sources) are glass
   overlays on the photo, and the dial fine-tunes them.
2. **One accent: Fuji red.** It marks what is active, the value fill and the primary key. Nothing on
   the plate is blue.
3. **Engraved markings, not buttons.** Section names and adjustments are spaced capitals, paint-filled
   when active with a short red bar under them.
4. **The plate never moves the photo around.** Its layout is fixed per screen; only the rows change.

## Tokens

These become `--ed-*` tokens in `frontend/ui/tokens.css` (the feel test bans raw curves and times outside it).

| Token | Value | Use |
|---|---|---|
| plate | `#232525` + `editor/assets/plate.webp` | the deck behind all plate content |
| window | gradient `#050606` → `#0b0c0d`, inset shadow `0 2px 5px #000f`, 1 px light lip below | the value window |
| ink-on | `#f2efe8` | active markings, numbers |
| ink-off | `#9a9ea4` **(boards: `#7d8187`, too low: 3.9:1)** | inactive markings, 5.7:1 on the plate |
| ink-value | `#8a8e93` **(boards: `#6a6e73`)** | values under markings, 4.7:1 |
| red | `#e8202a` | fills, bars, rings, dots, primary key |
| red-text | `#ff5a5f` **(boards use `#e8202a`, 3.4:1)** | red text on the plate, 5.1:1 |
| red-glow | `rgba(232,32,42,0.55)` 8 px | the value fill |
| overlay | `rgba(232,32,42,0.5)` | mask overlays |
| glass | `linear-gradient(180deg, rgba(255,255,255,0.17), rgba(255,255,255,0.06))`, `blur(18px) saturate(1.8)`, 1 px `rgba(255,255,255,0.22)` rim, top highlight | dock, sheets, overlays |
| key | gradient `#2c2e2f` → `#1b1c1d`, top highlight, 1 px `#0b0c0c` ring, radius 12 | machined keys |
| engrave | `text-shadow: 0 -1px 0 #000d, 0 1px 0 #ffffff0f` | every marking |

**Type [open].** The boards use Inter; the system rule is Switzer only (DESIGN-SYSTEM.md, rule 1).
Proposal: build in Switzer. Markings 500 at 10 px with 0.14–0.16 em tracking, values 9 px, the window
number 12 px 600 with tabular figures, glass text 11–15 px. No 700: the boards' few 700s become 600.
The window's 8.5 px labels go to 10 px.

**Motion.** Fly-out: 440 ms `cubic-bezier(0.2, 0.9, 0.25, 1.15)`, 32 ms stagger. Look tiles: 360 ms,
24 ms stagger. Plate slide and dock morph: 480–520 ms `cubic-bezier(0.2, 0.85, 0.2, 1)`. The window's
number follows the value with 90 ms ease-out; nothing else in the window animates. Reduced motion: rows
and tiles appear in place, the plate fades, the dial still turns.

## Screen layout (412 × 915)

| Band | y (css px) | Holds |
|---|---|---|
| Header | 0–52 | back, file name and exposure line, histogram, history, Export (red) |
| Photo | 52–592 | the image, glass overlays |
| Plate | 600–915 | everything below |
| ↳ window | plate + 10, 372 × 44, x 20 | what the dial controls |
| ↳ dial strip | plate + 58, 412 × 150 | the dial in its slot; slot centre at plate + 112 |
| ↳ row | plate + 166, 36 tall | the current section's items, scrolling sideways |
| ↳ sections | plate + 206, 30 tall | the screen's sections, evenly spaced |
| ↳ keys | bottom 22, 40 tall | machined keys left, the glass dock button right (56 × 56) |

Hit areas: markings are drawn 34 px tall but take **44 px** touch targets; the dial takes its full
412 × 108 strip.

## The dial

- **Asset.** `editor/assets/dial-strip.webp`: 12 frames of 412 × 150 css px stacked (1648 × 7200 px,
  4×), dial and plate rendered together so they match `plate.webp` exactly. Regenerate with
  `scripts/editor-dial/render.py` (commands in its header).
- **Geometry.** Radius 240 css px, 72 knurl rows, so one knurl is 5°. The frame shown is
  `floor(frac(-angle / 5) × 12)`: the strip steps every 0.42°.
- **Drag.** Horizontal pointer travel turns the dial by `dx / 240` radians, so the knurl tracks the
  finger exactly. Pointer capture on down; keyboard arrows step the value.
- **Mappings.** Continuous values: full range over 180° (Exposure ±4 EV = 4/180 EV per degree; ±100
  sliders 100/180). Choices and integer recipe settings click every 10° (Highlight and Shadow in halves).
  Library culling: one photo per 9°. Export long edge: 64 px per 3°.
- **The window.** Label left, unit right, a track with a zero mark. ± values fill from the centre and
  0–100 values from the left end. The number sits in a red-ringed box riding the fill's end. It is
  always shown: it never collapses or recentres.
- **Index.** A 6 px red triangle on the plate above the slot's centre.

## Screens

Each board is interactive; what follows is the behaviour to build, and what each needs from the engine.

**Edit** (`EditPlate`, `DialPlate`, `CurveOverlay`, `GradeTrio`). Sections LIGHT · COLOR · EFFECTS ·
DETAIL · OPTICS with edit counts. Tapping one flies its items out of its name into the row (each starts
at the name, scaled 0.35, and springs to place). Entries with an engraved outline open a sub-tool, and
‹ steps back. Curve: glass curve over the photo, monotone cubic, tap the line to add a point, R/G/B
channels; the dial moves the selected point. Mixer: HUE / SAT / LUM and eight colour dots. Grading:
Shadows, Midtones and Highlights wheels plus a smaller Global, all visible in one glass tray; touching a
wheel selects it and the dial sets that zone's luminance. Keys: AUTO and RESET; in Color the eyedropper
and WB with a glass preset menu. Closing slides the plate off and the photo grows. *Engine:* set a value
with a proxy preview inside a frame; a full-res region after idle; histogram; auto settings; WB from a
point.

**Crop** (`CropPlate`). STRAIGHTEN (±45°, 0.25° per dial degree, AUTO level) · ASPECT (Original, Free,
1:1, 4:5, 3:2, 16:9, 65:24, ⇄ swap) · ROTATE (90° each way, flips) · GEOMETRY (Upright, Vertical,
Horizontal, Scale on the dial). The photo turns under a fixed frame and zooms just enough to stay
covered. The thirds grid becomes a fine grid while the dial turns. Corner handles keep the ratio. The
output size shows in RAF pixels and MP. *Engine:* auto level, upright, a transformed proxy.

**Masks** (`MaskPlate`). A glass mask list (shape icon, name, edit count, + Add mask). The add sheet:
DETECT (Subject, Sky, Background, People, Object), DRAW (Brush, Linear, Radial), RANGE (Color,
Luminance). Detection shows a red sweep, then the red overlay. Sections LIGHT · COLOR · EFFECTS · MASK;
values are per mask; MASK holds Amount, Invert, Delete and the brush's Size, Feather, Flow and Erase. Keys:
OVERLAY, RESET MASK. *Engine:* on-device subject and sky segmentation [open: model choice, size,
licence], brush and gradient masks, range masks, mask × adjustment rendering.

**Looks** (`LooksPlate`). FILM SIMS · RECIPES · PRESETS · MINE; the row holds each section's
collections with counts (All, ★, recipes grouped by base simulation, presets by pack). A glass strip of
live thumbnails over the photo. A glass recipe card in Fuji's own terms, where any setting goes to the dial.
The dial sets Amount 0–150 %. Holding the photo shows it without the look. IMPORT takes .xmp, .lrtemplate,
.cube and .zip packs, recipe text, and each RAF's simulation as "As shot", then reports what came in and how
oddities were mapped. *Engine:* our own film simulations, fitted per simulation to this camera's RAF + JPEG
pairs; parsers for each format; a LUT stage; Adobe-profile references mapped to our simulations; looks
applied at an amount above 100 %.

**Library** (`LibraryPlate`). Grid grouped by shoot with sticky headers. Tiles show simulation, stars, ⚑,
an edited dot, and rejects dimmed. A short plate holds the filters ALL · PICKS · RATED · EDITED · REJECTS
with counts, plus CULL, sort and size. Culling: a big photo, a neighbour strip, the dial scrubbing the
roll, and the window marking picks and rejects along the roll; ratings, PICK · UNFLAG · REJECT, SKIP
REJECTS, EDIT ›. Import: choose files, a card or the camera over USB-C (a DCIM folder through the
directory picker), or a watched folder. *Engine:* the embedded RAF preview for instant thumbnails, Exif
and maker notes (film simulation), a library store.

**Export** (`ExportPlate`). Two presets, Full and Small, each a glass card with a switch; both on by
default, saved together. Sections SIZE · FORMAT · OUTPUT · INFO; LOCATION is off by default. One red key:
SAVE BOTH, then counting as it goes. A red line sweeps down the preview band by band, and a glass card
confirms the save to Downloads with Share. *Engine:* banded full-resolution render, JPEG / PNG / 16-bit
TIFF encoders, output sharpening, metadata writer.

**Viewing** (`ViewTools`). Histogram (glass, top right; tap ▲ for clipping shown in red and blue).
Before/after split line; elsewhere, hold the photo for the original. Double-tap or pinch for 100 % (one
RAF pixel per screen pixel, about 7×) with a red-boxed minimap. History (glass list; tapping a step
returns to it, the next edit branches). Versions (edits of one photo, no RAF copies). *Engine:* histogram
and clipping maps, 100 % tiles, an edit history and version store.

**Heal** (`HealPlate`). HEAL · CLONE · REMOVE. Tap a spot; a source is picked nearby and linked by a
dashed line, and you drag it to move. SIZE, FEATHER and OPACITY go on the dial; VISUALIZE shows a
high-contrast view for dust. Keys: UNDO SPOT, CLEAR ALL. *Engine:* heal (blended), clone, and remove
(content-aware fill).

## In the app (2026-11-11)

Since the owner's word later that day the editor **is** Photos: every way into Photos from the app lands in its Library (`landing()` in `th/registry/apps.js`; [PHOTOS.md §4](../product/apps/PHOTOS.md)), and its page is titled Photos. From the shelf before, kept on hand, Photos' Edit still hands a photo over and the editor opens it straight in Edit (`/lab/editor/?open=<id>&from=photos`; [PHOTOS.md §4](../product/apps/PHOTOS.md)). The back arrow in Edit then returns to Photos. Opened on its own (`/lab/editor/`), it starts at its Library as before. It still lives under `/lab/`, so it is not in the offline precache and its page reaches nothing outside this site; moving it to its own address, sending its edits to the Worker and retiring the editor before are the next steps, once the owner has used it.

## Mock-up shortcuts the build does properly

The fly-out start points are estimated from text length: use the real positions. The Edit board's dial
keeps one value across adjustments: each adjustment keeps its own. The curve's dial is not linked on the
board. On the board, tapping a grading wheel doesn't select it. Previews are CSS filters standing in for
the engine. Imports, detection and saving are simulated. Looks needs search and Save current.

## Assets

| File | What | Board blob id |
|---|---|---|
| `editor/assets/dial-strip.webp` | the dial in its slot, 12 frames | `a0c3786c44b0ef98460647f4fc2dbe4c` |
| `editor/assets/plate.webp` | the plain plate | `bc712267550fdecbb140e0d1d15fef3f` |
| (not kept) | the sample photo | `ebb81bda9f92b6c6da9428edc5304d7b` |

The boards load images by the canvas's `/_blob/<id>` paths and Inter from Google Fonts. They are
reference only: they're never served by the site, and the build self-hosts everything under the page's CSP.
