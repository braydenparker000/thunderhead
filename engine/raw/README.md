# engine/raw

The new photo engine's RAW stage ([ENGINE-RESEARCH.md](../../docs/engineering/ENGINE-RESEARCH.md)):
[rawler](https://github.com/dnglab/dnglab) (LGPL-2.1) opens the RAF in all three Fujifilm encodings, and
this crate hands the browser the metadata the colour pipeline needs and the editing proxy, each 3 x 3
X-Trans cell averaged per colour (2576 x 1717 for a 40 MP frame, no demosaic).

For the highlight rebuild (after darktable's "inpaint opposed"), the proxy's alpha says which of a pixel's
colours had a clipped sensel (bits 0 to 2: R, G, B; clipped is within 3 % of the white level, since this
sensor's blue stops about 2 % short of it), and the metadata's `chroma` is how far the photo's own colours
sit from the rebuild's estimate, measured on the unclipped pixels beside the clipped ones.

For 100 % and export, `mosaic()` hands over the sensor's own pixels (one 16-bit value a pixel, the black level
still on, cropped to whole cells so it lines up with the proxy three to one), and the metadata says where black
and white are and how the X-Trans pattern lies (`black`, `white`, `cfa`, `cfaWidth`, `fullWidth`, `fullHeight`).
The page demosaics only what is looked at, on the GPU (`frontend/lab/engine/demosaic.js`: green as Markesteijn's
method makes it, after darktable's code, GPL 3; red and blue after vkdt's, BSD 2-clause). `quality/` measures it.

Before anything is made from the sensor data, hot sensels are mended (`src/hot.rs`): a site that reads at least
three times every site of its colour within two of it, clear of noise, while the sites touching it are not lifted
with it (a lens spreads a real point of light onto its neighbours; a hot sensel stands alone). It takes the mean
of those same-colour sites. The metadata's `hot` says how many. Cautious on purpose: on nine 40 MP X-Trans photos
it changes nothing; of sensels planted 3 to 50 % of the range above a photo it mends 60 to 80 %, and those it
leaves sit on bright ground. `cargo test` holds it to that on a made-up mosaic (a hot sensel, a star, a plain field).

For export, `jpeg()` encodes one band of a JPEG with [jpeg-encoder](https://github.com/vstroebel/jpeg-encoder)
(MIT or Apache-2.0, and the IJG licence). Every band shares its tables, so the page joins the bands' scans with
restart markers into one file (`frontend/lab/engine/files.js`) and a 40 MP photo is never held whole.

Build (writes `frontend/lab/engine/pkg/`):

    cargo build --release --target wasm32-unknown-unknown --lib
    wasm-bindgen --target web --no-typescript --out-dir ../../frontend/lab/engine/pkg target/wasm32-unknown-unknown/release/th_raw.wasm

The threads build (writes `frontend/lab/engine/pkg-threads/`; nightly Rust with `rust-src`): rawler decodes
the RAF's strips with rayon, here on Web Workers through wasm-bindgen-rayon (Apache-2.0/MIT), and the proxy
bins its rows the same way. The decode worker loads it when the page is cross-origin isolated (our service
worker gives `/lab/engine/` COOP and COEP), else the one-thread build.

    RUSTFLAGS='-C target-feature=+atomics,+bulk-memory,+mutable-globals -C link-arg=--shared-memory -C link-arg=--import-memory -C link-arg=--max-memory=2147483648 -C link-arg=--export=__wasm_init_tls -C link-arg=--export=__tls_size -C link-arg=--export=__tls_align -C link-arg=--export=__tls_base' \
      cargo +nightly build -Z build-std=std,panic_abort --release --target wasm32-unknown-unknown --lib --features threads
    wasm-bindgen --target web --no-typescript --out-dir ../../frontend/lab/engine/pkg-threads target/wasm32-unknown-unknown/release/th_raw.wasm

Measured on the X-H2 lossless sample (4-core x86 VM): native 1.5 s on one thread, 0.5 s on four; in Chrome
2.1 s on one, 1.2 s on four. The clip flags and `chroma` add about 4 % on one thread.

Time it natively: `cargo run --release --example time -- file.RAF`. Public test RAFs from the same
40 MP sensor (CC0): raw.pixls.us, Fujifilm X-H2 (all three encodings), X-T5, X100VI.
