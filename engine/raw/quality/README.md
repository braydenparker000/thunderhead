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

## The second look

What was still on the table above (Markesteijn's own choice of way, judged on all three colours) is in the engine
since 2026-11-11, as a second look over the first (`frontend/lab/engine/demosaic-again.js`): three of the four
greens at each red or blue site are made again the way Markesteijn's second pass makes them, but with the first
look's red and blue where he uses his own; the smoothest ways are then chosen by brightness and both colour
differences; red and blue follow the new green by the first look's ratio, a site's own colour by half.

Five 1024 × 1024 scenes at `K=3`, from four 40 MP X-Trans bodies (X-T5, X-H2, X100VI and the X-E5: the same
X-Trans CMOS 5 HR sensor; public-domain RAFs from raw.pixls.us and the owner's sample, none in the repository).
PSNR / green / colour, in dB:

| scene | the first look alone | with the second look | Markesteijn, 3 passes |
|---|---|---|---|
| flowers | 42.38 / 46.69 / 41.36 | 42.81 / 47.72 / 41.29 | 42.49 / 47.46 / 40.96 |
| roofs and solar panels | 38.83 / 41.21 / 38.62 | 39.31 / 42.59 / 38.66 | 39.37 / 41.89 / 38.02 |
| a cat's fur | 42.69 / 45.34 / 42.00 | 43.10 / 46.61 / 42.05 | 43.02 / 46.02 / 41.54 |
| a stone church | 36.05 / 36.85 / 36.83 | 37.27 / 39.23 / 37.10 | 36.18 / 37.54 / 35.05 |
| a tower against sky | 46.14 / 49.15 / 45.53 | 46.57 / 50.50 / 45.57 | 46.19 / 49.53 / 44.69 |

So: 0.4 to 1.2 dB overall and 1.0 to 2.4 dB of green over the first look; ahead of Markesteijn's three passes in
four scenes of five (0.06 dB behind on the roofs), ahead in green and in false colour in all five. With ISO 6400
noise laid on (`noisy.mjs`), before any noise reduction: roofs 35.08 to 35.04 (green +0.2), church 33.70 to 34.08
(green +1.0).

What was tried on the way and did not earn its place:

- Choosing the way by the greens alone a second time: nothing. The colour differences are what the choice needed.
- Eight greens (the first look's four and the four made again) against the four made again: a wash.
- A third look with the same ratios: changes nothing.
- Red and blue following the new green all the way at their own sites: the new green carries the site's own
  reading, so its noise went in twice (roofs at ISO 6400: 34.79). Keeping the site's own colour by half is best
  without noise and within 0.1 dB of best with it (`KEEP`).

Cost: the demosaic takes about twice as long (3.5 s to 7 to 8 s for 1024 × 1024 on the software GPU these numbers
come from; not yet timed on a phone) and holds 8 bytes a pixel more while it runs, with margins 6 pixels wider.

## Colour fringing

A lens draws red and blue a little larger or smaller than green (lateral chromatic aberration). The RAF's own lens
data says by how much: on the sample files 0.6 to 1 pixel over most of the frame for the X-E5's lens, 1.2 to 1.6 for
the X100VI's, 1.3 to 4 for one X-T5 zoom. The warp used to undo it after the demosaic. `fringe.mjs` lays it on a
known picture to measure that (`K=3`; PSNR / green / colour, dB):

| fringing | no fringing | undone after the demosaic (before) | undone in the demosaic (since 2026-11-11) |
|---|---|---|---|
| roofs, 0.5 px | 39.31 / 42.59 / 38.66 | 36.10 / 40.06 / 35.61 | 38.31 / 40.58 / 39.28 |
| roofs, 1 px | | 32.62 / 37.16 / 31.53 | 37.30 / 39.37 / 39.10 |
| roofs, 1.5 px | | 31.89 / 36.24 / 30.97 | 37.22 / 39.01 / 39.36 |
| roofs, 2.5 px | | | 37.23 / 38.91 / 38.90 |
| church, 0.5 px | 37.27 / 39.23 / 37.10 | 33.51 / 36.87 / 33.51 | 35.55 / 36.54 / 38.50 |
| church, 1 px | | | 34.31 / 35.33 / 38.68 |

Moving red and blue there and back alone costs almost nothing (0.5 px: 44.8 dB; a whole pixel: nothing), so the loss
was the demosaic comparing colours at the wrong places. Now (`demosaic.js` `lead`): red and blue sites are looked
for round where that colour of a pixel was recorded, each is weighed and compared with green at the place it
belongs to, the second look uses those aligned colours, and the warp leaves them alone. False colour comes back
whole; green stays about 2 to 3 dB under the picture without fringing. On a real X-T5 file the magenta and green
edges on a crane against the sky at the frame's left edge (2 to 4 px of fringing there) all but go.

Tried and dropped: fading the red and blue terms out of the first four greens where fringing is large (1 dB
worse: a misplaced colour still says more about green's detail than none). Not tried: a second round of the
colour pass with the final green, which may win back part of the green.

Cost: the demosaic takes about a third longer on a photo whose lens has fringing data (6.8 s to 9.1 s for 1024 ×
1024 on the software GPU).

### What else exists for this sensor (looked up 2026-11-11)

Nobody has published controlled numbers for demosaicing the 40 MP X-Trans sensor. What there is:

- **Markesteijn, 3 passes** is the open-source baseline (darktable and RawTherapee carry near-identical code).
  RawTherapee can mix it with a fast method in flat areas to hide noise; darktable's frequency-domain chroma
  (FDC) trades colour noise at high ISO for colour bleeding.
- **Neural demosaics** are where the next real step is. Adobe's Enhance Details and DxO's DeepPRIME XD are the
  commercial ones. Open ones in 2026 are small projects: one trained on about a hundred RAFs and licensed
  non-commercial, one trained on downscaled photos that zippers on X-Trans edges and needs about 3 GB at this
  size, one with no licence yet, and vkdt's own (a U-net for Bayer and X-Trans with weights to download). None
  states numbers against Markesteijn on this sensor. Taking one on would mean training or checking it on many
  more RAFs than the handful here, and judging it at 100 % on the phone: a project of its own.
- The sensor itself: 3.04 µm pixels and no low-pass filter, so at wide apertures real detail reaches the pixel
  and the demosaic matters; past about f/8 diffraction blurs what any method could tell apart.

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
