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

The strip is now Light · Color · Effects · Detail · Optics · Crop · Versions, and Export sits in the
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

## 7. Info (as built)

- **The sheet** (`info-sheet.js`): Info (ⓘ) in the editor's top bar, and Info in the shelf's tile
  menu. Sections, a row each (48 px, the label left, the value right in tabular numbers): **Camera**
  (body, lens, focal length with its 35 mm equivalent, the exposure as shutter · aperture · ISO, bias
  in thirds, program, metering, flash, the camera's own stars); **Film** (film simulation, dynamic
  range, DR priority, highlights, shadows, colour, sharpness, noise reduction, clarity, grain, colour
  chrome and its blue, white balance and its shift, stabilisation; a black-and-white photo shows its
  warm–cool and magenta–green instead of colour); **Image** (size, orientation, format, file size, when
  it was taken in the owner's zone, software); **Histogram** (red, green and blue: in the editor the
  live render's, from the shelf the preview's); **Edit** (edited or as shot, how many versions; the
  app keeps no count of exports, so none is shown); **Drive** (In Drive or Uploading, the folder).
  Copy at the bottom copies it as plain text. A row the file does not have is left out.
- **Reading** (`exif.js`, `fuji.js`): from the JPEG the camera embedded (a RAF's) or the JPEG itself,
  its APP1's IFD0 and EXIF IFD; from a DNG, its own IFDs. Fujifilm's maker note by tag, the ids as
  ExifTool's public FujiFilm table documents them (no code copied): FilmMode 0x1401, the colour
  0x1003 (and its black-and-white modes), dynamic range 0x1402 and 0x1403, DR priority 0x1443–0x1445,
  highlight 0x1041 and shadow 0x1040, sharpness 0x1001, noise reduction 0x100E, clarity 0x100F, grain
  0x1047 and 0x104C, colour chrome 0x1048 and 0x104E, white balance 0x1002 with 0x1005 and its fine
  tune 0x100A, the monochrome warm–cool 0x1049 and magenta–green 0x104B, stabilisation 0x1422. The
  smooth skin effect has no documented id (0x1049 is the monochrome adjustment there), so it is not
  read. The codes are kept as the camera wrote them and put into its words on the phone (Classic
  Chrome, DR400, +1, Strong); a code the table does not know shows as its number.
- **Kept** (`photos.info`, step 45): the registration carries it (`PUT /v1/photos/:id` `info`); a
  photo registered before, or found in Drive, gets it the first time it is opened: the editor reads
  only the bytes that hold it from the original in Drive (a RAF's 92-byte header and the first 160 KB
  of its embedded JPEG; a JPEG's first 160 KB; a DNG's first 512 KB) and sends it by
  `PUT /v1/photos/:id/info`, with the camera and film for a photo that has none. An allowlist of
  numbers and two names (lens, software, ≤ 80 characters), ≤ 2 KB; the Worker drops a key it does not
  know and keeps it canonical, so the same info again writes nothing. `{}` is a file that said nothing.
- **Never a place**: the GPS IFD (pointer 0x8825) is never followed and the allowlist has no place
  key, so where a photo was taken is not read, shown, copied or sent (SECURITY.md §10).
- **The mind**: nothing new. The info stays on the photo; no sense carries it.
- **Cost**: an import with its info is 2 rows read and 5 written (1 and 4 without); opening a photo
  with its info reads 3; the first open's info 3 and 2, the same again 2 and 0.

## 8. Next

The RAF's own lens tables through the engine; P1d the camera look and the mind; P2 masks, saved looks
and culling.
