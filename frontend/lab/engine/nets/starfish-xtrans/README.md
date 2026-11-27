# The X-Trans network of Starfish

A network that makes full colour from an X-Trans sensor's pixels and takes the noise out in the same step
(joint demosaicing and denoising after Gharbi et al., "Deep Joint Demosaicking and Denoising", 2016, with a
filter bank for each place in the 6 × 6 pattern at its full-size last stage). It is the work of the Starfish
contributors: <https://github.com/monkeypangit/starfish>, taken at commit `98830e1` (v0.2.0), from
`models/xtrans_wgpu/`. Licensed under either of the MIT licence or the Apache Licence 2.0 (`LICENSE-MIT.txt`,
`LICENSE-APACHE.txt`, both kept here). Its weights were trained by its authors on DIV2K + Flickr2K.

Nothing here is changed but the two licence files' names. `f16/` and `f32/` are the same network exported for a GPU with half floats and for
one without: `graph.txt` lists the buffers and the passes, each `.wgsl` is one pass, `weights.bin` the weights.
`../../neural.js` (and `../../net-wino.js` for strip-sliced HWC4 Winograd F(2x2, 3x3) execution) reads the graph and runs it as the editor's demosaic stage.

Measured against known pictures laid out as X-Trans mosaics (engine/raw/ROADMAP.md): +3.26 dB truer than v0.1
(+4.98 dB green, +4.18 dB colour) on clean pictures, and +2.62 dB truer at ISO 3200, at 38 % smaller weights.
