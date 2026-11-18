// What a stream's link says about its file, read from the link alone (pure: it asks no one and never
// throws): the torrent's hash (40 hex, lower case), the file's index in the torrent, its name and its
// size, each null when the link does not say. The page sends these with the link to the owner's own
// server (addons/debrid.js), so the server can ask TorBox for that file directly.
//
// Shapes it knows (every example in the tests is invented):
// - AIOStreams' own playback link: …/api/v1/debrid/playback/{sealed}/-/{base64url JSON}/{id}/{file name},
//   the JSON holding the hash and the file's index (other spellings and a nested shape are read too);
// - Comet: …/playback/{hash}/{service}/{index}/{season}/{episode};
// - MediaFusion: …/streaming_provider/…/playback/{hash}/… (what follows the hash is a season and an
//   episode, never a file's index);
// - Torrentio: …/resolve/{service}/{key}/{hash}/…/{index}/{file name};
// - StremThru: …/strem/{hash}/{index}/{file name};
// - anything else: exactly one 40-hex (or 32-character base32) path segment, or a query value whose
//   name says hash (info_hash=, btih=…).
// Two different hashes anywhere in the link make it unclear which file is meant: hash and index are null.

const HEX = /^[0-9a-f]{40}$/i;
const BASE32 = /^[A-Z2-7]{32}$/i;
const BASE32_UPPER = /^[A-Z2-7]{32}$/; // in a path, only upper case: 32 lower-case letters are more often a word or a key
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const HASH_KEY = /^(info_?hash|hash|btih|ih)$/i;
const INDEX_KEY = /^(file_?idx|file_?index|index|idx)$/i;
const FILE = /^[^\\/:*?"<>|\u0000-\u001f]{1,240}\.(mkv|mp4|m4v|avi|webm|mov|ts|m2ts|mts|wmv|flv|mpe?g|ogv|3gp|rmvb|divx|vob)$/i;

/** A 32-character base32 hash (as magnet links write it) as 40 hex, lower case. */
export function base32Hex(text) {
  let out = '', bits = 0, value = 0;
  for (const c of String(text).toUpperCase()) {
    value = (value << 5) | ALPHABET.indexOf(c);
    bits += 5;
    while (bits >= 4) { bits -= 4; out += ((value >> bits) & 15).toString(16); }
    value &= (1 << bits) - 1;
  }
  return out;
}

/** A hash from a value: 40 hex, or 32 base32 (`upperOnly`: as a path writes it); else null. */
function hashOf(value, upperOnly = false) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (HEX.test(s)) return s.toLowerCase();
  return (upperOnly ? BASE32_UPPER : BASE32).test(s) ? base32Hex(s) : null;
}

/** A file's index: a whole number from 0, as a number or digits. */
function indexOf(value) {
  const n = typeof value === 'string' && /^\d{1,6}$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(n) && n >= 0 && n < 1e6 ? n : null;
}

const decoded = segment => { try { return decodeURIComponent(segment); } catch { return segment; } };

/** A path segment as JSON, when it is base64url (or base64) of a JSON object; else null. */
function jsonOf(segment) {
  if (segment.length < 16 || segment.length > 16384 || !/^[A-Za-z0-9_+/-]+={0,2}$/.test(segment)) return null;
  try {
    const b64 = segment.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
    const text = new TextDecoder('utf-8', {fatal: true}).decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}

/** The hashes and the first file index in a JSON value, nearest the top first (a few levels, a few hundred values). */
function readJson(root) {
  const hashes = [];
  let index = null, seen = 0;
  const queue = [[root, 0]];
  while (queue.length && seen < 400) {
    const [value, depth] = queue.shift();
    for (const [key, v] of Object.entries(value)) {
      seen++;
      if (HASH_KEY.test(key)) { const h = hashOf(v); if (h) hashes.push(h); }
      else if (INDEX_KEY.test(key) && index === null) index = indexOf(v);
      else if (v && typeof v === 'object' && depth < 4) queue.push([v, depth + 1]);
    }
  }
  return {hashes, index};
}

/** What the known shapes say: {hash, index, hashes (every hash a shape read)}. */
function fromShape(segments) {
  const at = name => segments.indexOf(name);
  const playback = at('playback');
  // AIOStreams: the JSON segment after "playback" (the sealed one before it decodes to no JSON).
  if (playback > 1 && segments[playback - 1] === 'debrid') {
    for (const s of segments.slice(playback + 1)) {
      const json = jsonOf(s);
      if (!json) continue;
      const {hashes, index} = readJson(json);
      if (hashes.length || index !== null) return {hash: hashes[0] ?? null, index, hashes};
    }
    return {hash: null, index: null, hashes: []};
  }
  // MediaFusion: the hash after "playback"; what follows is a season and an episode.
  if (at('streaming_provider') >= 0 && playback >= 0) return {hash: hashOf(segments[playback + 1], true), index: null, hashes: []};
  // Comet: the hash, the service's name, then the index (a version without the service has the index first).
  if (playback >= 0) {
    const hash = hashOf(segments[playback + 1], true);
    if (hash) return {hash, index: indexOf(segments[playback + 2]) ?? indexOf(segments[playback + 3]), hashes: []};
  }
  // Torrentio: /resolve/{service}/{key}/{hash}/{what it has}/{index}/{file name}.
  const resolve = at('resolve');
  if (resolve >= 0) {
    const hash = hashOf(segments[resolve + 3], true), tail = segments.slice(resolve + 4);
    if (hash) return {hash, index: tail.length >= 2 ? indexOf(tail.at(-2)) : null, hashes: []};
  }
  // StremThru: …/strem/{hash}/{index}/{file name}.
  const strem = at('strem');
  if (strem >= 0) {
    const hash = hashOf(segments[strem + 1], true);
    if (hash) return {hash, index: indexOf(segments[strem + 2]), hashes: []};
  }
  return {hash: null, index: null, hashes: []};
}

function fileNameOf(stream, segments) {
  const given = typeof stream?.filename === 'string' ? stream.filename.split(/[\\/]/).pop().trim() : '';
  if (given) return given.slice(0, 255);
  const last = segments.at(-1) || '';
  return FILE.test(last) ? last : null;
}

const sizeOf = stream => { const n = Number(stream?.size); return Number.isSafeInteger(n) && n > 0 ? n : null; };

/**
 * What `url` (a stream's link) and `stream` (Astra's stream: `filename`, `size`) say about the file.
 * @param {string} url @param {{filename?: string, size?: number | null}} [stream]
 * @returns {{hash: string | null, fileIndex: number | null, fileName: string | null, fileSize: number | null}}
 */
export function linkFacts(url, stream = {}) {
  const facts = {hash: null, fileIndex: null, fileName: null, fileSize: null};
  try {
    facts.fileSize = sizeOf(stream);
    let u = null;
    try { u = new URL(url); } catch {}
    const segments = u ? u.pathname.split('/').filter(Boolean).map(decoded) : [];
    facts.fileName = fileNameOf(stream, segments);
    if (!u) return facts;
    const shape = fromShape(segments);
    // Every hash the link holds, wherever it is: one hash names the file; two leave it unclear.
    const all = new Set([shape.hash, ...shape.hashes].filter(Boolean));
    for (const s of segments) { const h = hashOf(s, true); if (h) all.add(h); }
    for (const [key, value] of u.searchParams) if (/hash|btih/i.test(key)) { const h = hashOf(value); if (h) all.add(h); }
    if (all.size === 1) {
      facts.hash = [...all][0];
      facts.fileIndex = shape.index;
    } else if (all.size === 0) facts.fileIndex = shape.index;
  } catch {}
  return facts;
}
