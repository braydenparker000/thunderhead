// What this browser can decode, asked of the browser itself rather than
// assumed from its name. Every answer here comes from Media Source
// Extensions, the media element or WebCodecs.

import {passFailed} from './route-memory.js';

const MSE = globalThis.MediaSource || globalThis.ManagedMediaSource || null;

export function mediaSourceClass() { return MSE; }

/** True when MSE accepts this MIME type with codecs, e.g. 'video/mp4; codecs="avc1.640028"'. */
export function mseSupports(mime) {
  try { return !!MSE && MSE.isTypeSupported(mime); } catch { return false; }
}

/** True when a plain <video src> claims it can play the type ('probably' or 'maybe'). */
export function nativeCanPlay(mime) {
  try { return !!globalThis.document && document.createElement('video').canPlayType(mime) !== ''; } catch { return false; }
}

const encodeCache = new Map();
/** True when WebCodecs can encode stereo 48 kHz audio in this codec (used to rebuild unsupported audio). */
export async function canEncodeAudio(codec = 'opus') {
  if (encodeCache.has(codec)) return encodeCache.get(codec);
  const probe = (async () => {
    try {
      if (!globalThis.AudioEncoder) return false;
      const {supported} = await AudioEncoder.isConfigSupported({codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 160000});
      return !!supported;
    } catch { return false; }
  })();
  encodeCache.set(codec, probe);
  return probe;
}

/** The codec strings the lab reports, so a phone's answers can be read back. */
export const REPORTED = {
  'H.264': 'video/mp4; codecs="avc1.640028"',
  'HEVC': 'video/mp4; codecs="hvc1.1.6.L120.90"',
  'HEVC 10-bit': 'video/mp4; codecs="hvc1.2.4.L120.90"',
  'AV1': 'video/mp4; codecs="av01.0.08M.08"',
  'VP9': 'video/mp4; codecs="vp09.00.40.08"',
  'AAC': 'audio/mp4; codecs="mp4a.40.2"',
  'Opus': 'audio/mp4; codecs="opus"',
  'FLAC': 'audio/mp4; codecs="flac"',
  'MP3': 'audio/mp4; codecs="mp3"',
  'AC-3': 'audio/mp4; codecs="ac-3"',
  'E-AC-3': 'audio/mp4; codecs="ec-3"',
  'DTS': 'audio/mp4; codecs="dtsc"',
};

/** The surround formats Astra passes through where the browser says it decodes them (plan.js PASSABLE). */
const SURROUND = [['AC-3', 'ac3', 'Dolby Digital'], ['E-AC-3', 'eac3', 'Dolby Digital Plus'], ['DTS', 'dts', 'DTS']];
const list = names => names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];

/** The device report's answer on Dolby and DTS sound, in plain words (the lab's device panel). */
export function surroundWords(d) {
  const plays = [], failed = [], converted = [];
  for (const [key, codec, name] of SURROUND) (d.mse[key] ? d.passFailed?.[codec] ? failed : plays : converted).push(name);
  const parts = [];
  if (plays.length) parts.push(`${list(plays)} play${plays.length > 1 ? '' : 's'} as ${plays.length > 1 ? 'they are' : 'it is'}, through the phone's own decoder`);
  if (failed.length) parts.push(`${list(failed)} failed when played as ${failed.length > 1 ? 'they are' : 'it is'}, so ${failed.length > 1 ? 'they are' : 'it is'} converted to stereo on this phone`);
  if (converted.length) parts.push(`${list(converted)} ${converted.length > 1 ? 'are' : 'is'} converted to stereo on this phone${d.opusEncoder ? '' : ' (but this browser cannot convert sound)'}`);
  return parts.join('; ') + '.';
}

export async function deviceReport() {
  const mse = Object.fromEntries(Object.entries(REPORTED).map(([k, v]) => [k, mseSupports(v)]));
  const failed = Object.fromEntries(SURROUND.map(([, codec]) => [codec, passFailed(codec)]));
  return {mse, passFailed: failed, opusEncoder: await canEncodeAudio('opus'), mediaSource: MSE ? MSE.name : 'none', webCodecs: !!globalThis.VideoDecoder};
}
