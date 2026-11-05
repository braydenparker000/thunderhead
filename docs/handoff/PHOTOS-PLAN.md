# Photos: the plan (2026-11-04)

Owner rulings so far: RAW on day one (Fujifilm X-E5, X-Trans, 40 MP); JPEG nice to have; originals on the owner's Google Drive (2 TB); Lightroom's ideas, not Lightroom; as good or better. Benchmark floor: a Samsung Galaxy A35 (Exynos 1380, Mali-G68, 6–8 GB, Chrome on Android 14): every target phone is faster. Engine (spike P0, 2026-11-04): LightCraft's decode and colour crates pinned at ae7ac42 with two memory patches; our shaders; the working copy built in a worker behind the embedded JPEG. This page is the full scope: what it is, every feature, how each behaves, what is out, the steps. Design inputs: PHOTOS-DESIGN-2026-11-04.md, PHOTOS-STUDY-lightroom-mobile.md, photos-study/BLOCKS.md, photos-study/LIGHTCRAFT.md.

## 1. What it is

The seventh app on the ring. A RAW editor for one person's photographs that lives on the phone, keeps originals in that person's own Drive, keeps edits as small recipes, renders on the phone's GPU, and has a mind that knows the person's taste. No account but the owner's sign-in, no plan, no cloud rendering, nothing scanned.

**Better than Lightroom in five ways** (each is a feature below): it knows you (looks proposed from what you keep); nothing leaves your own storage; a photo is a day in your memory; twelve controls, not sixty, with the rest a word away; fast, because the only network is the upload once.

## 2. Principles

1. Non-destructive always: the original is never written; a recipe is applied on view and on export.
2. The phone does the work: decode, render, masks, export, all on device; the Worker holds ids, recipes and previews.
3. Memory is bounded: never the full-size float image in memory; a half-size working copy for editing, tiles for export.
4. Everything is undoable and every action has a why: the ledger as in every other app.
5. Counts and ids only reach the mind; pixels never do.
6. Switzer, Phosphor, the design system; phone size first; reduced motion respected; 44 px hits.

## 3. Features and behaviours

### 3.1 Import and the shelf
- Import from the photo picker (Files or Photos on iOS, the document picker on Android): RAF, DNG, JPEG, HEIC (iOS native; Android HEIC later). Several at once.
- On import: the file goes straight to the owner's Drive folder with a short-lived token the Worker mints; the phone decodes the embedded preview at once (RAF and DNG carry one) so the shelf shows the photo in under a second, then builds a 2048-px working preview and sends it to the Worker; the recipe starts as "as shot" with the camera's white balance and, for Fujifilm, the film simulation named in the file recorded as the camera look.
- The shelf is by day, newest first, like the Briefing's days; a photo's day is its capture day in the owner's zone. A day row shows up to four thumbnails and a count. Pull down to import. Long-press a photo for flag, reject, rate (1–5), copy recipe, delete (to Recently deleted, 30 days, like conversations).
- Reconciliation: once a day the Worker lists the Drive folder (ids only); a file added by hand or from the camera's own app appears on the shelf with no recipe until it is opened on the phone.
- Offline: the shelf and previews are cached on the phone (IndexedDB); editing a cached photo works offline on the preview; the recipe syncs when back. The original is fetched from Drive only for export or a zoom past the preview.

### 3.2 Culling
- Flag, reject, rate, by swipe on the full-bleed view (up flag, down reject, two-finger tap rate). Filter the shelf by flag, rating, camera, day, and "edited".
- Compare two photos side by side with the same crop (for choosing between frames).

### 3.3 Editing: the panels, in Lightroom's order, twelve primary controls
The strip along the bottom: Light · Color · Effects · Detail · Optics · Crop · Masks · Looks · Versions. One slider at a time, value shown in words and numbers, double-tap resets, hold the photo for before/after, two fingers for the histogram, drag on the photo for the targeted tool where it exists.
- **Light**: Exposure (−5…+5 EV), Contrast, Highlights, Shadows, Whites, Blacks (−100…+100); Tone curve (points, RGB and per channel). Auto: a one-tap exposure and contrast from the histogram, honestly labelled as a start.
- **Color**: White balance (as shot, auto, picker, Temp 2000–50000 K, Tint), Vibrance, Saturation; Mix: eight hue ranges each with hue, saturation, luminance and a targeted drag; Grading: shadows, midtones, highlights wheels with blending and balance; Black and white toggle.
- **Effects**: Texture, Clarity, Dehaze; Vignette (amount, midpoint, feather, roundness); Grain (amount, size, roughness).
- **Detail**: Sharpening (amount, radius, detail, masking); Noise reduction luminance and colour (amount, detail). RAW needs both from day one.
- **Optics**: chromatic aberration removal; lens profile from the RAF's own correction data (Fujifilm embeds distortion and vignetting), else none; manual distortion and vignetting.
- **Crop and geometry**: aspect presets and free, rotate ±45°, flip, level by drawing a line, perspective (vertical, horizontal) with constrain crop.
- **Masks** (P2): subject and sky by a model on the phone, linear and radial gradients, brush with size, feather and flow, luminance and colour range; masks as named layers with invert, add, subtract; per mask Light, Color and Effects.
- **Looks**: the camera look (Fujifilm film simulation matched from the embedded JPEG; measured, not promised), your saved looks (a recipe subset with an amount slider), and the mind's proposed look as a card. Looks never hide slider values: applying one sets the sliders so you can see what it did.
- **Versions**: an auto version per editing session, named versions, compare any two, restore.
- **Copy recipe**: copy all or chosen panels from one photo and paste to many.

