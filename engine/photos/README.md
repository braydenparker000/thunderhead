# Photos' RAW engine

A small Rust crate built to WebAssembly for the Photos editor
([PHOTOS.md](../../docs/product/apps/PHOTOS.md), the editor): LightCraft's RAW decoders and colour maths
(`lightcraft-raw`, `lightcraft-color`, `lightcraft-raster`; MIT OR Apache-2.0) behind a small
wasm-bindgen API. The editor runs it in a Web Worker (`frontend/apps/photos/edit/engine-worker.js`).

- `src/lib.rs`: the API: `inputPtr`, `decode`, `decodeInput(streaming)` → `{width, height, camera,
  whiteBalance, previewJpeg, whiteXy, matrixIsFallback, …}`, `working(scale)` (planar f16 linear
  Rec.2020), `tile(x, y, w, h)`, `freeWorking`, `memoryBytes`.
- `src/stream.rs`: RAF in streaming mode: the working copy and tiles from sensor column bands, never
  the whole mosaic.
- `src/kernel.rs`: white balance, the camera matrix and LightCraft's demosaic on a window plus an
  8 px margin (bit-identical to its whole-image demosaic: `PHOTOS_RAF=<file> cargo test --release`).
- `patches/lightcraft-memory.diff`: our two memory patches to LightCraft (compressed RAF stripes in
  batches; `raf_decode_header` and `raf_decode_columns` for streaming).

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

Built 2026-11-04 with rustc 1.97.0: `photos_engine_bg.wasm` 2,242,867 bytes (595 KB brotli), SHA-256
`def5e33720f0c80499154bbf7f688606ef85177ae7b7b09de587d1ddd3d9e08d`. `tests/photos-engine.test.mjs`
checks the hashes and decodes the public CC0 X-E5 sample from raw.pixls.us, downloaded at test time
(never committed). After a rebuild, set the engine line in `scripts/stage.mjs` to the new size.
