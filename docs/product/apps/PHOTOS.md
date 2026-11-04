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
- **Registered** once in Drive (`PUT /v1/photos/:id`): the Drive id, size, SHA-256, camera, capture
  time, format, dimensions and film simulation. The Worker checks with Drive first (one call) that
  the file is in the app's folder with that size and, when Drive gives one, that SHA-256. Its day is the capture day in the owner's zone.
- **The working preview**: made on the phone (`apps/photos/preview.js`) at 2,048 px on its longest
  side (Settings › Photos: 1,024 or 2,048), a JPEG of at most 400 KB, sent to the Worker
  (`PUT /v1/photos/:id/preview`) and kept in the private bucket (`photos/previews/<id>.jpg`), read
  back only through the Worker.
- **The shelf**: days newest first, each with up to four thumbnails and a count; a day opens whole;
  14 days a page ("Earlier days"). Tap a photo for the full-bleed view (the preview on black, its day,
  camera and film simulation). Hold it (or tap the star) for Pick, Reject, a rating of 1–5 and
  Delete.
- **Recently deleted**: a deleted photo leaves the shelf at once and stays 30 days (Restore brings it
  back); then the cron's prune pass purges its row and preview (bytes first), and the next Drive pass
  moves its original to Drive's own trash (the owner can still take it back there).
- **The daily Drive pass** (`areas/photos/reconcile.ts`, from the 15-minute cron once a logical day):
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
  (`photo.import`, `photo.delete`, `photo.rate`, `photo.edit` with the panel only; `privacy.senses.photos` switches them off).
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
  drag to pan, double-tap between fit and 1:1.
- **The recipe**: Lightroom's crs names where they map (`shared/contract/photos-recipe.ts`), defaults
  left out (as shot is `{}`); saved half a second after the last change, kept on the phone until the
  Worker has it (offline too), idempotent by hash, a ledger row per change whose undo is the recipe
  before. The sense `photo.edit` names the panel only.

## 5. Next

P1c crop, optics, versions, copy recipe, export;
P1d the camera look and the mind; P2 masks, saved looks and culling.