### 3.4 Export and share
- Sizes: full, 2048, 1080; JPEG quality 10–100 or HEIC on iOS; sRGB always, Display P3 as an option; the recipe embedded as XMP in the file (Lightroom-compatible names where they map) so edits survive outside.
- Export renders from the original in tiles on the phone; progress per photo; batch of up to 20 with a cancel. Share sheet, Files, or back to Drive in an "Exports" folder.

### 3.5 The mind in Photos
- Senses: `photo.import`, `photo.edit` (panel used, not values), `photo.export`, `photo.look_kept`, `photo.look_dismissed`, `photo.rate`. Ids and counts only.
- One arrangement slot, "a look for this": placed on a new photo at most once a day under the tiles class (quiet); the card shows the look's name and why ("you warmed every evening shot this month"); Keep applies it as a version, Dismiss rests the topic 14 days; the meter and the learning count it.
- `th photos week`: imports, edits, exports, looks kept and dismissed, top cameras and days, counts only. A `photos` skill (≤ 2,500 chars) for the chat: what it may say about photos (counts, days, your own look names), what it may never see (pixels), and the recipe verb `photo.look` (class tiles, undo = previous recipe).
- Growth note (D2's loop): one line a week in the Briefing when there is something to say ("eleven photos edited, three looks kept").
- Recall: a photo is findable by day and by your own words about it (a caption you wrote), by meaning after D1 indexes captions.

### 3.6 Settings › Photos
- Drive folder (the one the app made, shown by name; reconnect), preview size (1024 / 2048), the mind's look cards on or off, default export size and format, haptics on sliders, what to keep on the phone (previews only / previews and recent originals), Recently deleted.

### 3.7 Privacy and cost
- Originals: the owner's Drive, by the owner's choice; PRIVACY.md names it as the one exception. The Worker never stores or proxies original bytes; access tokens are short-lived and scoped to the app's folder.
- Previews (small JPEGs) and recipes under the owner's sign-in in the Worker (R2 for previews: ten thousand photos of 300 KB is 3 GB, inside the free 10 GB).
- Rows: about 3 per import and 1 per saved edit; the shelf reads by day, paged.
- Cost: zero. Drive API quotas are far above one person's use.

## 4. Out of scope for v1
Generative remove or fill, lens blur with depth, healing and clone, HDR editing and HDR export, video, desktop, sharing to other people, batch editing beyond copy recipe, lens profiles beyond what the RAF embeds, tethering, DNG conversion of other brands' RAW (import them as they are, decode if the engine can).

## 5. The engine, decided by a spike
- P0 spike (one builder, one day): compile LightCraft's decoder and colour crates (MIT or Apache-2.0, pure Rust, RAF with X-Trans, DNG 1.7 JXL) to WebAssembly without its app; decode an X-E5 RAF on a phone (iOS Safari 26) inside about 150 MiB by producing a half-size linear working copy and tiles; apply one exposure change through our own WebGPU shader with a WebGL2 fallback; measure time and memory. If the X-E5 is not in its parity list or the carve-out fights, test LibRaw 0.22 as wasm (LGPL-2.1 or CDDL) the same way. The spike's report fixes the engine.
- The engine API, whichever wins: `decode(file) → {meta, preview, working, tiles(n)}` and `render(recipe, tile) → pixels`; the shell and shaders are ours.

## 6. Steps (one PR each, the loop as run on 2026-11-04)
1. **P0 spike**: the engine proof on a real X-E5 RAF (the owner supplies one invented-content file, or we use a public sample).
2. **P1a shelf and store**: the `photos` area in Core, the Drive upload path and reconciliation, the shelf by day with embedded previews, import, delete, Recently deleted, Settings › Photos.
3. **P1b the renderer and Light/Color/Effects/Detail**: the engine in the app, the GPU pipeline, the panels with their controls, before/after, histogram, the recipe saved as you move.
4. **P1c crop, optics, versions, copy recipe, export**: the rest of the editor and the export path with XMP.
5. **P1d the camera look and the mind**: the Fujifilm look match, senses, `th photos week`, the skill, the look card, the growth line.
6. **P2a masks**: the model on the phone, gradients, brush, ranges, per-mask adjustments.
7. **P2b looks and culling**: saved looks with amount, compare two, filters, batch export.

Owner steps: a Google Cloud project with the Drive API enabled and one consent tap (gives the Worker its refresh token, stored as a secret); a sample X-E5 RAF for the spike; the four small decisions in the design page (mask model download, look cards default, previews in R2 or Drive, which Drive folder).

## 7. Risks and how they are held
- X-Trans demosaic quality and speed on a phone: the spike measures; a half-size working copy is the fallback for editing, full quality only on export.
- Memory: never the full float image; tiles; test on the oldest phone you own.
- LightCraft churn: pin a commit; keep the engine API small so swapping to LibRaw is one module.
- Drive tokens: short-lived, folder-scoped, refresh token only in the Worker; a revoked grant shows a plain line in Settings, nothing breaks.
- Colour accuracy versus the camera JPEG: say "close" not "identical"; show the camera's own JPEG as a comparison when the RAF carries one.
