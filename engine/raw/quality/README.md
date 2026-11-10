# Measuring full resolution

A way to say whether a change to full resolution (the demosaic, `frontend/lab/engine/demosaic.js`, and noise
reduction, `denoise.js`) is better, in numbers. Not
part of the site and not run by Test: run it by hand, with a RAF of your own (none is in the repository).

The idea: make a picture whose every colour is known at every pixel, lay it out as an X-Trans mosaic again (keep
one colour a pixel, as the sensor would), demosaic that, and compare with the picture.

- The **known picture** is a crop of a real RAF demosaiced at full size and then averaged 6 × 6: each colour is
  centred on the same place and the demosaic's own errors are mostly averaged away. (Binning the mosaic 3 × 3
  without a demosaic does not work: red and blue sites sit off-centre in a block, so their "truth" is shifted.)
- **PSNR** is on white-balanced, gamma 2.2 values, 24 pixels in from the edge. **colour** is the PSNR of red minus
  green and blue minus green: false colour shows there.

```bash
node engine/raw/quality/crop.mjs photo.RAF /tmp/q/a.bin 2400 1200 3072 3072   # a crop of the mosaic (x, y, w, h)
node engine/raw/quality/score.mjs /tmp/q/a.bin                                # the reference's scores; writes a.remade.f32
node scripts/serve.mjs &                                                      # the site, for the engine's shader
node engine/raw/quality/engine.cjs /tmp/q/a.bin                               # the engine's demosaic on a.remade.f32 -> a.gpu.f32
node engine/raw/quality/score.mjs /tmp/q/a.bin /tmp/q/a.gpu.f32               # reference and engine side by side
node engine/raw/quality/sites.mjs /tmp/q/a.bin /tmp/q/a.gpu.f32               # the error by kind of site
```

`markesteijn.mjs` is the reference: Frank Markesteijn's method (1 or 3 passes), ported plainly from darktable's
`src/iop/demosaicing/xtrans.c` (GPL 3; from dcraw 9.20), the whole image as one tile. It must be given
white-balanced values (`score.mjs` does): it works on colour differences. Its sixth argument makes green only,
chosen by the greens alone: the engine's green is that, and should score within a few hundredths of a dB of it.

What it said on 2026-11-10 (two crops: roofs and solar panels; a stone church):

| | PSNR | green | colour |
|---|---|---|---|
| vkdt's demosaic, as the engine had it | 33.3, 31.8 dB | 34.3, 32.3 | 36.0, 35.1 |
| Markesteijn, 3 passes | 35.8, 34.0 | 37.9, 35.2 | 34.6, 33.0 |
| the engine now: Markesteijn's green (one pass, chosen by the greens alone), vkdt's red and blue | 35.2, 33.7 | 37.2, 34.6 | 36.8, 36.3 |

Still on the table: Markesteijn's three-pass green (about 0.6 dB more green; it needs red and blue made four ways
first), and keeping each red and blue site's own reading (about 1 dB more PSNR, about 0.7 dB less on colour).

## Noise reduction

The same known picture, with the sensor's own noise laid on its mosaic as it would be at an ISO (`noisy.mjs`, from
the engine's profile in `noise.js`), then the engine's demosaic and noise reduction, scored against the clean
picture. `K=3` (every script reads it) makes the known picture from 3 × 3 averages: softer, more like a real
photo at 100 % than the default 6 × 6, which is all pixel-sized detail and very hard on any denoiser.

```bash
export K=3
node engine/raw/quality/score.mjs /tmp/q/a.bin                                   # the known picture and its mosaic, at this K
node engine/raw/quality/noisy.mjs /tmp/q/a.bin 6400                              # -> a.iso6400.f32
ISO=6400 node engine/raw/quality/engine.cjs /tmp/q/a.bin                         # demosaic only -> a.iso6400.n0c0.f32
ISO=6400 NOISE=100 COLOUR=25 node engine/raw/quality/engine.cjs /tmp/q/a.bin     # the sliders at 100 and 25 -> a.iso6400.n100c25.f32
node engine/raw/quality/nlm.mjs /tmp/q/a.bin 6400 /tmp/q/a.iso6400.n0c0.f32 /tmp/q/a.nlm.f32 1.6 4   # a reference: non-local means
node engine/raw/quality/score.mjs /tmp/q/a.bin /tmp/q/a.iso6400.n0c0.f32 /tmp/q/a.iso6400.n100c25.f32 /tmp/q/a.nlm.f32
```

What it said on 2026-11-10 (the roofs crop, ISO 6400, `K=3`; without noise the demosaic scores 36.9 dB):

| | PSNR | green | colour |
|---|---|---|---|
| no noise reduction | 34.0 dB | 36.4 | 35.3 |
| Noise 0, Color noise 25 (how a photo opens) | 34.2 | 36.5 | 36.0 |
| Noise 50, Color noise 25 | 35.0 | 37.1 | 36.9 |
| Noise 100, Color noise 25 | 35.1 | 36.9 | 37.2 |
| Noise 100, Color noise 50 | 34.8 | 36.9 | 36.5 |
| non-local means (15 × 15 search, 5 × 5 patches), its best setting | 34.9 | 37.8 | 35.2 |

Read: the engine's colour noise reduction (the guided filter) is good and should stay; past 25 it starts to cost
real colour. Its brightness step (two rounds of an edge-stopping blur) is the weak part: non-local means finds
about 0.9 dB more green from the same data. The next change to try is a patch-based or wavelet brightness step
under the same colour step; how heavy it may be is the phone's to say (a 15 × 15 search is over a thousand reads
a pixel).
