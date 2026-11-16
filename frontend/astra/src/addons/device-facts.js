// How a stream will most likely play on this phone, said on its card before the owner taps: from
// the label (addons/stream-facts.js) and the browser's own answer to "can you decode this smoothly
// and power-efficiently?" (navigator.mediaCapabilities.decodingInfo), never from the browser's name.
// It informs only: nothing is hidden, ranked or picked by it.
//
// engine/capabilities.js asks MediaSource.isTypeSupported, which says yes to a codec Chrome decodes
// in software too, so it cannot tell the battery-heavy route apart; this asks decodingInfo instead.

import {h} from '../ui/dom.js';
import {playFactsOf} from './stream-facts.js';

export const DIRECT = 'Plays directly';
export const SOFTWARE = 'Needs the software decoder (uses more battery)';
export const SOUND = 'Sound converted on the phone';

/** A representative codec string per codec: [8-bit, 10-bit] (Main and Main10 for HEVC, and so on). */
const CODECS = {
  h264: ['avc1.640028', 'avc1.6e0028'],
  hevc: ['hvc1.1.6.L120.90', 'hvc1.2.4.L150.B0'],
  av1: ['av01.0.08M.08', 'av01.0.12M.10'],
  vp9: ['vp09.00.40.08', 'vp09.02.40.10'],
};
/** Picture size and a typical bitrate for each size the label can name; 1080p when it names none. */
const SIZES = {'4k': [3840, 2160, 20e6], 1080: [1920, 1080, 8e6], 720: [1280, 720, 4e6], sd: [854, 480, 2e6]};

/**
 * The question to ask the browser for this stream, or null when the label cannot tell. A label that
 * names no codec but an MP4 file is asked as H.264, the codec of nearly every MP4 on the web; an MKV
 * or WebM file that names none may hold anything, so nothing is said. HDR and Dolby Vision mean
 * 10-bit for HEVC, AV1 and VP9; 10-bit H.264 is only what the label calls so (Hi10P).
 * @returns {{key: string, config: MediaDecodingConfiguration, plain: boolean} | null}
 */
export function questionOf(stream) {
  const f = playFactsOf(stream), codec = f.codec ?? (f.container === 'mp4' ? 'h264' : null);
  if (!codec) return null;
  const ten = f.tenBit || (f.hdr && codec !== 'h264');
  const [width, height, bitrate] = SIZES[f.res ?? '1080'];
  const contentType = `video/mp4; codecs="${CODECS[codec][ten ? 1 : 0]}"`;
  return {key: `${contentType} ${width}x${height}`, plain: codec === 'h264' && !ten,
    config: {type: 'media-source', video: {contentType, width, height, bitrate, framerate: 24}}};
}

/**
 * The words for an answer: direct only when the browser has a smooth, power-efficient decoder.
 * Without an answer (an older browser, or it failed) only 8-bit H.264 is said, since every phone
 * Astra runs on decodes it in hardware; anything else stays unsaid.
 * @param {{supported?: boolean, smooth?: boolean, powerEfficient?: boolean} | null} answer
 */
export function wordsFor(question, answer) {
  if (!question) return '';
  if (!answer) return question.plain ? DIRECT : '';
  return answer.supported && answer.smooth && answer.powerEfficient ? DIRECT : SOFTWARE;
}

// Sound the planner passes to the phone's own decoder when the browser says it can (engine/plan.js
// PASSABLE and audioDelivery), with the codec string it asks about. The check is copied here rather
// than imported: the engine's modules are not part of start-up (tests/astra-startup.test.mjs).
const PASSED = [
  ['dts', /(?<![a-z])dts/i, 'dtsc'],
  ['eac3', /(?<![a-z0-9])(dd\+|ddp|e-?ac-?3|dolby digital plus)/i, 'ec-3'],
  ['ac3', /(?<![a-z0-9])(dd(?![a-z+])|ac-?3|dolby digital(?! plus))/i, 'ac-3'],
];
const mseSays = mime => { try { const M = globalThis.MediaSource || globalThis.ManagedMediaSource; return !!M?.isTypeSupported(mime); } catch { return false; } };
/** Whether a pass-through of this codec failed here in the last 30 days (engine/route-memory.js passFailed). */
function passFailedHere(codec, now = Date.now()) {
  try { const at = JSON.parse(globalThis.localStorage?.getItem('astra-routes') || 'null')?.pass?.[codec]; return Number.isFinite(at) && at <= now + 864e5 && now - at < 30 * 864e5; } catch { return false; }
}

/**
 * The second note, said from the label: nothing when every sound it names is one this phone plays
 * as it is (the browser says so and it has not failed here), the conversion note otherwise.
 * @param {{mse?: (mime: string) => boolean, passFailed?: (codec: string) => boolean}} [caps] for tests
 */
export function soundNote(stream, {mse = mseSays, passFailed = passFailedHere} = {}) {
  if (!playFactsOf(stream).sound) return '';
  const t = [stream?.name, stream?.title, stream?.filename].filter(Boolean).join(' '); // as stream-facts.js reads it
  const named = PASSED.filter(([, re]) => re.test(t));
  const plays = named.length > 0 && named.every(([codec, , cs]) => !passFailed(codec) && mse(`audio/mp4; codecs="${cs}"`));
  return plays ? '' : SOUND;
}

// One question per codec and picture size per session: the answer, once known, or its promise.
const answers = new Map();

/** The browser's answer to a question (null when it cannot answer), asked once per session. */
export function ask(question) {
  let got = answers.get(question.key);
  if (!got) {
    const mc = globalThis.navigator?.mediaCapabilities;
    const promise = (mc?.decodingInfo ? mc.decodingInfo(question.config) : Promise.resolve(null))
      .then(a => (a ? {supported: !!a.supported, smooth: !!a.smooth, powerEfficient: !!a.powerEfficient} : null), () => null);
    got = {promise};
    promise.then(value => { got.value = value; got.done = true; });
    answers.set(question.key, got);
  }
  return got.promise;
}

/**
 * The card's line, or null when the label cannot tell. Its room is reserved before the answer
 * arrives (one line, never wrapping), so the card and those under it do not move under a finger.
 */
export function playsMark(stream) {
  const q = questionOf(stream);
  if (!q) return null;
  const el = h('span', {class: 'stream-plays'});
  const put = a => { const words = wordsFor(q, a); el.textContent = words; el.classList.toggle('heavy', words === SOFTWARE); };
  const known = answers.get(q.key);
  if (known?.done) put(known.value);
  else ask(q).then(put);
  return el;
}
