// The AC-3/E-AC-3, DTS and Dolby TrueHD decoders for Mediabunny, loaded once
// and only when a file needs them (1.2, 1.7 and 0.7 MB). A failed download is not kept: it is tried
// again twice here, and a later film tries afresh. It fails as a network error
// (kind 'network'), never as a decoding one, so one hiccup does not send this
// film, or every later one with the same sound, to the software decoder.
// Converted sound is decoded in the sound worker where one runs (sound-apart.js): the decoder is then
// loaded there, and on the page only when the page converts the sound itself (decodersHere).

import {apartUsable, warmApart} from './sound-apart.js';

const ready = {};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const family = codec => codec === 'dts' ? 'dts' : codec === 'truehd' ? 'truehd' : codec === 'ac3' || codec === 'eac3' ? 'ac3' : null;

/**
 * Loads the decoder a codec needs (nothing for others) where the sound will be converted: in the sound worker, or on
 * the page when no worker runs. Rejects with {kind: 'network'} when it cannot be downloaded.
 */
export function loadDecoders(codec) {
  if (!family(codec)) return Promise.resolve();
  if (!apartUsable()) return decodersHere(codec);
  return warmApart(codec).catch(error => { if (error?.kind === 'network') throw error; return decodersHere(codec); });
}

/** Loads the decoder a codec needs on the page itself (the page's own conversion, remux-audio.js). */
export function decodersHere(codec) {
  const wanted = family(codec);
  if (!wanted) return Promise.resolve();
  return ready[wanted] ??= fetchDecoder(wanted).catch(error => {
    delete ready[wanted];
    throw Object.assign(new Error('The audio converter could not be downloaded.'), {kind: 'network', detail: String(error?.message || error)});
  });
}

async function fetchDecoder(wanted, tries = 3) {
  for (let attempt = 0; ; attempt++) {
    try {
      // A browser may remember a failed module download: a retry asks under another address (the same file).
      const again = attempt ? `?retry=${Date.now()}` : '';
      if (wanted === 'dts') return (await import(`../../vendor/mediabunny-dts.js${again}`)).registerDtsDecoder();
      if (wanted === 'truehd') return (await import(`../../vendor/mediabunny-truehd.js${again}`)).registerTrueHdDecoder();
      return (await import(`../../vendor/mediabunny-ac3.js${again}`)).registerAc3Decoder();
    } catch (error) {
      if (attempt + 1 >= tries) throw error;
      await sleep(1000 * 2 ** attempt);
    }
  }
}
