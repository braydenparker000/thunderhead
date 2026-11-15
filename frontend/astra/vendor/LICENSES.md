# Third-party code in this folder

Every file here is written by `node scripts/astra/vendor.mjs` from the npm
packages pinned in `vendor.json`, which also records each file's sha256
(`node scripts/astra/vendor.mjs --check` verifies them without the network).

## Mediabunny

Copied unmodified, except that the three decoder extensions import
`./mediabunny.js` instead of the bare name `mediabunny`.

| File | Package | Source |
| --- | --- | --- |
| `mediabunny.js` | mediabunny@1.66.0 (`dist/bundles/mediabunny.min.mjs`) | https://github.com/Vanilagy/mediabunny/tree/v1.66.0 |
| `mediabunny-ac3.js` | @mediabunny/ac3@1.66.0 (`dist/bundles/mediabunny-ac3.min.mjs`) | https://github.com/Vanilagy/mediabunny/tree/v1.66.0 |
| `mediabunny-dts.js` | @mediabunny/dts@1.66.0 (`dist/bundles/mediabunny-dts.min.mjs`) | https://github.com/Vanilagy/mediabunny/tree/v1.66.0 |
| `mediabunny-truehd.js` | @mediabunny/truehd@1.66.0 (`dist/bundles/mediabunny-truehd.min.mjs`) | https://github.com/Vanilagy/mediabunny/tree/v1.66.0 |

Copyright Vanilagy and contributors. The four packages are distributed under
the Mozilla Public License 2.0 (https://mozilla.org/MPL/2.0/); the source form
of every file is available at the addresses above and in the npm tarballs.

The AC-3/E-AC-3, DTS and TrueHD decoders contain WebAssembly builds of decoders from
FFmpeg (https://ffmpeg.org/), which FFmpeg distributes under the GNU Lesser
General Public License 2.1 or later. Their source and build scripts are in the
same upstream repository.

## hls.js and dash.js (`hls/`, `dash/`)

The players for adaptive streams, copied unmodified from their npm packages
and loaded only when an HLS or DASH stream is played. `engine/adaptive.js`
loads each with the same integrity hash that `vendor.json` pins (the files
are the ones the CDN used to serve).

| File | Package | Licence | Source |
| --- | --- | --- | --- |
| `hls/hls.min.js` | hls.js@1.6.13 (`dist/hls.min.js`) | Apache-2.0 (`hls/LICENSE.txt`). Copyright (c) 2017 Dailymotion | https://github.com/video-dev/hls.js/tree/v1.6.13 |
| `dash/dash.all.min.js` | dashjs@5.2.0 (`dist/modern/umd/dash.all.min.js`) | BSD-3-Clause (`dash/LICENSE.md`). Copyright (c) 2015, Dash Industry Forum | https://github.com/Dash-Industry-Forum/dash.js/tree/v5.2.0 |

dash.js's build also holds small libraries whose notices it ships beside it
(`dash/dash.all.min.js.LICENSE.txt`): the browser `buffer` module and
`ieee754` (MIT and BSD-3-Clause, Feross Aboukhadijeh), codem-isoboxer
0.3.10 (MIT) and `String.fromCodePoint` (MIT, Mathias Bynens). hls.js's
build is all its own code.

## JASSUB and libass (`jassub/`)

JASSUB 2.5.37 (https://github.com/ThaUnknown/jassub, npm `jassub@2.5.37`) is
libass compiled to WebAssembly with a JavaScript wrapper. Astra loads it only
when an ASS/SSA track is chosen.

| File | What it is |
| --- | --- |
| `jassub/jassub.js` | JASSUB's `dist/jassub.js` bundled by esbuild with its imports: abslink, rvfc-polyfill, throughput, and JASSUB's `debug.js` |
| `jassub/worker/worker.js` | JASSUB's `dist/worker/worker.js` and its renderers (WebGL2, WebGL1, Canvas 2D) bundled with abslink. The WebGPU renderer is not included (JASSUB itself does not import it). lfa-ponyfill (a Google Fonts lookup) is replaced by a stub that finds nothing: Astra turns font lookups off and reaches no other origin |
| `jassub/wasm/jassub-worker.js`, `.wasm` | The Emscripten glue and the WebAssembly build (no SIMD; used on devices with 2 GB or less) |
| `jassub/wasm/jassub-worker-modern.js`, `.wasm` | The same with SIMD and mimalloc |
| `jassub/default.woff2` | Liberation Sans Regular, the fallback font |
| `jassub/LICENSE.txt` | JASSUB's own licence (MIT) |

JASSUB's package gives its licence as `LGPL-2.1-or-later AND (FTL OR
GPL-2.0-or-later) AND MIT AND MIT-Modern-Variant AND ISC AND NTP AND Zlib AND
BSL-1.0`. The parts, with their sources:

| Part | Licence | Source |
| --- | --- | --- |
| JASSUB's JavaScript and C++ wrapper. Copyright (c) 2021-2022 JASSUB contributors, (c) 2017-2021 JavascriptSubtitlesOctopus contributors | MIT (`jassub/LICENSE.txt`) | https://github.com/ThaUnknown/jassub |
| libass (0.17.5 and later commits, as built by JASSUB) | ISC | https://github.com/libass/libass |
| FreeType | FreeType License (FTL), chosen here over GPL-2.0-or-later. Portions of this software are copyright © The FreeType Project (www.freetype.org). All rights reserved. | https://github.com/freetype/freetype (mirror of the FreeType Project's own repository) |
| HarfBuzz | MIT-Modern-Variant ("Old MIT") | https://github.com/harfbuzz/harfbuzz |
| GNU FriBidi 1.0.16 | LGPL-2.1-or-later | https://github.com/fribidi/fribidi |
| Brotli (WOFF2 fonts) | MIT | https://github.com/google/brotli |
| mimalloc (the SIMD build) | MIT | https://github.com/microsoft/mimalloc |
| Emscripten's runtime and C/C++ libraries compiled into the glue and the wasm (musl, libc++, compiler-rt), where the licence string's remaining NTP, Zlib and BSL-1.0 parts come from | MIT, NCSA and the licences named above | https://github.com/emscripten-core/emscripten |
| abslink 1.3.1 (in both bundles) | Apache-2.0 | https://github.com/ThaUnknown/abslink |
| rvfc-polyfill 1.0.8 (in `jassub.js`; inactive where Chrome has `requestVideoFrameCallback`) | GPL-3.0 | https://github.com/ThaUnknown/rvfc-polyfill |
| throughput 1.0.2 (in `jassub.js`, used only by JASSUB's debug overlay) | MIT | https://github.com/ThaUnknown/throughput |
| Liberation Sans (`default.woff2`). Digitized data copyright (c) 2010 Google Corporation, copyright (c) 2012 Red Hat, Inc. | SIL Open Font License 1.1 (its text is in `../fonts/LICENSE.md`) | https://github.com/liberationfonts/liberation-fonts |

The LGPL part (FriBidi) is linked into the `.wasm` files, which are separate
files here: anyone can rebuild them from JASSUB's repository (its Docker build,
`git clone --recursive`) and put their own in place. The bundles are not
minified, so their source is readable as served; the original sources are in
the npm tarballs and the repositories above.
