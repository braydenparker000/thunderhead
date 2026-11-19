// Everything a stream card shows, read from what the stream says of itself (its name, description lines, file
// name, size and the add-on client's fields): resolution, source, picture, codec, sound, languages, size,
// release group, the indexer inside an aggregating add-on, whether the debrid service has it ready, seeders,
// and the release's own name. Add-ons write these in free text (emoji-led lines, pipes, bracketed tags, plain
// file names), so each fact is a table of words tried in order; the first that stands as a word wins. A
// description in Astra's own format for AIOStreams (astra-format.js) is read exactly instead. A fact not
// found is null (or an empty list): nothing is guessed beyond the words. Pure; nothing is fetched.

import {dropHashes, withoutHash} from './stream-text.js';
import {bytesOf, pictureText} from './stream-facts.js';
import {readAstraFormat} from './astra-format.js';

const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}‍️⃣]/gu;
// A word on its own: the edges are anything but a letter or a digit (`\b` does not split "1080p_x265").
const test = (t, re, end = '(?![a-z0-9])') => new RegExp(`(?<![a-z0-9])(?:${re})${end}`, 'i').test(t);
const first = (t, table) => table.find(([, re, end]) => test(t, re, end))?.[0] ?? null;

/** [shown, words, end] tables, most specific first. An explicit number wins over UHD/4K words. */
export const RESOLUTIONS = [['2160p', '2160[pi]?'], ['1440p', '1440p?'], ['1080p', '1080[pi]?'], ['720p', '720p?'], ['576p', '576[pi]?'],
  ['480p', '480[pi]?'], ['360p', '360p?'], ['2160p', '4k|uhd'], ['1440p', 'qhd|2k'], ['1080p', 'fhd'], ['480p', 'sd|dvd-?rip|xvid|divx']];
const RES_LABEL = {'2160p': '4K', '480p': '480p'};
export const SOURCES = [['Remux', 'remux|bd-?remux'], ['BluRay', 'blu-?ray|bd-?rip|br-?rip|bdmux|bd25|bd50'], ['WEBRip', 'web-?rip|webmux'],
  ['WEB-DL', 'web-?dl|webdl|web'], ['HDTV', 'hdtv|pdtv|tvrip|sdtv|dsr'], ['HDRip', 'hd-?rip'], ['DVDRip', 'dvd-?rip|dvd-?r|dvd[59]?'],
  ['CAM', 'cam|cam-?rip|hd-?cam|hd-?ts|telesync|ts-?rip|hd-?tc|telecine'], ['Screener', 'scr|screener|dvdscr']];
export const CODECS = [['HEVC', 'x265|h[ ._-]?265|hevc', '(?![a-z])'], ['AV1', 'av1', '(?![a-z])'], ['VP9', 'vp0?9', '(?![a-z])'],
  ['AVC', 'x264|h[ ._-]?264|avc1?', '(?![a-z])'], ['XviD', 'xvid'], ['DivX', 'divx'], ['VC-1', 'vc-?1'], ['MPEG-2', 'mpeg-?2']];
// Sound codecs may run into their channels ("DDP5.1", "AAC2.0"), so only a letter ends most of them.
export const SOUNDS = [['TrueHD', 'true-?hd', '(?![a-z])'], ['DTS:X', 'dts[ ._:-]?x'], ['DTS-HD MA', 'dts[ ._-]?hd[ ._-]?ma', '(?![a-z])'],
  ['DTS-HD', 'dts[ ._-]?hd', '(?![a-z])'], ['DTS', 'dts', '(?![a-z])'], ['DD+', 'ddp|dd\\+|e-?ac-?3|dolby[ ._-]?digital[ ._-]?plus', '(?![a-z])'],
  ['DD', 'dd|ac-?3|dolby[ ._-]?digital', '(?![a-z+])'], ['AAC', 'aac', '(?![a-z])'], ['FLAC', 'flac', '(?![a-z])'], ['Opus', 'opus', '(?![a-z])'],
  ['MP3', 'mp3', '(?![a-z])'], ['PCM', 'l?pcm', '(?![a-z])']];
