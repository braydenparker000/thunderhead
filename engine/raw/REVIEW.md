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

## Against ours

| Stage | Best known | Ours | Gap |
|---|---|---|---|
| Hot pixels, levels | Done on the mosaic, first | The same (`src/hot.rs`) | None |
| Fringing (lateral CA) | Before the demosaic, or inside the network | After the demosaic, in the warp | Small; larger at frame edges with strong CA |
| Demosaic, low ISO | Markesteijn 3-pass among classical; neural beyond | Measured at or above Markesteijn 3-pass | None among classical; unproven against Capture One and DxO |
| Demosaic, flat or noisy areas | Blended with a smoother method | Not blended | Unmeasured: look for line patterns after sharpening |
| Capture sharpening | Deconvolution, linear, after demosaic, ~8 rounds, masked | The same (`deconv.js`) | None |
| Noise, high ISO | Joint neural demosaic and denoise | Classical, after the demosaic | The largest gap; two to three stops by the makers' claims |
| Lens corrections | The maker's own data in the file | The same (`lens.js`) | None |
| Colour model | Camp one: match the camera. Camp two: hue-stable tone mapping | Adobe's model exactly: its profiles, twists and hue-preserving curve | Matches Lightroom, flaws included; not fitted to the camera's own JPEGs |
| Saturated colours | Brought into range smoothly | Clipped at output, as Lightroom does | Small; shows on neon, flowers, stage lights |
| Working light | Linear until the tone curve | The same (linear ProPhoto) | None |

So: at low ISO the pipeline is built the way the best classical ones are, step for step. It is behind the
commercial best in one large way (noise at high ISO) and unproven in one (detail against Capture One and DxO,
which needs the owner's exports). Its colour is Lightroom's, by choice.

## What would close the gaps, by worth

1. **The testing page**, since every number here is from a software GPU.
2. **Film simulations fitted to the owner's camera** (the camera re-renders a RAF in every simulation; fit a table
   per simulation): truer to the camera than Adobe's or Capture One's, and no more private Adobe files.
3. **A worm check**: foliage at Sharpening 40 to 100, looked at and scored; a dual demosaic if patterns show.
4. **Fringing before the demosaic**, measured with the harness first.
5. **Saturated colours brought into range** at output.
6. **Neural noise reduction** as a one-off action on a photo: the largest gain and by far the largest job; needs
   many high-ISO RAFs, and minutes a photo on the phone.

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
