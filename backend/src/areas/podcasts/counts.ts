// Counts mode (NEXT-BATCH.md part 7, RUNTIME.md §12.1): how many episodes a followed show published
// after a time, read from as little of its feed as needed, so the night gets numbers and never the
// feed's words (`GET /v1/podcasts/feed?…&count=1`). An episode is an RSS `<item>` (its date
// `<pubDate>`) or an Atom `<entry>` (`<published>`, else `<updated>`) with an enclosure (RSS
// `<enclosure url>`, Atom `<link rel="enclosure" href>`), as the phone's reader counts them. Its id
// is the phone's (th/podcasts/feed.js: the guid, else the enclosure's address; Atom: its `<id>`), so
// the Worker can leave out what a phone has started. Bounded: at most `COUNT_BYTES` of the body and
// `COUNT_MS` of reading; it stops once it has seen `OLDER_ENOUGH` episodes from before the time
// (feeds list the newest first). CDATA and comments never end an item. Plain TypeScript (no
// parameter properties or enums), so mind/tests can load it as the fake Worker's counter.
import { decodeXML, episodeID, optionalURL } from '../../../../frontend/th/podcasts/feed.js';

export const COUNT_BYTES = 512 * 1024;
export const COUNT_MS = 8_000;
/** Episodes from before the time, after which the rest of the feed is older still. */
const OLDER_ENOUGH = 5;
/** A date past now and this is a scheduled one: it doesn't count yet. */
const AHEAD_MS = 3_600_000;

/** Why a feed couldn't be counted: a fixed word, never anything the host sent. */
export type CountReason = 'not_a_feed' | 'too_slow' | 'unreachable';
export class CountError extends Error {
  reason: CountReason;
  constructor(reason: CountReason) {
    super(reason);
    this.reason = reason;
  }
}

export interface FeedCounts {
  /** The episodes published after the time (and not ahead of now), newest first as listed. */
  newer: { id: string; at: number }[];
  /** The newest publication time seen (not ahead of now), or null. */
  latest_at: number | null;
}

const TOKENS = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\/?(item|entry)\b[^>]*>/gi;
const inner = (xml: string, name: string) =>
  new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}\\s*>`, 'i').exec(xml)?.[1] ?? '';
const cdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const value = (xml: string, name: string) => decodeXML(cdata(inner(xml, name))).trim();
const attrOf = (tag: string, name: string) =>
  decodeXML(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(tag)?.[2] ?? '');

/** One item's or entry's time and id, or null when it is no episode (no enclosure). */
export function episodeOf(block: string, atom: boolean): { id: string; at: number } | null {
  // Notes can hold anything: tags are looked for outside CDATA and comments only.
  const xml = block.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, (m) => (m.startsWith('<!--') ? '' : m));
  const bare = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  if (atom) {
    const link = [...bare.matchAll(/<link\b[^>]*>/gi)]
      .map((m) => m[0])
      .find((t) => /rel\s*=\s*["']enclosure["']/i.test(t));
    const audio = link ? optionalURL(attrOf(link, 'href')) : '';
    if (!audio) return null;
    const at = Date.parse(value(xml, 'published') || value(xml, 'updated'));
    return { id: episodeID(value(xml, 'id') || audio), at };
  }
  const enclosure = /<enclosure\b[^>]*>/i.exec(bare)?.[0] ?? '';
  const audio = optionalURL(attrOf(enclosure, 'url'));
  const type = attrOf(enclosure, 'type').toLowerCase();
  if (!audio || (type && !type.startsWith('audio/') && !['application/octet-stream', 'application/ogg'].includes(type)))
    return null;
  return { id: episodeID(value(xml, 'guid') || audio), at: Date.parse(value(xml, 'pubDate')) };
}

/** Reads the body as far as it must (within the bounds) and counts. Throws CountError. */
export async function countFeed(
  body: ReadableStream<Uint8Array>,
  since: number,
  now: number,
  bounds: { bytes: number; ms: number } = { bytes: COUNT_BYTES, ms: COUNT_MS },
): Promise<FeedCounts> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + bounds.ms;
  const out: FeedCounts = { newer: [], latest_at: null };
  let buf = '';
  let read = 0;
  let pos = 0;
  let open = -1;
  let kind = '';
  let older = 0;
  let marked = false;
  let done = false;
  let timedOut = false;
  try {
    while (!done && older < OLDER_ENOUGH) {
      const left = deadline - Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([
        reader.read(),
        new Promise<'late'>((r) => {
          timer = setTimeout(() => r('late'), Math.max(0, left));
        }),
      ]);
      clearTimeout(timer);
      if (next === 'late') {
        timedOut = true;
        break;
      }
      if (next.done) done = true;
      else {
        read += next.value.byteLength;
        buf += decoder.decode(next.value, { stream: true });
        if (read >= bounds.bytes) done = true;
      }
      if (!marked) {
        if (/<!DOCTYPE|<!ENTITY/i.test(buf)) throw new CountError('not_a_feed');
        marked = /<rss\b|<feed\b/i.test(buf);
      }
      // Only up to a CDATA section still open at the end: a `</item>` inside it is no end.
      const unclosed = buf.lastIndexOf('<![CDATA[');
      const end = unclosed >= pos && buf.indexOf(']]>', unclosed) < 0 ? unclosed : buf.length;
      TOKENS.lastIndex = pos;
      for (let m = TOKENS.exec(buf); m && m.index < end; m = TOKENS.exec(buf)) {
        if (m.index + m[0].length > end) break;
        pos = m.index + m[0].length;
        if (!m[1]) continue;
        const closing = m[0].startsWith('</');
        if (!closing && open < 0) {
          open = pos;
          kind = m[1].toLowerCase();
        } else if (closing && open >= 0 && m[1].toLowerCase() === kind) {
          const e = episodeOf(buf.slice(open, m.index), kind === 'entry');
          open = -1;
          if (!e) continue;
          if (!Number.isFinite(e.at) || e.at > now + AHEAD_MS) continue;
          out.latest_at = Math.max(out.latest_at ?? 0, e.at);
          if (e.at > since) out.newer.push(e);
          else older++;
        }
      }
      // What was scanned is not kept, except an item still open.
      const keep = open >= 0 ? open : pos;
      if (keep > 64 * 1024) {
        buf = buf.slice(keep);
        if (open >= 0) open -= keep;
        pos -= keep;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!marked) throw new CountError(timedOut ? 'too_slow' : 'not_a_feed');
  if (timedOut && out.newer.length === 0 && out.latest_at === null) throw new CountError('too_slow');
  return out;
}
