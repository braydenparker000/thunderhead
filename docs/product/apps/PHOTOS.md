# Photos

The seventh app on the ring (`/photos/`, Settings › Photos). A RAW editor for one person's
photographs that lives on the phone and keeps originals in that person's own Google Drive. This page
is what is built; the full plan (editing, looks, export, the mind) comes in later steps (P1b–P2b).
Step P1a, 2026-11-04: the shelf and the store. No editing yet.

## 1. Import and the shelf (§3.1 of the plan, as built)

- **Import** from the picker (Import, or pull down on the shelf): RAF, DNG, JPEG, and HEIC where the
  phone's browser decodes it; several at once.
- **At once**: the phone reads the file's own embedded JPEG (`apps/photos/read.js`, no engine): a
  RAF's header gives the JPEG's offset and length (0x54, big-endian), a DNG its largest
  reduced-size IFD, a JPEG or HEIC is itself. From that JPEG's EXIF (or the DNG's IFDs): the
  capture time (`DateTimeOriginal` with `OffsetTimeOriginal`, else the phone's zone, else the file's
  time), the camera (Make and Model) and, for Fujifilm, the film simulation (MakerNote `FilmMode`,
  and `Saturation` for Acros and Monochrome). Only the bytes it needs are read. A 360 px thumbnail is
  on the shelf in well under a second.
- **The original** goes straight to Drive (`apps/photos/drive.js`): a resumable upload the phone
  runs itself, in 8 MiB chunks with progress, with a token the Worker mints
  (`POST /v1/photos/upload-token`). A dropped connection asks Drive how far it got and goes on; the
  session is kept on the phone, so a reload resumes it. The bytes never pass through the Worker.
