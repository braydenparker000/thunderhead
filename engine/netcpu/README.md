# The network on the CPU

`src/lib.rs` is the X-Trans network's layers for a phone's CPU, written in WebAssembly's vector maths: a 3 x 3
convolution (`conv3`, and `conv3r` on a strip of a window with a ring of its neighbours' rows), a 1 x 1 (`conv1r`)
and the full-size head (`head`), all with the leaky ReLU the network uses. An export by the network hands some of
its windows to the CPU's cores while the GPU makes the others (`frontend/lab/engine/net-cpu.js`,
`net-cpu-worker.js`, `export.js`): measured on the owner's 4 GB phone, the two at once get through 1.74 times what
the GPU does alone. `conv3` alone is still what the engine test page times (`cpu-bench.js`, `net-both.js`).

Two builds of the one source, both committed (the site has no build step):

    RUSTFLAGS="-C target-feature=+simd128" cargo build --release --target wasm32-unknown-unknown
    cp target/wasm32-unknown-unknown/release/th_netcpu.wasm ../../frontend/lab/engine/cpu/conv.wasm
    RUSTFLAGS="-C target-feature=+simd128,+relaxed-simd" cargo build --release --target wasm32-unknown-unknown
    cp target/wasm32-unknown-unknown/release/th_netcpu.wasm ../../frontend/lab/engine/cpu/conv-fused.wasm

`conv.wasm` multiplies and adds; `conv-fused.wasm` uses the relaxed vectors' fused multiply-add, which a
browser may not have (the page tries it and says). `tests/lab-engine-cpu.test.mjs` runs both against the same
sum written plainly.
