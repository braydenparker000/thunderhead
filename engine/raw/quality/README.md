# Measuring the demosaic

A way to say whether a change to full resolution (`frontend/lab/engine/demosaic.js`) is better, in numbers. Not
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
