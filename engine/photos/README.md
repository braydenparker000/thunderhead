# Photos' RAW engine

A small Rust crate built to WebAssembly for the Photos editor
([PHOTOS.md](../../docs/product/apps/PHOTOS.md), the editor): LightCraft's RAW decoders and colour maths
(`lightcraft-raw`, `lightcraft-color`, `lightcraft-raster`; MIT OR Apache-2.0) behind a small
wasm-bindgen API. The editor runs it in a Web Worker (`frontend/apps/photos/edit/engine-worker.js`).

- `src/lib.rs`: the API: `inputPtr`, `decode`, `decodeInput(streaming)` → `{width, height, camera,
  whiteBalance, previewJpeg, whiteXy, matrixIsFallback, …}`, `binned(sink)` (a RAF's half-size copy
  with no demosaic, in chunks to `sink`: the editor's first frame), `working(scale, sink?)` (planar f16
  linear Rec.2020, demosaiced at full resolution; in bands to `sink` when given), `tile(x, y, w, h)`,
  `freeWorking`, `memoryBytes`, `threads`, `initThreadPool(n)` (the threads build), and `setMatrix(m)`: a camera matrix
  from outside (the editor's fit from the camera's JPEG, `frontend/apps/photos/edit/fit.js`), the
  working copy re-expressed in it in place and later tiles made with it.
- `src/stream.rs`: RAF in streaming mode: the working copy and tiles from sensor column bands, never
  the whole mosaic, the stripes decoded one per thread.
- `src/binned.rs`: the binned half-size first frame (PHOTOS.md, the two-stage decode).
- `src/kernel.rs`: white balance, the camera matrix and LightCraft's demosaic on a window plus an
  8 px margin (bit-identical to its whole-image demosaic: `PHOTOS_RAF=<file> cargo test --release`).
- `patches/lightcraft-memory.diff`: our memory patches to LightCraft (compressed RAF stripes in
  batches; `raf_decode_header` and `raf_decode_columns` for streaming; `raf_stripes`, each stripe
  decoded on its own six rows at a time, for the parallel binned frame).

## The exact build

LightCraft is a git dependency pinned at `ae7ac42a109e3a18481c916d55516ed60535e49f`. Cargo cannot
apply a patch file, so `node scripts/photos-engine.mjs`:

1. clones LightCraft into `vendor/lightcraft` (ignored; `LIGHTCRAFT_GIT` may name a local mirror) and
   checks out the pinned commit;
2. applies `patches/lightcraft-memory.diff` there (the `[patch]` table in `Cargo.toml` points the git
   dependency at this checkout);
3. runs `cargo build --release --locked --target wasm32-unknown-unknown` (opt-level `s`, fat LTO,
   one codegen unit, `panic = "abort"`, JPEG XL for DNG on);
4. runs `wasm-bindgen --target web --no-typescript --out-name photos_engine` (0.2.129; `WASM_BINDGEN`
   may name the binary) into `frontend/photos/engine/`;
5. writes `engine/photos/build.json`: the commit, the patch's SHA-256, rustc and
   wasm-bindgen versions, and each file's size and SHA-256.

Built 2026-11-05 with rustc 1.97.0, twice: `photos_engine_bg.wasm` 2,289,856 bytes and
`threads/photos_engine_bg.wasm` 2,300,058 bytes (`+atomics,+bulk-memory,+mutable-globals`, std rebuilt
with `-Z build-std` through `RUSTC_BOOTSTRAP=1`, shared memory up to 1 GiB, wasm-bindgen-rayon 1.3.0
with `no-bundler`, whose worker script lands in `threads/snippets/`); the hashes are in `build.json`. `tests/photos-engine.test.mjs`
checks the hashes and decodes the public CC0 X-E5 sample from raw.pixls.us, downloaded at test time
(never committed). After a rebuild, set the engine line in `scripts/stage.mjs` to the new size.
