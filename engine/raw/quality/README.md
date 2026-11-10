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

What it said on 2026-11-10 (two crops: roofs and solar panels; a stone church), on the 6 × 6 picture:

| | PSNR | green | colour |
|---|---|---|---|
| vkdt's demosaic, as the engine had it | 33.3, 31.8 dB | 34.3, 32.3 | 36.0, 35.1 |
| Markesteijn, 3 passes (the port here) | 35.8, 34.0 | 37.9, 35.2 | 34.6, 33.0 |
| Markesteijn's green chosen by the greens alone, vkdt's red and blue | 35.2, 33.7 | 37.2, 34.6 | 36.8, 36.3 |
| the same, each red and blue site trusting its own reading by half (the engine now) | 35.8, 34.3 | 37.2, 34.6 | 36.7, 35.7 |

## Against darktable's own code

`dng.mjs` writes a harness mosaic as a DNG (`node dng.mjs <crop.bin> <crop>.remade.f32 out.dng`), which darktable
opens: `darktable-cli out.dng out.tif --icc-type LIN_REC2020 --apply-custom-presets false --core --conf
plugins/darkroom/workflow=none --conf plugins/imageio/format/tiff/bpp=16`. Its TIFF is in its own colour space,
so a 3 × 3 matrix fitted against the known picture carries it back before scoring (a few lines of numpy:
least squares of the picture on the TIFF's linear values, then `score.mjs` on the result). darktable 4.6.1 on the
roofs crop at `K=3`: PSNR 38.1 dB, green 40.7, colour 37.0. The engine on the same file: 37.5, 39.9, 37.6. So
darktable's demosaic is ahead by 0.6 dB overall, all of it green (its 3-pass Markesteijn chooses a way by all three
colours); the engine has the less false colour. RawTherapee 5.10 does not read this DNG's X-Trans pattern
correctly (a magenta, patterned picture at every offset tried), so it has not been scored.

Still on the table: Markesteijn's own choice of way (red and blue made four ways first, then the smoothest judged on
all three colours): about 0.5 to 0.8 dB more green.

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

Read then: the colour step was good; the brightness step (two rounds of a blur that weighed a neighbour by its
own brightness against the pixel's) was the weak part.

Since then the brightness step weighs a neighbour by the 3 × 3 patch round it against the patch round the pixel
(`luma.mjs` is where it was tried first; its `steps` method). The same table now, with the engine's demosaic as it
is now (36.9 became 37.5 without noise):

| | PSNR | green | colour |
|---|---|---|---|
| no noise reduction | 34.4 dB | 36.5 | 35.7 |
| Noise 50, Color noise 25 | 35.5 | 37.6 | 36.9 |
| Noise 100, Color noise 25 | 35.8 | 37.9 | 37.1 |
| the old brightness step at 100, 25, on the same demosaic | 35.4 | 37.1 | 37.3 |

At ISO 800, 3200 and 12800, Noise 100 gains 0.3, 0.9 and 1.9 dB over none and never loses, so a photo not opened
before starts with Noise by its ISO (0 to ISO 400, 20 at 800, 40 from 1600; `session.js` `noiseStart`).

## Sharpening

`BLUR=0.8 node score.mjs <crop.bin>` makes the mosaic from the picture blurred as a lens would (a Gaussian of that
sigma) and still scores against the sharp picture: what sharpening has to win back. `sharp.mjs` holds the unsharp
mask as the engine had it and Richardson and Lucy's deconvolution in plain code; `SHARP=40,1,25 node engine.cjs`
runs the engine's own (Sharpening, Radius, Detail as the plate shows them).

On the roofs crop, `K=3`, blurred by 0.8 of a pixel (32.4 dB unsharpened):

| | no noise | ISO 1600, Noise 40 |
|---|---|---|
| unsharpened | 32.4 dB | 32.1 |
| the unsharp mask, its best amount | 33.4 | 32.7 |
| the engine now, as a photo opens (it takes the spread to be 0.7) | 34.9 | 34.1 |
| the engine now, Radius 1.15 (the spread it really was) | 35.4 | 34.5 |

## Heal

`node heal.mjs <crop.bin>` places 300 spots at random on the known picture, each healed from a source 2.4 radii
away, and compares the smoothed result with what is really there. Letting the correction bend to third order (a
saddle and a three-fold bend on top of the level and tilt) lowers the error at a spot's rim by 6 % (0.308 to 0.289
stops on the roofs crop, where random spots land on edges and no correction can be right).
