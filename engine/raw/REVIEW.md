# The editor, reviewed (2026-11-11)

A talk with the owner, written down at their word, and the reading that followed: what people on the forums
say about developing raw files, what the science says is best, and how this editor compares. [STATUS.md](STATUS.md)
says what is built; this says how good it is and what would make it better.

## Where things stand with the owner

- The owner asked for no new work until it has been talked through.
- Agreed, not yet built: a reminder or a rule may go through in a session that has read the web when its words are
  the owner's own from the message it names (the two night-report options are in `docs/product/BRIEFING.md`).
- Agreed: the hot-pixel pull request's failed job (the runner could not reach Ubuntu's mirror) may be run again.
- Wanted: a testing page on the phone, so numbers come from the real device (below).
- The owner will try to bring a long exposure or high-ISO RAF and a Lightroom or Capture One export of a RAF.

## How it is built, the good and the bad

Decode (Rust, WebAssembly, every core) → an editing copy (each 3 × 3 block averaged, about 2576 × 1717) on which
every slider works, on the GPU, in linear light → full size only for what is looked at or exported (demosaic,
noise reduction, sharpening, the same colour pass) → export in strips. The edit is a list of settings.

Good: quality that is measured (demosaic, sharpening, noise reduction); a full set of tools; a design that suits
a 4 GB phone.

Bad, most serious first:

1. Photos and edits live only in the browser's storage on the phone: no backup, no Drive.
2. Almost nothing checks the picture automatically: a lab change runs three general tests; correctness is by hand.
3. Never timed or verified on the phone; a phone GPU driver could compute a slightly wrong picture unseen.
4. Sharpening and noise reduction show only at 100 % and in the export, not on the fitted photo.
5. RAF only: JPEGs still open in the old editor. Chrome with WebGPU only; not offline.
6. Colour depends on the owner's private Adobe profile files, kept in that same storage.
7. Dense code: shaders as text inside JavaScript, long lines.
8. Sliders not calibrated to Lightroom; no subject or sky masks; heal not content-aware.

## The testing page (wanted, not built)

One page opened on the phone, one tap: timings of each stage on a real RAF (decode, first picture, a slider's
frame, a 100 % view, a full export); peak memory; and the harness's known scenes run on the phone's own GPU and
compared with reference numbers, so a wrong picture is caught. Results saved to the owner's Worker so runs can be
compared over time.

## What people say (26 forum threads, 14 technical pages)

Read: discuss.pixls.us (13 threads), fuji-x-forum.com (3), Adobe's community (2), DxO's forum (5), dprevived (1),
and articles from Luminous Landscape, Fuji Rumors and a Substack; RawTherapee's and darktable's manuals, Adobe's
and DxO's own descriptions of their denoisers, dcpTool's notes on Adobe profiles. **Not read:** Reddit (it refuses
both reading and search from here), DPReview and Fred Miranda (403). No thread anywhere gave a controlled test on
the 40 MP sensor.

- **Detail on X-Trans.** For ten years the complaint is Lightroom's default rendering: "worms", a watercolour look
  in foliage, mushy fine detail. People tie it to sharpening laid over Adobe's demosaic. The cures named are
  Capture One, DxO, Iridient X-Transformer, or Lightroom's Enhance. One X-T5 owner says the 40 MP sensor no longer
  shows worms in Lightroom; others still see them. Many say the differences only show at 100 % and above.
- **The open-source developers** (RawTherapee's and darktable's, on pixls.us): Markesteijn 3-pass is the best
  classical X-Trans demosaic; sharp demosaics leave line patterns in flat areas that sharpening then brings out,
  so they blend in a smoother demosaic there ("dual demosaic") and sharpen only above a contrast threshold;
  capture sharpening is deconvolution, in linear light, straight after the demosaic, low radius (0.5 to 0.8),
  about 8 rounds, and never stacked with a second deconvolution. RawTherapee with capture sharpening was judged
  equal to or better than Iridient by the user who started that comparison.
