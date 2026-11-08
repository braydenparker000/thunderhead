# LightCraft in the browser (test page)

The whole LightCraft editor (https://github.com/storytold/lightcraft, MIT OR Apache-2.0), as its own
browser build, served at `/lab/lightcraft/` so the owner can try it on their phone before Photos moves to
it (decisions.md, 2026-11-08). Step 1 of that plan: nothing links to the page yet, and the library lives
only in the phone's browser storage (no Drive, no backup yet).

- **Pinned** at the commit in `scripts/lightcraft-web.mjs` (`LIGHTCRAFT.rev`), recorded with the
  toolchain and every file's SHA-256 in `build.json`; `tests/lightcraft-lab.test.mjs` checks them.
- **Patched** (`patches/`, not offered upstream: owner, 2026-11-08): `web-clock.diff` reads the clock through `web_time` where LightCraft's RAW
  loader timed its hot-pixel pass with `std::time::Instant`, which panics on wasm32: at the pinned
  commit, opening any RAW in the browser ended the app.
- **Built** with `node scripts/lightcraft-web.mjs` (Rust with `wasm32-unknown-unknown`, wasm-bindgen-cli
  at LightCraft's locked version) into `frontend/lab/lightcraft/`; `--check` compares the committed files
  with `build.json`. Our `index.html`, `boot.js` and `lightcraft.css` there replace LightCraft's page,
  whose inline script and style our CSP refuses.
- **Threads** (`threads.diff`, `frontend/lab/lightcraft/worker.js`): LightCraft's decode and develop split their
  work with rayon, which runs on one thread in its browser build. A second build (`threads/`: atomics, shared
  memory up to 2 GiB, rayon on Web Workers through wasm-bindgen-rayon, Apache-2.0) runs in the render workers
  when the page is cross-origin isolated (our service worker gives `/lab/lightcraft/` COOP and COEP, as it does
  Photos' editor; SECURITY.md). The page itself keeps the plain build: WebGL, which draws its UI, refuses shared
  memory, and its exports and auto adjustments run on one thread (rayon falls back to the calling thread where
  threads can't start). Two render workers with half the cores each, at least two and at most four threads
  (`?workers=N` still overrides); without isolation, or if the pool doesn't start in 10 s, the plain build as
  before. Measured on a 4-core x86 VM with two threads a worker: 1:1 on the X-E5 sample 21.8 s → 12.9 s, no
  more memory.
- **Export on a phone** (`phone-export.diff`, `export-bands.diff`): the browser build downloads every export (a
  phone keeps it in Downloads), so the Export dialog's folder, subfolder and name-clash rows are one line, "Save
  to: Downloads", and an export with no folder goes there instead of being refused. An 8-bit export of 4 MP or
  more renders in bands of 768 rows with the loupe's margin of context (512 rows for 40 MP), reusing the source
  the first band decoded: the X-E5 sample's full-size JPEG matches the whole-frame render (mean difference
  0.0, largest 6 of 255, no seams) with 1,881 MiB of wasm instead of 3,792, in about twice the time. A 4,000 px
  export gains little (1,362 → 1,248 MiB): most of it is the full-size decode on the page itself; exporting
  from a render worker, which holds that decode already, is the next step.
- **Render status** (`frontend/lab/lightcraft/status.js`): a small line in the bottom corner says
  "Rendering… N s" once a render runs past two seconds, then how long it took, or the render failure or
  panic LightCraft logged, so a slow render on the phone can be told from a failed one.
- **Memory**: `node scripts/lightcraft-memory.mjs <file.RAF> [workers]` measures the steps below.
- **Desktop layout** (`desktop-layout.diff`): the UI lays out 980 points wide, the width Chrome's
  "Desktop site" uses, so the switch is never needed; `?width=N` tries another. A wide page viewport alone
  does not do it: eframe draws at the device's pixel density and sizes the UI from the canvas, so the
  patch sets egui's zoom from the canvas's pixel width (`globalThis.lightcraftLayoutWidth`, set by boot.js).
  On a touch screen the same patch widens egui's interact radius to 18 points (`globalThis.lightcraftTouchReach`):
  a press that close to a slider or button reaches it, without anything changing size or look.

## Measured (headless Chromium, 4-core x86, the CC0 X-E5 sample: 40 MP, 14-bit lossy, 4 render workers)

| Step | LightCraft's own wasm (main) | Whole page (renderer RSS) |
|---|---|---|
| Open, demo library | 173 MiB | ~580 MiB |
| RAF imported | 288 MiB | ~1.2 GiB |
| Detail, exposure drag (~0.5 s a step) | 288 MiB | ~1.3 GiB |
| 1:1 zoom | 387 MiB | ~2.0–2.4 GiB |
| Export JPEG, 4,000 px | 1,461 MiB (bands: 1,248) | ~3.2 GiB |
| Export JPEG, full size (7,728 × 5,152) | 3,807 MiB (bands: 1,881) | ~5.5 GiB (bands: ~4.0) |

wasm memory never shrinks, so the page stays at its highest step. Export develops the whole image at full
size on the page's own instance, so even a small export costs gigabytes, and a full-size one comes within
300 MiB of wasm32's 4 GiB ceiling. Step 2 of the plan (export in bands, a reduced source for smaller
exports, only the visible part at 1:1, fewer workers) is about these rows.