/** [code, name, words, flags]: only words that are rarely anything else (no two-letter codes). */
export const LANGUAGES = [['en', 'English', 'english|eng', 'GB US AU'], ['it', 'Italian', 'italian|ita', 'IT'], ['fr', 'French', 'french|fre|fra|vff|vfq|truefrench', 'FR'],
  ['de', 'German', 'german|ger|deu', 'DE AT'], ['es', 'Spanish', 'spanish|spa|esp|castellano', 'ES'], ['la', 'Latino', 'latino', 'MX AR'],
  ['pt', 'Portuguese', 'portuguese|por|pt-?br', 'PT BR'], ['ru', 'Russian', 'russian|rus', 'RU'], ['uk', 'Ukrainian', 'ukrainian|ukr', 'UA'],
  ['pl', 'Polish', 'polish|pol', 'PL'], ['nl', 'Dutch', 'dutch|nld', 'NL'], ['sv', 'Swedish', 'swedish|swe', 'SE'], ['tr', 'Turkish', 'turkish|tur', 'TR'],
  ['ar', 'Arabic', 'arabic|ara', 'SA AE EG'], ['hi', 'Hindi', 'hindi|hin', 'IN'], ['ja', 'Japanese', 'japanese|jpn', 'JP'], ['ko', 'Korean', 'korean|kor', 'KR'],
  ['zh', 'Chinese', 'chinese|mandarin|cantonese', 'CN TW HK'], ['multi', 'Multi', 'multi|multi-?audio|dual[ ._-]?audio', '']];
