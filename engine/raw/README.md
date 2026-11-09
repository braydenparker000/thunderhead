# engine/raw

The new photo engine's RAW stage ([ENGINE-RESEARCH.md](../../docs/engineering/ENGINE-RESEARCH.md)):
[rawler](https://github.com/dnglab/dnglab) (LGPL-2.1) opens the RAF in all three Fujifilm encodings, and
this crate hands the browser the metadata the colour pipeline needs and the editing proxy, each 3 x 3
X-Trans cell averaged per colour (2576 x 1717 for a 40 MP frame, no demosaic).

Build (writes `frontend/lab/engine/pkg/`):

    cargo build --release --target wasm32-unknown-unknown --lib
    wasm-bindgen --target web --no-typescript --out-dir ../../frontend/lab/engine/pkg target/wasm32-unknown-unknown/release/th_raw.wasm

Time it natively: `cargo run --release --example time -- file.RAF`. Public test RAFs from the same
40 MP sensor (CC0): raw.pixls.us, Fujifilm X-H2 (all three encodings), X-T5, X100VI.
