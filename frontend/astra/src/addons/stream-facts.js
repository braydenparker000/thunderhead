// What a stream says about itself, and the owner's filters over that (the Streams screen's second
// row of chips). Add-ons describe a stream in free text ("1080p WEB-DL x265 💾 1.4 GB"), so the
// picture size, the codec and the file size are read from its name, description and file name, and
// the size also from `behaviorHints.videoSize` when the add-on gives one. Nothing is fetched.
//
// Data use follows the file's size, not where it comes from: a stream plays only what is watched,
// so megabytes an hour is size over runtime. HEVC and AV1 files are about half the size of H.264
// ones at the same quality, which is why they have chips of their own.

/** @typedef {{bytes: number | null, res: '4k' | '1080' | '720' | 'sd' | null, codec: 'hevc' | 'av1' | 'h264' | null}} Facts */
/** @typedef {{small: boolean, maxMb: number, res: string[], codec: string[]}} Filters */

/** The chips, in the order shown: a size limit (one at a time), picture sizes and codecs (any of). */
export const SIZE_CHIPS = [[700, 'Under 700 MB'], [1500, 'Under 1.5 GB'], [3000, 'Under 3 GB']];
export const RES_CHIPS = [['720', '720p'], ['1080', '1080p'], ['4k', '4K'], ['sd', 'SD']];
export const CODEC_CHIPS = [['hevc', 'HEVC'], ['av1', 'AV1']];
/** @type {Filters} */
export const NO_FILTERS = Object.freeze({small: false, maxMb: 0, res: [], codec: []});

const text = s => [s.name, s.title, s.filename].filter(Boolean).join(' ');

/** The file's size in bytes: the add-on's own number, else the first size in its text. @returns {number | null} */
export function bytesOf(stream) {
  if (stream.size > 0) return stream.size;
  const m = /(\d+(?:[.,]\d+)?)\s*(GB|MB|GiB|MiB)\b/i.exec(text(stream));
  if (!m) return null;
  const n = Number(m[1].replace(',', '.')), unit = m[2].toLowerCase();
  return Math.round(n * (unit === 'gb' ? 1e9 : unit === 'gib' ? 2 ** 30 : unit === 'mib' ? 2 ** 20 : 1e6));
}

/** @returns {Facts} */
export function factsOf(stream) {
  const t = text(stream);
  const res = /\b(2160p?|4k|uhd)\b/i.test(t) ? '4k' : /\b(1080[pi]?|fhd)\b/i.test(t) ? '1080' : /\b720p?\b/i.test(t) ? '720'
    : /\b(576p?|480p?|360p?|sd|dvdrip|xvid|divx)\b/i.test(t) ? 'sd' : null;
  const codec = /\b(x265|h\.?265|hevc)\b/i.test(t) ? 'hevc' : /\bav1\b/i.test(t) ? 'av1' : /\b(x264|h\.?264|avc)\b/i.test(t) ? 'h264' : null;
  return {bytes: bytesOf(stream), res, codec};
}

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
  return mb >= 950 ? `${(mb / 1000).toFixed(1)} GB an hour` : `${Math.round(mb / 10) * 10} MB an hour`;
}
