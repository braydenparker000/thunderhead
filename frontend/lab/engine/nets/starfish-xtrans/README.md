# The X-Trans network of Starfish

A network that makes full colour from an X-Trans sensor's pixels and takes the noise out in the same step
(joint demosaicing and denoising after Gharbi et al., "Deep Joint Demosaicking and Denoising", 2016, with a
filter bank for each place in the 6 × 6 pattern at its full-size last stage). It is the work of the Starfish
contributors: <https://github.com/monkeypangit/starfish>, taken at commit `b43b610`, from
`training/xtrans_wgpu/`. Licensed under either of the MIT licence or the Apache Licence 2.0 (`LICENSE-MIT.txt`,
`LICENSE-APACHE.txt`, both kept here). Its weights were trained by its authors on DIV2K.

Nothing here is changed but the two licence files' names. `f16/` and `f32/` are the same network exported for a GPU with half floats and for
one without: `graph.txt` lists the buffers and the passes, each `.wgsl` is one pass, `weights.bin` the weights.
`../../neural.js` reads the graph and runs it as the editor's demosaic stage.

Measured against known pictures laid out as X-Trans mosaics (engine/raw/ROADMAP.md): about 1.2 dB truer than
the editor's own demosaic on clean pictures, and 1.1 to 1.4 dB truer than it with its noise reduction from
ISO 3200 to 12800.