// A quality word an add-on gives where it has no resolution ("💩 Low Quality", "💿 HD", "🎥 CAM"): shown as the
// add-on's own word, never as a resolution. "4K", "UHD" and "FHD" are resolutions (RESOLUTIONS, above).
export const QUALITY_WORDS = [['Low quality', 'low[ ._-]?quality|lq'], ['CAM', 'cam|cam-?rip|hd-?cam|hd-?ts|telesync|hd-?tc'], ['Screener', 'scr|screener'], ['HD', 'hd'], ['SD', 'sd']];
// Running time as add-ons write it: "⏱️ 2h:10m:37s", "2h 10m", "1:58:00", "130 min". Bitrate: "751 Kbps", "4.2 Mb/s".
const RUNTIME = /(?<![\d:])(\d{1,2})\s*h[\s:]*(\d{1,2})\s*m(?:in)?(?:[\s:]*\d{1,2}\s*s)?|⏱️?\s*(\d{1,2}):(\d{2}):\d{2}(?!\d)|(?<![\d.])(\d{2,3})\s?min(?:utes)?(?![a-z])/iu;
const BITRATE = /(?<![\d.,])(\d+(?:[.,]\d+)?)\s?([km])(?:bps|b\/s|bit\/s)(?![a-z])/i;
// A line that names the film ("🎬 Some Film French", "📁 Some.Film.mkv"): its words after the emoji.
const TITLE_LINE = /^\s*(?:🎬|📁|📄|🎞️?)\s*(.+)$/mu;
const PICTURE = [['DV', 'dv|dovi|dolby[ ._-]?vision'], ['HDR10+', 'hdr10(?:\\+|plus|p)'], ['HDR10', 'hdr10'], ['HDR', 'hdr'], ['HLG', 'hlg']];
const TEN_BIT = /(?<!\d)10[ ._-]?bits?(?![a-z])|(?<![a-z0-9])(hi10p?|main ?10)(?![a-z0-9])/i;
const SERVICES = {rd: 'RD', ad: 'AD', pm: 'PM', dl: 'DL', tb: 'TB', ed: 'ED', oc: 'OC', pkp: 'PKP', en: 'EN', st: 'ST', sn: 'SN', nd: 'ND'};
const SERVICE_NAMES = [['TB', 'torbox'], ['RD', 'real-?debrid'], ['AD', 'all-?debrid'], ['PM', 'premiumize'], ['DL', 'debrid-?link'], ['ED', 'easy-?debrid'], ['OC', 'offcloud']];
const MEDIA = /\.(mkv|mp4|m4v|avi|webm|mov|ts|m2ts|wmv|flv|mpe?g)$/i;
const NOT_GROUP = new Set(['dl', 'rip', 'web', 'hd', 'sd', 'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'av1', 'aac', 'ac3', 'dts', 'atmos', 'hdr', 'dv', 'remux', 'bluray']);

/** Text without the hash and with emoji as spaces: what words are read from. */
const plain = t => dropHashes(t).replace(EMOJI, ' ');
/** A line as a name is shown: no emoji, no hash, one line, single spaces. */
export const cleanLine = t => withoutHash(String(t ?? '')).replace(EMOJI, ' ').replace(/\s+/g, ' ').trim();

/** Whether a line reads as a release's own name (it, cleaned, or ''): no facts separators, and a file or release shape. */
function releaseLike(raw) {
  const t = cleanLine(raw);
  if (t.length < 8 || /[|·•]/.test(raw)) return '';
  const dotted = !/\s/.test(t) && (t.match(/[._]/g) || []).length >= 2;
  if (dotted || MEDIA.test(t)) return t;
  // A line led by an emoji is a facts line unless it is a file or dotted release name (above).
  return /^\s*[\p{Extended_Pictographic}]/u.test(raw) ? '' : /(?<!\d)(19|20)\d{2}(?!\d)/.test(t) || test(t, '2160p|1080p|720p|480p|x26[45]|hevc|web-?dl|bluray') ? t : '';
}

/** The release's own name: the file's name, else the first line of the description or name shaped like one, else ''. */
export function releaseName(stream) {
  if (stream?.filename) return cleanLine(stream.filename);
  const lines = [...String(stream?.title ?? '').split('\n'), ...String(stream?.name ?? '').split('\n').slice(1)];
  for (const l of lines) { const r = releaseLike(l); if (r) return r; }
  return '';
}

/** The release group: "-GROUP" at the end of the release's name, "[Group]" at its start (anime), or a "🏷️ Group" label. */
function groupOf(release, text) {
  const label = /(?:🏷️?|\bgroup\s*[:=])\s*([\p{L}\p{N}][\p{L}\p{N}._-]{1,24})/iu.exec(text);
  if (label) return label[1];
  const name = release.replace(MEDIA, '');
  const end = /-([A-Za-z0-9][A-Za-z0-9_]{1,20})$/.exec(name), lead = /^\[([^\]]{2,24})\]/.exec(name);
  const g = end?.[1] || lead?.[1] || null;
  return g && !NOT_GROUP.has(g.toLowerCase()) && !/^\d+p?$/.test(g) ? g : null;
}

const VALUE = '([\\p{L}\\p{N}][\\p{L}\\p{N}._-]*(?: [\\p{L}\\p{N}][\\p{L}\\p{N}._-]*){0,2})';
const INDEXER = new RegExp(`(?:⚙️?|🔍|🔎|\\b(?:indexer|source|tracker|provider)\\s*[:=])\\s*${VALUE}`, 'iu');
const SEEDERS = /(?:👤|👥|🌱|⬆️?|\bseed(?:er)?s?\s*[:=]?)\s*(\d{1,3}(?:,\d{3})*|\d+)(?![\d.])/iu;
// Channels: "5.1", "7.1ch", "6ch"; never part of a longer number ("2.5.1", "5.1080p"). Sizes and years are taken out first.
const CHANNELS = /(?<!\d)(?<!\d\.)([1-9])\.([0-2])(?:ch)?(?!\d)(?!\.\d)|(?<![\d.])([2-8])ch(?![a-z])/i;

/** Whether the debrid service has the file ready, and which service: from bolts, "[TB+]", "Ready", "Instant", "Cached". */
function readiness(raw, t) {
  const bracket = /\[(rd|ad|pm|dl|tb|ed|oc|pkp|en|st|sn|nd)(\+|⚡| ?download|⏳)?\]/i.exec(raw) || /\((rd|ad|pm|dl|tb|ed|oc|pkp)\)/i.exec(raw);
  const service = bracket ? SERVICES[bracket[1].toLowerCase()] : SERVICE_NAMES.find(([, re]) => test(t, re))?.[0] ?? null;
  if (/⏳|⬇️/u.test(raw) || /download\]/i.test(raw) || test(t, 'uncached|not[ ._-]ready|not[ ._-]cached')) return {ready: false, service};
  if (/⚡/u.test(raw) || bracket?.[2] === '+' || test(t, 'ready|instant|cached')) return {ready: true, service};
  return {ready: null, service};
}

