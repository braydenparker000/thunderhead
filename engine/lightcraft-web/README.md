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
- **Desktop layout** (`desktop-layout.diff`): the UI lays out 980 points wide, the width Chrome's
  "Desktop site" uses, so the switch is never needed; `?width=N` tries another. A wide page viewport alone
  does not do it: eframe draws at the device's pixel density and sizes the UI from the canvas, so the
  patch sets egui's zoom from the canvas's pixel width (`globalThis.lightcraftLayoutWidth`, set by boot.js).

## Measured (headless Chromium, 4-core x86, the CC0 X-E5 sample: 40 MP, 14-bit lossy, 4 render workers)

| Step | LightCraft's own wasm (main) | Whole page (renderer RSS) |
|---|---|---|
| Open, demo library | 173 MiB | ~580 MiB |
| RAF imported | 288 MiB | ~1.2 GiB |
| Detail, exposure drag (~0.5 s a step) | 288 MiB | ~1.3 GiB |
| 1:1 zoom | 387 MiB | ~2.0–2.4 GiB |
| Export JPEG, 4,000 px | 1,461 MiB | ~3.2 GiB |
| Export JPEG, full size (7,728 × 5,152) | 3,807 MiB | ~5.5 GiB |

wasm memory never shrinks, so the page stays at its highest step. Export develops the whole image at full
size on the page's own instance, so even a small export costs gigabytes, and a full-size one comes within
300 MiB of wasm32's 4 GiB ceiling. Step 2 of the plan (export in bands, a reduced source for smaller
exports, only the visible part at 1:1, fewer workers) is about these rows.