- **In the background** (2026-11-05; `apps/photos/background.js`, `sw.js`): where the browser has
  Background Fetch (Chrome on Android) and the service worker runs, leaving Photos or locking the
  screen no longer pauses an import. The fast part happens in the page as before (the header and
  embedded preview read, the thumbnail at once, the preview made and sent); the photo is registered
  *pending* (`drive_id` null) and the page then hands each original to the browser: one Background
  Fetch per file, a single `PUT` of the whole file to the Drive resumable session the page opened.
  The system's notification shows "Uploading <file name>" and its progress, then "In Drive: <name>"
  (or "Did not upload: <name>"); tapping it opens Photos. When it ends, the service worker tells
  the Worker the photo's Drive id (`PATCH /v1/photos/:id {drive_id}`, checked with Drive) with this
  phone's session and tells an open Photos page. A failure, or Drive's 308 (part of it arrived),
  keeps the session on the phone; the row says "This one did not upload." with Try again, and the
  same file picked again resumes the session by range. On the next open the page settles what is
  left: a fetch still running shows its progress; one that ended without the Worker hearing of it
  is finished from Drive's own word on the session. **The session's address is its own credential**:
  the PUT carries no Drive token (as `drive.js` has always done for each chunk), so a long upload
  never meets the token's one-hour life; Drive keeps a session about a week. Files over 2 GiB, and
  browsers without Background Fetch (Safari), keep the page upload; Safari says so once ("Keep
  Photos open while it uploads").
- **Pending photos** are on the shelf with their thumbnail and a small "Uploading" mark; they cannot
  be exported or pasted to until they are in Drive (`GET /v1/photos/pending` lists them). One still
  pending after 7 days, or that this phone knows failed, is marked "Did not upload": import the same
  file again to finish it (it becomes that photo, not a new one), or delete it. The daily pass
  leaves pending photos alone, except that a file in the folder with a pending photo's name and size
  is taken as that photo rather than registered twice.
- **Registered** once in Drive, or pending before a background upload (`PUT /v1/photos/:id`): the Drive id, size, SHA-256, camera, capture
  time, format, dimensions and film simulation. The Worker checks with Drive first (one call) that
  the file is in the app's folder with that size and, when Drive gives one, that SHA-256. Its day is the capture day in the owner's zone.
- **The working preview**: made on the phone (`apps/photos/preview.js`) at 2,048 px on its longest
  side (Settings › Photos: 1,024 or 2,048), a JPEG of at most 400 KB, sent to the Worker
  (`PUT /v1/photos/:id/preview`) right after the registration and kept in the private bucket
  (`photos/previews/<id>.jpg`), read back only through the Worker. The embedded JPEG is decoded
  once: one bitmap gives the thumbnail and then the preview, which is made while the upload runs
  (the upload starts first). A failed preview never fails the import; the photo gets one when it is
  first opened.
- **Import from Drive** (From Drive, beside Import; 2026-11-05): for photos already in the owner's
  Drive, put there on its own time (the Drive app, a laptop) instead of uploaded from the phone in
  the foreground. A tap (never before) loads Google's picker (`apps/photos/pick.js`) with the Drive
  token the phone already gets for uploads and a public picker key (SETUP.md §R5); it opens in the
  app's folder and lets the owner go anywhere in their Drive, folders shown, up to 100 at once.
  Under `drive.file` the app sees only files it made, so the picker is how the owner hands others
  over: each file picked becomes visible to this app, and nothing else does (the scope never
  widens). Only RAF, DNG, JPEG and HEIC are taken; a toast says how many others were skipped. The
  phone sends the ids 20 a request (`POST /v1/photos/from-drive`, with "20 of 60" as it goes); the
  Worker asks Drive for each file's name, size, times, SHA-256 and what Drive read from the image
  (EXIF time, dimensions), one call a file, and registers the ones the shelf does not know the way
  the daily pass does (no preview, no ledger row); a known one, however it came, is `already`. The
  files stay where they are in Drive: the shelf keeps their ids. Each is on the shelf at once as a
  tile with its name and "Preview coming", then the phone makes its thumbnail and preview from the
  original in Drive (`previewFromDrive`: a RAF's header and embedded JPEG by ranged reads), three at
  a time. Without a picker key, or with Drive not connected, the button is off and says why.
- **The shelf**: days newest first, each with up to four thumbnails and a count; a day opens whole;
  14 days a page ("Earlier days"). Tap a photo for the full-bleed view (the preview on black, its day,
  camera and film simulation). Hold it (or tap the star) for Pick, Reject, a rating of 1–5 and
  Delete.
- **Recently deleted**: a deleted photo leaves the shelf at once and stays 30 days (Restore brings it
  back); then the cron's prune pass purges its row and preview (bytes first), and the next Drive pass
  moves its original to Drive's own trash (the owner can still take it back there).
- **The daily Drive pass** (`areas/photos/reconcile.ts`, from the 15-minute cron once a logical day;
  it registers a file the same way as an import from Drive, `areas/photos/ops.ts`):
  moves at most 20 purged originals to Drive's trash (each on its own; a busy Drive's waits a day),
  then lists the app's folder from where the last pass stopped (oldest change first, one page of at
  most 200 files: a run makes at most 22 outbound calls, under the free plan's 50) and registers each file the shelf does not know with no preview; the phone makes
  one the first time it is opened (a RAF's header and preview fetched by range). Held by the rows
  guard with the other heavy work; waits while Drive is not connected.
- **Offline**: the shelf's pages, each photo, thumbnails and previews are kept on the phone
  (IndexedDB `th-photos`, dropped at sign-out); offline, the kept shelf shows with a plain line.

## 2. Settings › Photos (§3.6, as built)

Google Drive (Connect; or "Connected as" the consenting Google account, the folder by name and Disconnect; a plain line when Google took the access
back), Preview size (`photos.preview_size`, 1,024 / 2,048 px), What stays on the phone
(`photos.keep`: previews only; recent originals come with editing and are shown, not yet chosen),
and Recently deleted. [MENU-AND-SETTINGS.md §6.6c](../MENU-AND-SETTINGS.md).

## 3. Privacy and cost (§3.7, as built)

- **Originals**: the owner's Drive, by the owner's choice, the one named exception in
  [PRIVACY.md §5](../../engineering/PRIVACY.md). Scope `drive.file`: the app sees only the files it
  made. The refresh token is sealed in the Auth object (AES-GCM, a key from `AUTH_PEPPER`); access
  tokens live at most an hour, in the Auth object's memory, and go only to the owner's phone.
- **What the Worker keeps**: one row per photo (ids, numbers, the camera's words) and a preview of
  at most 400 KB (ten thousand photos of 300 KB is 3 GB, inside R2's free 10 GB).
- **The mind** sees no pixel, no name and no token: the senses carry ids, formats and ratings only
  (`photo.import` with the format and `source` phone or drive, `photo.delete`, `photo.rate`, `photo.edit` with the panel only, `photo.paste` with the count and panels only; `privacy.senses.photos` switches them off).
- **Rows**: an import is 1 read and 4 writes, its preview 3 and 2; the shelf's first page of 14 days
  of 6 photos reads 140 rows; a saved recipe 3 reads and 6 writes, the same one again 2 and 0 ([backend/tests/cost/budgets.json](../../../backend/tests/cost/budgets.json)).
  Drive's quotas are far above one person's use. Owner steps: [SETUP.md §R](../../process/SETUP.md).

## 4. The editor (§3.3 of the plan: Light, Color, Effects, Detail, as built)

- **Open**: Edit on the full-bleed view (`?edit=<id>`). The photo fills the screen on black; along the
  bottom the panel strip (Light · Color · Effects · Detail), the chosen panel's tools as chips, and one
  tool at a time above them, the layout of Lightroom on a phone in our design system (Switzer,
  Phosphor, the tokens). The panel and its last tool are remembered.
- **First frame**: the preview on this phone draws at once; the original then comes from the owner's
  Drive: a RAF or DNG through the engine (engine/photos, LightCraft's decoders) in a Web Worker, its
  half-size linear working copy uploaded to the GPU and the CPU copy freed; a JPEG or HEIC decoded by
  the browser (at most 4,096 px). Offline, the preview is what is edited. Measured in headless Chromium
  on the CC0 X-E5 sample (14-bit lossy, 40 MP): the preview at 0.1 s, the first real frame at 9.5 s
  (single thread, x86), 107.7 MiB of wasm.
- **Colour**: the file's own matrices (DNG), else LightCraft's bundled ones for the body, else its
  neutral fallback (camera RGB taken as linear sRGB), with the file's as-shot white balance. The X-E5
  has no bundled matrix, so it gets the neutral fallback; the camera look is P1d.
- **The pipeline** (ours, `frontend/apps/photos/edit/`): WebGPU where the phone has it, else WebGL2,
  the same three passes in WGSL and GLSL (`shaders/`): prep (the proxy at screen size, log luminance
  beside it), two blur levels, and develop per frame: white balance → exposure → tone (Highlights and
  Shadows as local exposure from the large blur; Contrast, Whites, Blacks and the point curves in a
  1,024-entry lookup; a soft base curve for RAW) → HSL in eight ranges → Vibrance, Saturation → B&W →
  Grading → Texture, Clarity, Dehaze → Sharpening → Noise reduction (a 5×5 bilateral) → Vignette →
  Grain → sRGB. Zoomed past the proxy, a detail proxy of the visible part: from the working copy,
  and at 1:1 from a full-resolution tile the engine demosaics.
- **Controls**: Light (Auto: Exposure and Contrast from the histogram, said to be a start; Exposure
  ±5 EV; Contrast, Highlights, Shadows, Whites, Blacks ±100; the point curve, all or one channel: tap
  to add, drag, double-tap to remove). Color (white balance as shot, Auto, the picker, Temp
  2,000–50,000 K and Tint; Vibrance; Saturation; Mix: eight colours, hue, saturation and luminance,
  and a drag on the photo for the colour under the finger; Grading: three wheels with luminance,
  Blending and Balance; B&W). Effects (Texture, Clarity, Dehaze; Vignette amount, midpoint, feather,
  roundness; Grain amount, size, roughness). Detail (Sharpening amount, radius, detail, masking; noise
  and colour noise with their detail). A slider shows its value in words and as a number; drag
  anywhere on it, tap beside the thumb to nudge one step, double-tap to reset.
- **Gestures**: hold the photo for as shot, two fingers for the histogram, pinch to zoom up to 1:1 and
  drag to pan, double-tap between fit and 1:1 (animated, 200 ms on the `--ease-out` curve). While a
  finger moves (`edit/zoom.js`), the frame last developed is moved by a CSS transform, over a backdrop
  of the whole photo for what the move uncovers, so a gesture costs no GPU pass; the photo develops
  again when the fingers stop for 120 ms or lift. A pinch zooms about the point between the fingers and
  keeps it under them as they move. A fling glides a short way; past an edge or a zoom limit the photo
  gives like a rubber band and comes back. The detail proxy on screen stays until the new one is ready;
  a new one is asked for only when the fingers stop or lift, one at a time, and a stale one never draws.
  Measured in headless Chromium on the X-E5 working copy: no frame over 32 ms in a two-second pinch.
- **The recipe**: Lightroom's crs names where they map (`shared/contract/photos-recipe.ts`), defaults
  left out (as shot is `{}`); saved half a second after the last change, kept on the phone until the
  Worker has it (offline too), idempotent by hash, a ledger row per change whose undo is the recipe
  before. The sense `photo.edit` names the panel only.

## 5. The editor's second half (§3.3 and §3.4 of the plan: Optics, Crop, Versions, Export, as built)

The strip is now Light · Color · Effects · Detail · Optics · Crop · Versions (and Looks, §7), and Export sits in the
top bar.

- **Crop and geometry**: while the Crop panel is open the photo shows its whole straightened frame
  with the crop over it (corner handles, the rule-of-thirds grid, the outside dimmed): drag a corner or
  an edge to resize, inside to move. Aspect: Original (the default lock), 1:1, 4:5, 3:2, 16:9, Free, and
  a turn between landscape and portrait. Rotate is the wheel, ±45° in tenths; Level: draw a line along
  the horizon or an edge and the photo turns to make it level (or upright, past 45°). Flip across or
  over; Vertical and Horizontal perspective ±100; Constrain crop keeps the crop inside the photo after
  perspective and distortion (rotation always is); Reset. In the develop pass geometry is a mapping
  from each output pixel back to the photo (`edit/geometry.js` and `shaders/geometry-body.js`, the
  same steps): flip, crop, the straightened frame's zoom, rotation, perspective, lens distortion. So
  the crop is the last step before output, and vignette and grain lie on the cropped frame. The
  crop's edges are fractions of the straightened frame (not of the original, as Lightroom's are).
- **Optics**: Remove chromatic aberration measures this photo's lateral fringes on the RAW working
  copy (the radial scale of red and blue that best lines each up with green at the strongest edges of
  the outer frame) and samples red and blue at those scales; a camera JPEG comes with this done. The
  RAF's own lens tables (LightCraft's `raf_lens`, the X-E5 among its checked bodies) are not exposed
  by our engine build yet, so Distortion and Lens vignetting (±100) are set by hand.
- **Versions**: an automatic version when an editing session ends (leaving the editor, or ten minutes
  without a change), named ones (Create version, rename, delete), at most 20 of each per photo in
  Core. The panel is a filmstrip, newest first, each drawn small with the current crop: tap one to
  restore, rename or delete it; tap a second to compare the two side by side with the same crop.
  Restore is a recipe put, so the toast's Undo (and the ledger's) puts the one before back.
- **Export**: Size (full, 2,048 or 1,080 px on the long side), Format (JPEG; HEIC where the browser
  writes it, up to 2,048 px; Chromium and today's Safari do not), Quality 10–100 (90), and where: the
  share sheet, Files or a "Thunderhead Exports" folder the phone makes beside the app's folder in
  Drive, by the same resumable upload as originals. Files is a save dialog where the browser has one
  (desktop Chromium: asked at the tap, before the render, a folder for a batch); where it has none
  (Chrome on Android, the installed app) it is called Download and saves to Downloads one file at a
  time, half a second apart (a second download started at once can be dropped), and for more than
  three where the share sheet takes files it offers Share or Download. A share that outlives the tap
  asks for one more. Files are named after the photo and the size (`IMG_0001-2048.jpg`,
  `-1080`, `-full`). Settings › Photos holds the size and
  format it starts with. Each photo renders from its original: the output in bands of 256 rows, each
  band in blocks of 1,024 columns; a block's region of the photo (through the geometry, padded) comes
  from a 1:1 engine tile when the export is finer than the working copy, else from the working copy;
  the band goes to our streaming JPEG encoder in a worker (decisions.md, 2026-11-04). sRGB (JFIF).
  The sheet takes a batch of up to 20 with progress and Cancel: from the editor with one photo, or
  from the shelf with the photos chosen (§6). The sense `photo.export` names the size, format and where.
- **The XMP names**: the JPEG's APP1 carries the recipe as XMP: `crs:` (Camera Raw settings) for every
  key Lightroom has (all but the flips: `Exposure2012`, `Contrast2012`, the HSL and grading keys,
  `PostCropVignette*`, `Grain*`, `Sharpness`, `SharpenRadius`, `LuminanceSmoothing`, `Crop*`,
  `CropAngle`, `PerspectiveVertical`, `PerspectiveHorizontal`, `LensManualDistortionAmount`,
  `VignetteAmount`, `AutoLateralCA`, `LensProfileEnable`, `CropConstrainToWarp`, `WhiteBalance`,
  `Temperature`, `Tint`, `ConvertToGrayscale`, the `ToneCurvePV2012*` sequences), with `crs:HasCrop`
  when cropped and `crs:AlreadyApplied="True"` so a reader knows the pixels carry the edit; the flips
  go under our own namespace `urn:thunderhead:photos:1.0` (`th:FlipHorizontal`, `th:FlipVertical`).
  The names are Lightroom's; the numbers mean ours, close but not identical.

## 6. Copy and paste, choosing photos (§3.3 Copy recipe and §3.4 Export batch of the plan, as built)

- **Copy** (`edit/copy.js`): More (⋯) in the editor's top bar opens Copy edit, the six panels as
  switches (Light, Color, Effects, Detail, Optics, Crop and geometry), each with how many changes it
  has on this photo or "as shot"; all on but Crop and geometry. Copy holds the chosen panels and the
  photo's keys in them (`copied.js`), in memory and in the tab's session storage, so a reload keeps it
  and closing the tab lets it go. Each panel owns its keys (`shared/contract/photos-paste.ts`
  `PANEL_KEYS`; Light has the curves, Color the white balance, the mix, grading and black and white,
  Optics the two switches, Crop and geometry the crop, angle, perspective, constrain and flips), so a
  key the copy leaves out is pasted as that panel's default: pasting Light from a photo with no
  contrast change sets contrast back to as shot.
- **Choosing photos** (`select.js`): on the shelf or a whole day, a long press (450 ms, a short buzz
  where the phone has one) starts choosing; then a tap adds or takes away. A bar on top counts them
  and has Cancel, Paste (while an edit is copied) and Export; at most 20, and the 21st tap says so.
  While an edit is copied, a chip under the title names its panels, with × to let it go.
- **Paste**: one call, `POST /v1/photos/paste` (API.md §11.26): each photo keeps its own keys outside
  the copied panels and takes the copy's inside them; a photo whose edit is replaced gets an automatic
  version of that edit first (the same caps as Versions; a photo as shot needs none); a photo that
  already has the look writes nothing. One ledger row for the paste ("pasted a look to 12 photos"),
  and the line under the title offers Undo, which puts every photo back; a photo edited again since
  keeps that edit. The same paste again (a retry) writes nothing and answers the same row. The sense
  `photo.paste` names how many photos and which panels, never a value or an id.
- **Export from the shelf** (`edit/batch.js`): the chosen photos open the Export sheet; each renders
  as the editor's Export does (its recipe, its original or a tile of it, else its preview), one
  renderer for the batch and one photo in memory at a time. Nothing new in the renderer.
- **Cost**: a paste onto 1 photo is 3 rows read and 8 written, onto 12 photos 48 read and 41 written,
  the same 12 again 13 read and none written (backend/tests/cost/budgets.json).

## 7. Looks (P5a: saved looks, .xmp presets, pasted recipes, as built)

The strip's eighth panel, Looks (`edit/looks.js`), applies pre-made edits without leaving the site.
Its chips are the sections: **Mine** (saved from an edit), **Imported** (.xmp presets), **Recipes**
(pasted camera recipes) and **Camera** (empty for now: the camera's film simulations learn from
RAW+JPEG pairs in a later release, and say so). Each look is a card in a strip, drawn small through
this photo as shot with its current crop, cached per photo, look and crop, only as it scrolls into view.

- **Apply**: a tap. The look is a recipe over chosen panels (the Copy sheet's): the photo keeps its keys
  outside them and takes the look's inside them (`edit/looks-apply.js`), saved as an ordinary recipe
  put, with Undo in the toast and the ledger's undo on the Worker. Two differences from a paste: a
  look's **white balance is relative** (its Temperature reads against 5,500 K and its Tint against 0,
  and applying it shifts the photo's own white balance by that much, in mired), and a look with no
  white balance leaves the photo's. Then **Amount** (0–200 %) scales every number's way from the photo's
  value before to the look's (200 % is twice the change, held inside each range); a curve moves point
  by point; a switch, a hue and a white balance mode take the look's above 0. Any other edit ends the
  Amount dial for that look.
- **Save as a look** (at the top of every section): a name, and the panels as switches (Light, Color,
  Effects and Detail on; Optics and Crop off), white balance kept as a shift from the photo's own.
- **A long press** on a look: rename it, **Update from current edit** (its panels from this edit), or
  delete it (Undo in the toast puts it back).
- **Store**: `/v1/photos/looks` (API.md §11.26), Core step 44, table `photo_looks`: at most 500 looks;
  each recipe checked by the recipe's schema, only its panels' keys, at most 4 KB. The phone keeps a
  copy for offline. A thumbnail column is there for later; nothing fills it yet.
- **Sense**: `photo.look` with the look's source and how many panels it sets, never its name or a value.
- **Cost** (backend/tests/cost/budgets.json): the list of 21 looks is 42 rows read; a look saved 1 read
  and 1 written; 20 presets in one PUT 21 read and 20 written; a rename 3 and 1; a delete 2 and 1; a
  look applied is the recipe put, 3 read and 6 written.

### .xmp presets (`edit/xmp-import.js`, `edit/looks-import.js`)

Import .xmp takes one or many preset files of the common desktop editor (the crs namespace) from Files,
or from Drive through the shelf's picker narrowed to .xmp files. Each is read on the phone; only the
values our recipe has are kept, each held inside its range; everything else is counted and the toast
says how many settings were skipped. The preset's `crs:Name` (else the file's name) is the look's name
and its `crs:Group` a tag shown as a chip. Nothing else is read or kept: no author, no description, no
embedded image. The same preset again (the same name and settings) is not added twice. A preset the
owner downloads is theirs to use under its own terms; the app stores only the numbers, never the file.

| In the preset (crs:) | In our recipe |
|---|---|
| `Exposure2012`, `Contrast2012`, `Highlights2012`, `Shadows2012`, `Whites2012`, `Blacks2012` | the same keys (Light) |
| `ToneCurvePV2012`, `…Red`, `…Green`, `…Blue` (an `rdf:Seq` of "x, y") | the same curves; past 16 points, 16 spread along it |
| `Texture`, `Clarity2012`, `Dehaze`, `PostCropVignette*`, `GrainAmount`, `GrainSize`, `GrainFrequency` | the same keys (Effects) |
| `Vibrance`, `Saturation`, `Hue/Saturation/LuminanceAdjustment` × the eight colours | the same keys (Color) |
| `SplitToningShadowHue/Saturation`, `SplitToningHighlightHue/Saturation`, `SplitToningBalance`, `ColorGradeMidtoneHue/Sat/Lum`, `ColorGradeShadowLum`, `ColorGradeHighlightLum`, `ColorGradeBlending` | the same keys (Grading) |
| `WhiteBalance="Custom"` with `Temperature`, `Tint` | relative: kelvin read against 5,500 K; a JPEG preset's ±100 as about ±50 mired (+ warmer); Tint as is. `Auto` kept; `As Shot` or none: the photo's own |
| `Sharpness`, `SharpenRadius`, `SharpenDetail`, `SharpenEdgeMasking`, `LuminanceSmoothing`, `LuminanceNoiseReductionDetail`, `ColorNoiseReduction`, `ColorNoiseReductionDetail` | the same keys (Detail) |
| `ConvertToGrayscale`, `AutoLateralCA`, `LensProfileEnable`, `LensManualDistortionAmount`, `VignetteAmount` | the same switches and keys |
| a `crs:Look` block's `crs:Parameters` | fill the keys the preset leaves out, scaled by the block's `crs:Amount` |
| crop and angle, masks, local adjustments, profiles, anything else | skipped and counted |

### Paste a recipe (`edit/recipe-text.js`)

Paste a recipe takes the text of a camera recipe, the usual block of lines, read in any case and
order, with the short names (WB, NR, DR, CCE, CCFXB, "Grain: Strong/Large"), and a **From** line
(≤ 120 characters, a page title, optional) kept as its credit. Nothing is fetched. A line it cannot
read (ISO, exposure compensation: how to shoot, not an edit) is counted, never guessed. The **film
simulation** is kept as a name on the look (a chip), not rendered: the look applies everything but the
simulation and says so, until the Camera section's learned looks supply it (decisions.md, 2026-11-05);
a black and white one (Acros, Monochrome, Sepia) sets B&W. Panels: Light, Color, Effects and Detail, so
a setting the recipe does not name is the camera's zero.

| In the recipe | In our recipe |
|---|---|
| Highlight (−2 … +4) | Highlights2012 = 15 × the step (+ brighter, harder highlights) |
| Shadow (−2 … +4) | Shadows2012 = −15 × the step (+ deeper, harder shadows) |
| Dynamic Range DR100 / DR200 / DR400 | Highlights2012 0 / −10 / −20 more (a wider range holds the highlights back) |
| Color (−4 … +4) | Saturation = 10 × the step |
| Sharpness (−4 … +4) | Sharpness = 40 + 10 × the step |
| Noise Reduction (−4 … +4) | LuminanceSmoothing = 20 + 5 × the step |
| Clarity (−5 … +5) | Clarity2012 = 10 × the step |
| Grain Effect Off / Weak / Strong, Small / Large | GrainAmount 0 / 25 / 50, GrainSize 25 / 50 |
| Color Chrome Effect Weak / Strong (an approximation) | Red, Orange, Yellow, Green and Magenta: Luminance −5 / −10 and Saturation −3 / −6 (deep colours denser, a touch of saturation roll-off) |
| Color Chrome FX Blue Weak / Strong | Blue Luminance −6 / −12 and Saturation −3 / −6; Aqua half that |
| White Balance: Auto, Daylight, Shade, or kelvin | relative to 5,500 K: Auto and Daylight 5,500 K, Shade 7,500 K, kelvin as given; others skipped |
| White balance shift R, B (−9 … +9) | 2.5 mired warmer for each step of red over blue; Tint = 3 × (red + blue) (+ magenta) |
| Film Simulation | kept as the look's film name (see above) |

## 8. Next

The RAF's own lens tables through the engine; P1d the camera look and the mind; P2 masks and culling;
the camera's learned looks (RAW+JPEG pairs) fill Looks' Camera section.
