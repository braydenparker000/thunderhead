# engine/raw

The new photo engine's RAW stage ([ENGINE-RESEARCH.md](../../docs/engineering/ENGINE-RESEARCH.md)):
[rawler](https://github.com/dnglab/dnglab) (LGPL-2.1) opens the RAF in all three Fujifilm encodings, and
this crate hands the browser the metadata the colour pipeline needs and the editing proxy, each 3 x 3
X-Trans cell averaged per colour (2576 x 1717 for a 40 MP frame, no demosaic).

For the highlight rebuild (after darktable's "inpaint opposed"), the proxy's alpha says which of a pixel's
colours had a clipped sensel (bits 0 to 2: R, G, B; clipped is within 3 % of the white level, since this
sensor's blue stops about 2 % short of it), and the metadata's `chroma` is how far the photo's own colours
sit from the rebuild's estimate, measured on the unclipped pixels beside the clipped ones.

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