/** Languages, from words after the title's own name (a year or resolution ends it: "The.Italian.Job.2003" is not Italian) and from flags. */
function languagesOf(raw) {
  const found = new Set();
  for (const flag of raw.match(/\p{Regional_Indicator}{2}/gu) || []) {
    const cc = [...flag].map(c => String.fromCharCode(c.codePointAt(0) - 0x1f1e6 + 65)).join('');
    const l = LANGUAGES.find(x => x[3].split(' ').includes(cc));
    if (l) found.add(l[0]);
  }
  for (const line of plain(raw).split('\n')) {
    const cut = line.search(/(?<![a-z0-9])((19|20)\d{2}|2160p|1080p|720p|480p)(?![a-z0-9])/i);
    const words = cut >= 0 ? line.slice(cut) : line;
    for (const [code, , re] of LANGUAGES) if (test(words, re)) found.add(code);
  }
  return LANGUAGES.filter(l => found.has(l[0])).map(l => l[1]);
}

const known = new WeakMap();
/**
 * What a stream says, as one frozen object: {exact, res, resLabel, source, picture[], codec, sound: {codec,
 * channels, atmos}, languages[], bytes, group, indexer, via, service, ready, seeders, kind, release, hash, quality, runtime
 * (minutes), bitrate (bits a second), title}.
 * Read once per stream (a long list is drawn again at every filter change).
 */
export function releaseFacts(stream) {
  if (stream && typeof stream === 'object' && known.has(stream)) return known.get(stream);
  const facts = Object.freeze(readAstraFormat(stream) || guess(stream || {}));
  if (stream && typeof stream === 'object') known.set(stream, facts);
  return facts;
}

function guess(stream) {
  const raw = [stream.name, stream.title, stream.filename].filter(Boolean).join('\n'), t = plain(raw), p = pictureText(t);
  const res = first(p, RESOLUTIONS);
  const picture = [];
  for (const [label, re] of PICTURE) if (test(t, re) && !(label === 'HDR10' && picture.includes('HDR10+')) && !(label === 'HDR' && picture.some(x => x.startsWith('HDR')))) picture.push(label);
  if (TEN_BIT.test(t)) picture.push('10-bit');
  const ch = CHANNELS.exec(p.replace(/(?<![a-z0-9])(?:19|20)\d{2}(?![a-z0-9])/gi, ' '));
  const release = releaseName(stream);
  const seeds = SEEDERS.exec(raw), run = RUNTIME.exec(raw), rate = BITRATE.exec(raw), named = TITLE_LINE.exec(withoutHash(stream.title || ''));
  return {
    exact: false, res, resLabel: res ? RES_LABEL[res] || res : null, quality: res ? null : first(t, QUALITY_WORDS),
    runtime: run ? (run[1] ? Number(run[1]) * 60 + Number(run[2]) : run[3] ? Number(run[3]) * 60 + Number(run[4]) : Number(run[5])) || null : null,
    bitrate: rate ? Math.round(Number(rate[1].replace(',', '.')) * (rate[2].toLowerCase() === 'm' ? 1e6 : 1e3)) || null : null,
    title: named ? cleanLine(named[1]) : '',
    source: first(t, SOURCES), picture, codec: first(t, CODECS),
    sound: {codec: first(t, SOUNDS), channels: ch ? (ch[3] ? {2: '2.0', 6: '5.1', 8: '7.1'}[ch[3]] || null : `${ch[1]}.${ch[2]}`) : null, atmos: test(t, 'atmos')},
    languages: languagesOf(raw), bytes: bytesOf(stream),
    group: groupOf(release, raw), indexer: INDEXER.exec(raw)?.[1]?.trim() || null, via: null,
    ...readiness(raw, t), seeders: seeds ? Number(seeds[1].replace(/,/g, '')) : null, kind: stream.infoHash && !stream.url ? 'p2p' : null,
    release, hash: null,
  };
}

