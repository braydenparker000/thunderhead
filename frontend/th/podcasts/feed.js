// @ts-check
// Reading a podcast feed (PODCASTS.md §4; harvested from the old Worker's backend/podcasts.js, the
// same rules and results). One module, run on the phone (the Podcasts worker parses the feeds the
// new Worker passes through, §4.1: a big feed would cost the Worker more than its 10 ms) and in the
// Worker (an episode's audio is found in its feed, never taken from the caller, §4.4). DTDs and
// entities are refused; CDATA and comments never hide or end an item; only public http(s)
// addresses come out (§3.2's guard, checked again on every redirect by the Worker).

export class FeedError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/** A public http(s) address without credentials, port or private host, hash dropped; else FeedError 400. @param {string} value */
export function publicURL(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new FeedError('Enter a valid public RSS feed URL.', 400);
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (
    !['https:', 'http:'].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.port ||
    value.length > 2000 ||
    !host.includes('.') ||
    /^[\d.]+$/.test(host) ||
    host.includes(':') ||
    host.includes('[') ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|onion)$/.test(host) ||
    /(?:^|\.)(?:nip\.io|sslip\.io|localtest\.me|lvh\.me)$/.test(host) ||
    host === 'metadata.google.internal'
  )
    throw new FeedError('Only public podcast feed addresses are supported.', 400);
  u.hash = '';
  return u.href;
}

/** A public address, or '' (an artwork, a website, an enclosure). @param {string} value */
export const optionalURL = (value) => {
  if (!value) return '';
  try {
    return publicURL(value);
  } catch {
    return '';
  }
};

const ENTITIES = /** @type {Record<string, string>} */ ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' });
/** @param {unknown} s */
export const decodeXML = (s) =>
  String(s || '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, code) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] || all;
    const n = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
/** @param {string} s */
const text = (s, max = 3000) =>
  decodeXML(decodeXML(s).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
/** @param {string} xml @param {string} name */
const tag = (xml, name) => new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}\\s*>`, 'i').exec(xml)?.[1] || '';
/** @param {string} xml @param {string} name */
const attr = (xml, name) => decodeXML(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(xml)?.[2] || '');
/** @param {string} xml */
const image = (xml) => optionalURL(attr(/<itunes:image\b[^>]*>/i.exec(xml)?.[0] || '', 'href') || tag(tag(xml, 'image'), 'url'));

/** Comments dropped and CDATA set aside, so element searches never look inside notes. @param {string} raw */
function maskCDATA(raw) {
  /** @type {string[]} */
  const values = [];
  const xml = raw.replace(/<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, value) =>
    value === undefined ? '' : `TH_CDATA_${values.push(value) - 1}_END`,
  );
  return { xml, read: (/** @type {string} */ name) => tag(xml, name).replace(/TH_CDATA_(\d+)_END/g, (_, i) => values[Number(i)] || '') };
}

const PARTS = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\/?item\b[^>]*>/gi;
/** The items one at a time, as far as asked, in a pass that skips CDATA and comments (a literal `</item>` in notes); a cut-off last item is not one. @param {string} raw */
function* itemsOf(raw) {
  let start = -1;
  for (const m of raw.matchAll(PARTS)) {
    if (!/^<\/?item\b/i.test(m[0])) continue;
    const at = m.index ?? 0;
    if (!m[0].startsWith('</')) {
      if (start < 0) start = at + m[0].length;
    } else if (start >= 0) {
      yield raw.slice(start, at);
      start = -1;
    }
  }
}
/** The channel's header: everything before its first item. @param {string} raw */
function headerOf(raw) {
  for (const m of raw.matchAll(PARTS)) if (/^<item\b/i.test(m[0])) return raw.slice(0, m.index);
  return raw;
}

/** A stable 16-hex id (FNV-1a and djb2) of a guid, an audio address or a feed address. @param {string} s */
export function episodeID(s) {
  let a = 2166136261;
  let b = 5381;
  for (let i = 0; i < s.length; i++) {
    a = Math.imul(a ^ s.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ s.charCodeAt(i);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/** `1:02:03`, `4:30` or `120` as seconds (at most a week); 0 when unreadable. @param {unknown} value */
export function durationSeconds(value) {
  const parts = String(value).trim().split(':').map(Number);
  if (parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return 0;
  return Math.min(
    parts.reduce((n, v) => n * 60 + v, 0),
    604800,
  );
}

/**
 * The show and a page of its playable episodes (newest first as the feed lists them; at most 200
 * items are read), or with `id` just that episode.
 * @param {string} raw @param {string} feedUrl
 * @param {{ offset?: number, limit?: number, id?: string | null }} [options]
 */
export function parseFeed(raw, feedUrl, { offset = 0, limit = 200, id: selectedID } = {}) {
  if (/<!DOCTYPE|<!ENTITY/i.test(raw)) throw new FeedError('This feed uses unsupported XML declarations.');
  if (!/<rss\b/i.test(raw) || !/<channel\b/i.test(raw)) throw new FeedError('This address did not return a podcast RSS feed.', 400);
  const header = maskCDATA(headerOf(raw));
  const read = header.read;
  const show = {
    id: episodeID(feedUrl),
    feedUrl,
    title: text(read('title'), 300) || 'Podcast',
    author: text(read('itunes:author') || read('managingEditor'), 200),
    description: text(read('description')),
    artwork: image(header.xml),
    website: optionalURL(decodeXML(read('link')).trim()),
    language: text(read('language'), 50),
  };
  const episodes = [];
  const seen = new Set();
  let index = -1;
  let more = false;
  // At most 200 items are read; a page stops one past its end, an episode asked for at itself.
  for (const rawItem of itemsOf(raw)) {
    if (++index >= 200) break;
    if (!selectedID && index < offset) continue;
    if (!selectedID && index >= offset + limit) {
      more = true;
      break;
    }
    const masked = maskCDATA(rawItem);
    const item = masked.xml;
    const read = masked.read;
    const enclosure = /<enclosure\b[^>]*>/i.exec(item)?.[0] || '';
    const audioUrl = optionalURL(attr(enclosure, 'url'));
    const type = attr(enclosure, 'type').toLowerCase();
    if (!audioUrl || (type && !type.startsWith('audio/') && !['application/octet-stream', 'application/ogg'].includes(type))) continue;
    const id = episodeID(decodeXML(read('guid')).trim() || audioUrl);
    if (selectedID && id !== selectedID) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const date = Date.parse(text(read('pubDate')));
    episodes.push({
      id,
      title: text(read('title'), 500) || 'Untitled episode',
      description: text(read('content:encoded') || read('description'), 7000),
      audioUrl,
      type: type || 'audio/mpeg',
      publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : '',
      duration: durationSeconds(text(read('itunes:duration'))),
      bytes: Math.max(0, Number(attr(enclosure, 'length')) || 0),
      artwork: image(item) || show.artwork,
      website: optionalURL(decodeXML(read('link')).trim()),
    });
    if (selectedID || episodes.length >= 200) break;
  }
  return {
    show,
    episodes,
    nextOffset: !selectedID && more && offset + limit < 200 ? offset + limit : null,
  };
}
