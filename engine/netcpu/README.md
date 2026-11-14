# The network's heavy pass for the CPU

`src/lib.rs` is one 3 x 3 convolution with a leaky ReLU, shaped like the network's two heaviest passes
(`frontend/lab/engine/nets/starfish-xtrans/`: 288 channels in, 144 out), written for a phone's CPU in
WebAssembly's vector maths. It is here to be measured, not used: the engine test page (`/lab/engine/`,
`cpu-bench.js`) runs it on one, two, four and all of the phone's cores beside the GPU's own time for the
same work, so whether the CPU is worth bringing in is a number from the phone, not a guess.

Two builds of the one source, both committed (the site has no build step):

    RUSTFLAGS="-C target-feature=+simd128" cargo build --release --target wasm32-unknown-unknown
    cp target/wasm32-unknown-unknown/release/th_netcpu.wasm ../../frontend/lab/engine/cpu/conv.wasm
    RUSTFLAGS="-C target-feature=+simd128,+relaxed-simd" cargo build --release --target wasm32-unknown-unknown
    cp target/wasm32-unknown-unknown/release/th_netcpu.wasm ../../frontend/lab/engine/cpu/conv-fused.wasm

`conv.wasm` multiplies and adds; `conv-fused.wasm` uses the relaxed vectors' fused multiply-add, which a
browser may not have (the page tries it and says). `tests/lab-engine-cpu.test.mjs` runs both against the same
sum written plainly.