/**
 * The reader's one-time cost, in steps: compiling its expressions (and stream-text.js's) is about 20 ms at 4x CPU
 * on a first card, so a list with frames to spare (screens/stream-pace.js) runs one step a frame first, each a few
 * ms (each with plain text and with emoji). The expressions compiled are the very ones read with (each `test` pattern is the same text, which the
 * engine compiles once), so nothing here changes what is read.
 */
const WARM_TEXT = ['x', 'x 🎬']; // the engine compiles an expression once for one-byte text and once for text with emoji
const each = fn => WARM_TEXT.map(t => () => fn(t));
export const WARM = [
  ...each(t => withoutHash(`${t}\n🔗 0123456789abcdef0123456789abcdef01234567`)),
  ...each(t => { dropHashes(t); plain(t); cleanLine(t); }),
  ...each(t => { for (const table of [RESOLUTIONS, SOURCES, CODECS]) first(t, table); }),
  ...each(t => { for (const table of [SOUNDS, QUALITY_WORDS, PICTURE]) first(t, table); TEN_BIT.test(t); CHANNELS.exec(t); }),
  ...each(t => INDEXER.exec(t)),
  ...each(t => groupOf(t, t)),
  ...each(t => { SEEDERS.exec(t); RUNTIME.exec(t); BITRATE.exec(t); TITLE_LINE.exec(t); }),
  ...each(t => { readiness(t, t); releaseLike(`${t} 2019 1080p`); }),
  ...each(t => languagesOf(`🇬🇧 ${t}`)),
  ...each(t => guess({name: t, title: t})),
];

/** How many facts were found, of any kind: what the designed card has to say. */
export const factCount = f => (f ? [f.res || f.quality, f.release || f.title, f.bytes, f.sound.codec || f.sound.channels, f.source, f.codec, f.picture.length,
  f.runtime, f.bitrate, f.ready !== null, f.indexer, f.group, f.seeders != null, f.languages.length].filter(Boolean).length : 0);

/**
 * Whether enough was found for a designed card: three facts of any kind (with or without a resolution), or two
 * when one is the badge (a resolution or the add-on's quality word), so one list reads as one list. Only a
 * stream whose words say almost nothing keeps the add-on's own text.
 */
export const designedEnough = f => factCount(f) >= 3 || (factCount(f) >= 2 && !!(f.res || f.quality));

/** A release name cut for a middle ellipsis: [head, tail], the tail (its last characters) always shown whole. */
export function splitMiddle(name, tail = 14) {
  const s = String(name ?? '');
  if (s.length <= tail + 6) return [s, ''];
  return [s.slice(0, s.length - tail), s.slice(s.length - tail)];
}

/** A resolution's rank for the "best picture first" order (higher first); unknown last. */
export const resRank = f => (f?.res ? Number.parseInt(f.res, 10) : 0);
