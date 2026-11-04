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
  time, format, dimensions and film simulation. Its day is the capture day in the owner's zone.
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
  lists the app's folder from where the last pass stopped (oldest change first, pages of 100, at most
  200 files a run) and registers each file the shelf does not know with no preview; the phone makes
  one the first time it is opened (a RAF's header and preview fetched by range). Held by the rows
  guard with the other heavy work; waits while Drive is not connected.
- **Offline**: the shelf's pages, each photo, thumbnails and previews are kept on the phone
  (IndexedDB `th-photos`, dropped at sign-out); offline, the kept shelf shows with a plain line.

## 2. Settings › Photos (§3.6, as built)

Google Drive (Connect; or the folder by name and Disconnect; a plain line when Google took the access
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
  (`photo.import`, `photo.delete`, `photo.rate`; `privacy.senses.photos` switches them off).
- **Rows**: an import is 1 read and 4 writes, its preview 3 and 2; the shelf's first page of 14 days
  of 6 photos reads 140 rows ([backend/tests/cost/budgets.json](../../../backend/tests/cost/budgets.json)).
  Drive's quotas are far above one person's use. Owner steps: [SETUP.md §R](../../process/SETUP.md).

## 4. Next

P1b the renderer and Light/Color/Effects/Detail; P1c crop, optics, versions, copy recipe, export;
P1d the camera look and the mind; P2 masks, saved looks and culling.