- **Noise.** The best-regarded results come from networks that demosaic and denoise the raw mosaic in one step
  (Adobe Denoise, DxO DeepPRIME; DxO's newest X-Trans one also corrects fringing, and claims three stops). Users'
  complaints about them: waxy skin, a pastel smear, invented texture, big files, slowness, and a strong GPU
  (Adobe suggests 8 GB).
- **Colour.** Two camps. Users mostly want the camera's film simulations; Capture One (which works with Fujifilm)
  is called closest, Adobe's profiles close but off in highlights and shadows. The darktable developers argue the
  technically right way is to keep tone and colour apart: a tone mapper that holds hue, desaturates bright
  saturated colours smoothly and brings out-of-range colours in (sigmoid, AgX), and profiles without Adobe's "hue
  twists" (colour that shifts with brightness, which most people nonetheless see as good colour). Lightroom's
  Highlights slider is blamed for hard lines in faces.
- **On a phone.** Lightroom on Android draws reports of slow and failing exports. Nobody reported on 40 MP files.

## Every step: ours, the best known, and how to get there

In the order a photo passes through. **Bold** steps are where ours is behind. Sizes: S one pull request,
M several, L a project of its own.

### The sensor's data

| # | Step | Ours | Best known |
|---|---|---|---|
| 1 | Read the file | rawler: lossless, all three Fuji encodings, every core | The same (a lossless read cannot be bettered) |
| 2 | Black and white levels | One black level (the file's, averaged), the file's white | A black level for each colour; some subtract a dark frame |
| 3 | Hot and dead pixels | Hot ones mended on the mosaic (`src/hot.rs`); dead ones not | Both, on the mosaic |
| 4 | Blown highlights | A clipped colour rebuilt from the unclipped ones (darktable's "inpaint opposed") | The same for small areas; segment-based or neural for large ones |
| **5** | Colour fringing | Undone after the demosaic, in the warp | Before the demosaic, or inside a network |
| 6 | Demosaic | Markesteijn's green chosen twice, vkdt's red and blue: at or above Markesteijn 3-pass, measured | Markesteijn 3-pass among classical; neural beyond (Adobe, DxO) |
| **7** | Flat and noisy areas | The same demosaic everywhere | A smoother demosaic blended in where contrast is low |
| **8** | Noise reduction | Classical, after the demosaic: colour by a guided fit, brightness by patches, by ISO | One network that demosaics and denoises the mosaic together |
| 9 | Capture sharpening | Richardson-Lucy, 8 rounds, linear brightness, noise held back | The same |

### Geometry

| # | Step | Ours | Best known |
|---|---|---|---|
| 10 | Lens distortion, dark corners | The lens's own numbers in the RAF (darktable's method) | The same (Lightroom and Capture One use the maker's data too) |
| 11 | Crop, straighten, perspective | One cubic resampling for all of it and the lens together | The same: resample once. Plus an automatic upright, which ours lacks |

### Colour and tone

| # | Step | Ours | Best known |
|---|---|---|---|
| 12 | White balance | As shot, presets, eyedropper, Temp and Tint by the DNG maths; no Auto (three methods measured worse than as shot) | The same, plus a learned Auto |
| **13** | The camera's colour | Adobe's profile files (the owner's own, private): two lights, a hue and saturation table, a look table | For the camera's look: fitted to the camera's own JPEGs. For accuracy: measured from a chart |
| 14 | Exposure | A plain gain in linear light; DR200 and DR400 allowed for | The same |
| 15 | Highlights, Shadows, Whites, Blacks | By area: a guided filter on log brightness (darktable's tone equalizer idea) | The same family; strengths not yet matched to Lightroom's |
| 16 | Tone curve | Adobe's hue-preserving curve, the profile's own or Camera Raw's default | The same if Lightroom is the aim; AgX or sigmoid if smooth, hue-stable highlights are |
| 17 | Clarity, Texture, Dehaze | Local contrast against the same area masks; dark-channel dehaze | Local Laplacian pyramids; the same dehaze. Close; halos unmeasured |
| 18 | Saturation, Vibrance, mixer, grading | In Oklab, skin protected, baked into one table | The same (a perceptual space) |
| 19 | Looks | `.cube` tables, Adobe's looks, edits saved as looks | Also `.xmp` presets and camera recipes |
| **20** | Masks | Brush, linear, radial, colour range, brightness range | Also subject, sky and people found by a model |
| **21** | Heal and remove | A source patch fitted to the surroundings | Seamless (Poisson) blending; content-aware or generative remove |

### Output

| # | Step | Ours | Best known |
|---|---|---|---|
| **22** | Colours too strong for the screen | Clipped, as Lightroom does | Brought into range smoothly |
| 23 | Resize | Area average in linear light | The same |
| 24 | Output sharpening | Screen or Print, three amounts, after the resize | The same |
| **25** | Colour space and depth | sRGB only; 8 bits dithered, or 16-bit TIFF | Also Display P3 with a profile embedded; HDR output for phone screens |
| 26 | JPEG | Full colour resolution from quality 90, standard tables | A smarter encoder (jpegli): smaller files at the same quality |

### Around it

| # | Step | Ours | Best known |
|---|---|---|---|
| **27** | What is seen while editing | A 3 × 3 copy; sharpening and noise reduction only at 100 % and in the export | An approximation of both at every zoom |
| **28** | Proof it is right | A harness run by hand, on a software GPU | Reference pictures checked on every change, and on the real device |
| **29** | Keeping the photos | On the phone only | Backed up |

### How to get there

- **5, fringing first (M).** Give red and blue their corrected places while the demosaic makes them, so it never
  sees misaligned colours. Lay fringing on the harness's known picture first and measure what it is worth.
- **7, flat areas (S).** Where local contrast is low, take the plain mean of the four greens. Measure at ISO 6400.
- **8, noise (L).** A small network that takes the mosaic and gives the picture, trained as DxO trains: clean
  pictures (the harness's known ones, from public-domain RAFs) with our sensor noise model laid on. Run in tiles
  on the phone's GPU as a one-off action. It will not match DxO, which reports about three years of H100 time on
  its newest; a stop or more over ours is a fair hope. Until then: a second, coarser scale for colour noise (M).
- **13, the camera's colour (M, needs the owner for an afternoon).** About thirty varied scenes; the camera
  re-renders each RAF as a JPEG in every simulation; fit a table per simulation and check it on scenes held back.
  Ends the dependence on the private Adobe files.
- **15 and 17, strengths (S once the exports exist).** Fit each slider to the owner's Lightroom exports made at
  known settings. A halo test on made-up edges can be done now.
- **16, highlights (S to M, only if wanted).** An option that fades bright saturated colours towards white the
  way AgX does. It leaves Lightroom's look, so it is a choice, not a fix.
- **20, found masks (L, the owner's decision).** A segmentation model of some tens of megabytes, fetched once.
- **21, heal (M then L).** Poisson blending first; a remove model after.
- **22, strong colours (S).** Compress towards the screen's range before the last matrix; check on neon and flowers.
- **25, P3 (S to M) and HDR (L).** Embed a profile and draw on a P3 canvas; an HDR gain map is its own piece.
- **27, the fitted view (M).** Show noise reduction and sharpening from 50 % up, approximated from the copy.
- **28, proof (M).** The testing page on the phone, and made-up mosaics rendered and compared in CI on every change.
- **29, backup (M, the owner's decision on where).** Edits are small; originals that came from Drive are there already.
- Small ones: 2 a black level for each colour, 3 dead pixels, 4 large blown areas, 11 upright, 12 Auto, 19 `.xmp`,
  26 jpegli. None changes a picture much.

## The road map

The owner uses Adobe Color, so film simulations fitted to the camera matter little (measured earlier: Adobe's
matching profiles sit 2.6 to 3.3 ΔE from the camera's JPEGs; a fit might reach 1 to 2) and went to the end of the
list. The whole road, with the features added on the way, is [ROADMAP.md](ROADMAP.md).

## Sources

- pixls.us: [Markesteijn 3 artifacts](https://discuss.pixls.us/t/x-trans-demosaic-markesteijn-3-artifacts/14427),
  [Iridient vs Markesteijn](https://discuss.pixls.us/t/iridient-vs-markenstijn-demosaicing/16923),
  [choosing a demosaic](https://discuss.pixls.us/t/how-to-choose-a-demosaicing-algorithm/30556),
  [sharpening workflow](https://discuss.pixls.us/t/my-sharpening-workflow-for-base-iso-mages-with-the-new-features-in-rt-aka-extreme-pixel-peeping/8034),
  [neural demosaic for X-Trans](https://discuss.pixls.us/t/fast-neural-demosaic-for-x-trans/58588),
  [filmic vs AgX](https://discuss.pixls.us/t/compare-and-contrast-filmic-rgb-vs-agx/53147),
  [darktable vs Lightroom](https://discuss.pixls.us/t/interesting-differences-in-darktable-vs-lightroom/55709)
- Fuji X Forum: [X-T5 converter](https://www.fuji-x-forum.com/topic/33517-xt5-raf-raw-converter),
  [Capture One or Lightroom](https://www.fuji-x-forum.com/topic/33693-considering-capture-one-or-lightroom/),
  [Lightroom for X-Trans](https://www.fuji-x-forum.com/topic/5181-lightroom-for-x-trans-seriously/)
- Adobe: [improved X-Trans support](https://community.adobe.com/questions-675/p-improved-fuji-x-trans-support-978212),
  [Denoise demystified](https://blog.adobe.com/en/publish/2023/04/18/denoise-demystified)
- DxO: [XD3 X-Trans vs XD](https://forum.dxo.com/t/deepprime-xd3-x-trans-vs-deepprime-xd/53333),
  [Capture One vs PhotoLab](https://forum.dxo.com/t/capture-one-vs-pl-fuji-x-trans/30265),
  [DeepPRIME XD3](https://www.dxo.com/news/deepprime-xd3-fourth-generation/)
- Manuals: [RawTherapee's pipeline](https://rawpedia.pixls.us/toolchain_pipeline/),
  [capture sharpening](https://rawpedia.pixls.us/capture_sharpening/),
  [darktable's demosaic](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/demosaic/),
  [AgX](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/agx/),
  [dcpTool on hue twists](https://dcptool.sourceforge.net/Hue%20Twists.html)
