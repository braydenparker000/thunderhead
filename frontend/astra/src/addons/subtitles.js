// Subtitles from add-ons (the Stremio "subtitles" resource). Astra also asks
// OpenSubtitles v3, Stremio's own subtitle add-on, unless the viewer turns
// that off in Settings. Lists only: files are downloaded when chosen.

import {fetchManifest, getJson, resourceUrl, supports} from './client.js';
import {decodeText} from '../subtitles/charset.js';

export const OPENSUBTITLES = 'https://opensubtitles-v3.strem.io/manifest.json';

// OpenSubtitles' own codes that are not ISO 639.
const ALIASES = {pob: 'pt-BR', pb: 'pt-BR', zht: 'zh-Hant', zhe: 'zh', ze: 'zh', zhs: 'zh-Hans', spn: 'es', ea: 'es-419', sx: 'sat', mne: 'sr-ME'};

export function subtitleLanguage(code) {
  const raw = String(code || '').trim();
  return ALIASES[raw.toLowerCase()] || raw;
}

/** The add-ons to ask: every enabled add-on with subtitles, plus OpenSubtitles when on and not installed. */
export function subtitleAddons(addons, {builtIn = true} = {}) {
  const list = addons.map(a => ({url: a.url, name: a.name}));
  if (builtIn && !list.some(a => a.url === OPENSUBTITLES)) list.push({url: OPENSUBTITLES, name: 'OpenSubtitles'});
  return list;
}

// An add-on's answer is its own claim: a list is cut to a size a menu can
// show, its words to lengths a row can hold, and only web addresses are kept.
const MAX_ENTRIES = 300;
const words = (value, max) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '').slice(0, max);

/** A subtitle file's address when it is a plain web address (http or https, no sign-in part); '' otherwise. */
export function subtitleAddress(url) {
  if (typeof url !== 'string' || url.length > 4096) return '';
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) && u.hostname && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}

/**
 * Asks every subtitle add-on at once. onList(entries) is called as each
 * answers. Entries: {url, language, label, source, exact, name}.
 * `facts` may carry {videoHash, videoSize, filename}.
 */
export async function fetchSubtitles(addons, type, id, facts = {}, {signal, onList = () => {}, timeout = 12000} = {}) {
  const extra = {};
  if (facts.videoHash) extra.videoHash = facts.videoHash;
  if (facts.videoSize) extra.videoSize = String(facts.videoSize);
  if (facts.filename) extra.filename = facts.filename;
  const seen = new Set();
  const all = [];
  await Promise.allSettled(addons.map(async addon => {
    const manifest = await fetchManifest(addon.url, {signal, timeout});
    if (!supports(manifest, 'subtitles', type, id)) return;
    const data = await getJson(resourceUrl(addon.url, 'subtitles', type, id, extra), {signal, timeout});
    const source = words(manifest.name, 60) || words(addon.name, 60) || 'Add-on';
    const entries = [];
    for (const s of Array.isArray(data?.subtitles) ? data.subtitles : []) {
      if (entries.length >= MAX_ENTRIES) break;
      const url = s && subtitleAddress(s.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      entries.push({url, language: subtitleLanguage(words(s.lang, 35)), label: words(s.label, 120), source, exact: s.m === 'h', name: words(s.subtitleFileName || s.releaseName || s.movieReleaseName, 120)});
    }
    if (entries.length) { all.push(...entries); onList(entries); }
  }));
  return all;
}

export const MAX_SUBTITLE_BYTES = 8 << 20; // the largest subtitle file Astra reads; a film's text is well under 1 MB

/** An Error whose message can be shown as it is (it never holds the address) and whose `kind` says what went wrong. */
const refused = (kind, message) => Object.assign(Error(message), {kind});
// What a server calls films, sound, pictures and archives: never subtitle text.
const NOT_TEXT = /^(video|audio|image|font)\/|^application\/(zip|gzip|pdf|x-(rar|7z|gzip|tar|bzip2?|xz)[\w.-]*|vnd\.rar|x-matroska|mp4|ogg|vnd\.apple\.mpegurl|dash\+xml)\b/i;

/** True for bytes that are not text: an archive, a film, or control bytes text never holds. UTF-16 (zeros in every other byte) is text. */
export function looksBinary(bytes) {
  const n = Math.min(bytes.length, 4096);
  if (n >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) return false;
  let odd = 0, even = 0, control = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) { if (i & 1) odd++; else even++; }
    else if (b < 9 || (b > 13 && b < 32 && b !== 27)) control++;
  }
  const zeros = odd + even;
  if (zeros && Math.max(odd, even) < zeros * 0.95) return true; // zeros on both sides are not UTF-16
  return control > 1 + n / 50;
}

/**
 * Downloads a chosen subtitle file, as bytes. The address, the type and the
 * size are the add-on's and the server's to claim, so: only http(s), nothing
 * the server calls a film, a sound, a picture or an archive, never more than
 * `maxBytes` read (the download is stopped there), and nothing that is not
 * text. Throws an Error with `kind`: 'address', 'http', 'type', 'size',
 * 'binary', or the browser's own error for a failed or timed-out request.
 */
export async function downloadSubtitle(url, {signal, timeout = 20000, maxBytes = MAX_SUBTITLE_BYTES} = {}) {
  const address = subtitleAddress(url);
  if (!address) throw refused('address', 'This is not a web address.');
  const timer = AbortSignal.timeout(timeout);
  const response = await fetch(address, {signal: signal ? AbortSignal.any([signal, timer]) : timer, credentials: 'omit', referrerPolicy: 'no-referrer'});
  const stop = error => { response.body?.cancel().catch(() => {}); return error; };
  if (!response.ok) throw stop(Object.assign(refused('http', `The server answered ${response.status}.`), {status: response.status}));
  if (NOT_TEXT.test((response.headers.get('content-type') || '').trim())) throw stop(refused('type', 'This is not a subtitle file.'));
  if (+response.headers.get('content-length') > maxBytes) throw stop(refused('size', 'This file is too large to be subtitles.'));
  const reader = response.body?.getReader();
  if (!reader) { // no stream to count: the length is checked once it is all here
    const all = new Uint8Array(await response.arrayBuffer());
    if (all.length > maxBytes) throw refused('size', 'This file is too large to be subtitles.');
    if (looksBinary(all)) throw refused('binary', 'This is not a subtitle file.');
    return all;
  }
  const chunks = [];
  let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.length;
    // The length header can be missing or untrue: count what arrives.
    if (size > maxBytes) { reader.cancel().catch(() => {}); throw refused('size', 'This file is too large to be subtitles.'); }
    if (!chunks.length && looksBinary(value)) { reader.cancel().catch(() => {}); throw refused('binary', 'This is not a subtitle file.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes;
}

/**
 * A subtitle file's text: UTF-8, UTF-16, else the language's legacy code page
 * when the bytes fit it (see ../subtitles/charset.js). `language` is a hint:
 * an add-on's code ('gre', 'pob', 'zht'), or the language the viewer chose.
 */
export function decodeSubtitleBytes(bytes, language = '') {
  return decodeText(bytes, subtitleLanguage(language));
}
