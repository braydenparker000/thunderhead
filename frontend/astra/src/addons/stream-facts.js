// What a stream says about itself, and the owner's filters over that (the Streams screen's second
// row of chips). Add-ons describe a stream in free text ("1080p WEB-DL x265 💾 1.4 GB"), so the
// picture size, the codec and the file size are read from its name, description and file name, and
// the size also from `behaviorHints.videoSize` when the add-on gives one. Nothing is fetched.
//
// Data use follows the file's size, not where it comes from: a stream plays only what is watched,
// so megabytes an hour is size over runtime. HEVC and AV1 files are about half the size of H.264
// ones at the same quality, which is why they have chips of their own.

import {dropHashes} from './stream-text.js';

/** @typedef {{bytes: number | null, res: '4k' | '1080' | '720' | 'sd' | null, codec: 'hevc' | 'av1' | 'vp9' | 'h264' | null}} Facts */
/** @typedef {{small: boolean, maxMb: number, res: string[], codec: string[]}} Filters */

/** The chips, in the order shown: a size limit (one at a time), picture sizes and codecs (any of). */
export const SIZE_CHIPS = [[700, 'Under 700 MB'], [1500, 'Under 1.5 GB'], [3000, 'Under 3 GB']];
export const RES_CHIPS = [['720', '720p'], ['1080', '1080p'], ['4k', '4K'], ['sd', 'SD']];
export const CODEC_CHIPS = [['hevc', 'HEVC'], ['av1', 'AV1']];
/** @type {Filters} */
export const NO_FILTERS = Object.freeze({small: false, maxMb: 0, res: [], codec: []});

// What a stream says of itself, without the torrent's hash (whose digits and letters are no words).
export const text = s => dropHashes([s.name, s.title, s.filename].filter(Boolean).join(' '));
// A word on its own: `\b` does not split "1080p_x265", so the edges are any non-letter, non-digit.
const word = (t, re, end = '(?![a-z0-9])') => new RegExp(`(?<![a-z0-9])(?:${re})${end}`, 'i').test(t);
// A size as written: "1.4 GB", "1,400 MB", "1.400,5 MB", "1 400 MB", "700MiB", "2.1 TB".
const SIZE = /(?<![a-z0-9.,])(\d{1,3}(?:[ ,.\u00a0\u202f]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*([kmgt])(i?)b(?![a-z0-9])/i;
const UNIT = {k: 1e3, m: 1e6, g: 1e9, t: 1e12}, BINARY = {k: 2 ** 10, m: 2 ** 20, g: 2 ** 30, t: 2 ** 40};

/** A number as people write it. The last of mixed separators is the decimal point; one separator
 * before exactly three digits groups thousands in KB and MB ("1,400 MB") but is a decimal point in
 * GB and TB ("1.400 GB" is 1.4 GB: nobody's file is 1,400 GB). */
function numberOf(raw, unit) {
  const s = raw.replace(/[\s\u00a0\u202f]/g, ''), seps = s.match(/[.,]/g) || [], last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (!seps.length) return Number(s);
  const decimal = new Set(seps).size > 1 || (seps.length === 1 && (s.length - last - 1 !== 3 || /[gt]/i.test(unit)));
  return Number(decimal ? `${s.slice(0, last).replace(/[.,]/g, '')}.${s.slice(last + 1)}` : s.replace(/[.,]/g, ''));
}

/** The file's size in bytes: the add-on's own number, else the first size in its text. @returns {number | null} */
export function bytesOf(stream) {
  if (stream.size > 0) return stream.size;
  const m = SIZE.exec(text(stream));
  if (!m) return null;
  const unit = m[2].toLowerCase(), n = numberOf(m[1], unit) * (m[3] ? BINARY : UNIT)[unit];
  return n > 0 ? Math.round(n) : null;
}

/** The words a picture size is read from: sizes taken out ("720 MB" is not 720p), and "1920x1080"
 * read by its width (a 1920x800 film is still 1080p). */
function pictureText(t) {
  return t.replace(new RegExp(SIZE.source, 'gi'), ' ').replace(/(?<!\d)(\d{3,4})\s*[x×]\s*(\d{3,4})(?!\d)/g,
    (_, w, ht) => ` ${({3840: 2160, 4096: 2160, 1920: 1080, 1280: 720})[w] || ht}p `);
}

/** A reading kept with its stream (a listed stream is never changed, and a long list is read again at every
 * filter change). */
const kept = read => {
  const known = new WeakMap();
  return stream => {
    if (!stream || typeof stream !== 'object') return read(stream);
    let v = known.get(stream);
    if (!v) known.set(stream, v = Object.freeze(read(stream)));
    return v;
  };
};

/** @type {(stream: object) => Facts} */
export const factsOf = kept(stream => {
  const t = text(stream), p = pictureText(t), w = re => word(p, re), c = re => word(t, re, '(?![a-z])');
  // An explicit 2160, 1080 or 720 wins over the words UHD and 4K ("UHD BluRay 1080p" is 1080p).
  const res = w('2160p?') ? '4k' : w('1080[pi]?') ? '1080' : w('720p?') ? '720' : w('4k|uhd') ? '4k' : w('fhd') ? '1080'
    : w('576p?|480p?|360p?|sd|dvdrip|xvid|divx') ? 'sd' : null;
  // Codec names may run into a bit depth ("HEVC10bit"), so only a letter ends them.
  const codec = c('x265|h[ ._-]?265|hevc') ? 'hevc' : c('av1') ? 'av1' : c('vp0?9') ? 'vp9' : c('x264|h[ ._-]?264|avc1?') ? 'h264' : null;
  return {bytes: bytesOf(stream), res, codec};
});

/** What the label says about how the file plays here: its picture as factsOf reads it, whether it
 * is 10-bit or HDR (which needs a Main10 decoder), its container, and whether its sound is one Astra
 * converts on the phone (Dolby Digital and DTS; AAC, Opus, MP3 and FLAC play as they are). */
export const playFactsOf = kept(stream => {
  const t = text(stream), w = (re, end) => word(t, re, end);
  const sound = w('dts|e-?ac-?3|ac-?3|ddp?', '(?![a-z])') && !w('aac|opus|mp3|flac', '(?![a-z])');
  return {...factsOf(stream), tenBit: /(?<!\d)10[ ._-]?bits?(?![a-z])|(?<![a-z0-9])(hi10p?|main ?10)(?![a-z0-9])/i.test(t),
    hdr: w('hdr|dolby[ ._-]?vision|dv|dovi|hlg', '(?![a-z])'),
    container: w('mkv') ? 'mkv' : w('mp4|m4v') ? 'mp4' : w('webm') ? 'webm' : null, sound};
});

/** The filters as stored, made safe: unknown values dropped. @param {any} v @returns {Filters} */
export function filtersFrom(v) {
  const list = (got, chips) => (Array.isArray(got) ? got.filter(x => chips.some(c => c[0] === x)) : []);
  return {small: v?.small === true, maxMb: SIZE_CHIPS.some(c => c[0] === v?.maxMb) ? v.maxMb : 0, res: list(v?.res, RES_CHIPS), codec: list(v?.codec, CODEC_CHIPS)};
}
export const anyFilter = f => f.small || f.maxMb > 0 || f.res.length > 0 || f.codec.length > 0;

/** Whether a stream passes. A limit or a choice the stream says nothing about hides it: with a size
 * limit on, a stream of unknown size may be any size. @param {Facts} facts @param {Filters} f */
export function passes(facts, f) {
  if (f.maxMb && !(facts.bytes !== null && facts.bytes <= f.maxMb * 1e6)) return false;
  if (f.res.length && !f.res.includes(facts.res ?? '')) return false;
  if (f.codec.length && !f.codec.includes(facts.codec ?? '')) return false;
  return true;
}

/** The streams to show, in order: those that pass, smallest first when asked (unknown sizes last,
 * equal sizes in the add-on's order). Each comes with its place in the add-on's own list.
 * @template T @param {T[]} streams @param {Filters} f @returns {[T, number][]} */
export function shown(streams, f) {
  const kept = streams.map((s, i) => /** @type {[T, number, Facts]} */ ([s, i, factsOf(s)])).filter(([, , facts]) => passes(facts, f));
  if (f.small) kept.sort((a, b) => (a[2].bytes ?? Infinity) - (b[2].bytes ?? Infinity) || a[1] - b[1]);
  return kept.map(([s, i]) => [s, i]);
}

/** Minutes from a title's runtime as add-ons write it ("118 min", "1h 58m", "45"). @returns {number | null} */
export function minutesOf(runtime) {
  const t = String(runtime ?? '');
  const hm = /(\d+)\s*h(?:\w*)?\s*(\d+)?/i.exec(t);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] ?? 0);
  const m = /(\d+)/.exec(t);
  return m && Number(m[1]) > 0 ? Number(m[1]) : null;
}

/** What an hour of this stream costs in data, as words ("0.7 GB an hour"), or '' when the size or
 * the runtime is unknown. @param {number | null} bytes @param {number | null} minutes */
export function perHour(bytes, minutes) {
  if (!bytes || !minutes) return '';
  const mb = (bytes * 60) / minutes / 1e6; // megabytes an hour, multiplied first so 375 stays 375
  if (mb < 1) return ''; // a tiny file (a sample) says nothing useful
  return mb >= 950 ? `${(mb / 1000).toFixed(1)} GB an hour` : `${mb < 10 ? Math.round(mb) : Math.round(mb / 10) * 10} MB an hour`;
}
