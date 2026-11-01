// Counts mode (NEXT-BATCH.md part 7, RUNTIME.md §12.1): how many episodes a followed show published
// after a time, read from as little of its feed as needed, so the night gets numbers and never the
// feed's words (`GET /v1/podcasts/feed?…&count=1`). An episode is an RSS `<item>` (its date
// `<pubDate>`) or an Atom `<entry>` (`<published>`, else `<updated>`) with an enclosure (RSS
// `<enclosure url>`, Atom `<link rel="enclosure" href>`), as the phone's reader counts them. Its id
// is the phone's (th/podcasts/feed.js: the guid, else the enclosure's address; Atom: its `<id>`), so
// the Worker can leave out what a phone has started. Bounded: at most `COUNT_BYTES` of the body and
// `COUNT_MS` of reading; it stops once it has seen `OLDER_ENOUGH` episodes from before the time
// (feeds list the newest first). CDATA and comments never end an item. Linear in the bytes read,
// whatever they hold (walk): no regex scans past an unclosed tag, comment or CDATA. Plain TypeScript
// (no parameter properties or enums), so mind/tests can load it as the fake Worker's counter.
import { decodeXML, episodeID, optionalURL } from '../../../../frontend/th/podcasts/feed.js';

export const COUNT_BYTES = 256 * 1024;
export const COUNT_MS = 8_000;
/** Episodes from before the time, after which the rest of the feed is older still. */
const OLDER_ENOUGH = 5;
/** A date past now and this is a scheduled one: it doesn't count yet. */
const AHEAD_MS = 3_600_000;
/** An item, a tag or a value longer than these is no episode's (real ones are a few KB at most). */
const ITEM_MAX = 64 * 1024;
const TAG_MAX = 4096;
const VALUE_MAX = 2048;
/** The buffer is scanned again only once this much more has arrived (or at its end), so a host
 * that sends a byte at a time can't make the scan quadratic. */
const SCAN_STEP = 16 * 1024;

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
  /** The newest publication time seen (after 1970, not ahead of now), or null. */
  latest_at: number | null;
}

interface Tag {
  name: string;
  closing: boolean;
  start: number;
  end: number;
}

const NAME = /^<\/?([A-Za-z][\w:.-]*)/;

/** Calls `fn` for each tag of `s` from `at`, in order, with comments and CDATA skipped whole; stops
 * when `fn` returns false. Linear: every step jumps past the `>` it found, and an unclosed tag,
 * comment or CDATA section ends the walk (no rescans to the end). Returns where it stopped: the start
 * of what is still open, else the end. */
function walk(s: string, at: number, fn: (t: Tag) => boolean | undefined): number {
  let i = at;
  for (;;) {
    const lt = s.indexOf('<', i);
    if (lt < 0) return s.length;
    if (s.startsWith('<![CDATA[', lt) || s.startsWith('<!--', lt)) {
      const cdata = s[lt + 2] === '[';
      const close = s.indexOf(cdata ? ']]>' : '-->', lt + (cdata ? 9 : 4));
      if (close < 0) return lt;
      i = close + 3;
      continue;
    }
    const gt = s.indexOf('>', lt + 1);
    if (gt < 0) return lt;
    const m = NAME.exec(s.slice(lt, Math.min(gt + 1, lt + 80)));
    if (m && fn({ name: m[1].toLowerCase(), closing: s[lt + 1] === '/', start: lt, end: gt + 1 }) === false)
      return gt + 1;
    i = gt + 1;
  }
}

/** The text of a value, CDATA unwrapped and entities decoded; '' when too long. Linear. */
function text(raw: string): string {
  if (raw.length > VALUE_MAX) return '';
  let out = '';
  let i = 0;
  for (;;) {
    const a = raw.indexOf('<![CDATA[', i);
    if (a < 0) return decodeXML(out + raw.slice(i)).trim();
    const b = raw.indexOf(']]>', a + 9);
    if (b < 0) return decodeXML(out + raw.slice(i, a) + raw.slice(a + 9)).trim();
    out += raw.slice(i, a) + raw.slice(a + 9, b);
    i = b + 3;
  }
}

/** An attribute's value in a tag of at most TAG_MAX characters (no lazy matching: linear). */
const attrOf = (tag: string, name: string) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return decodeXML(m?.[1] ?? m?.[2] ?? '');
};

/** One item's or entry's time and id, or null when it is no episode (no enclosure). One linear walk
 * over the item: the first of each value and of the enclosure, tags inside CDATA and comments
 * never counted. */
export function episodeOf(block: string, atom: boolean): { id: string; at: number } | null {
  if (block.length > ITEM_MAX) return null;
  const want = atom ? ['id', 'published', 'updated'] : ['guid', 'pubdate'];
  const open = new Map<string, number>();
  const val = new Map<string, string>();
  let enclosure = '';
  walk(block, 0, (t) => {
    const tag = block.slice(t.start, t.end);
    if (!t.closing) {
      if (!enclosure && tag.length <= TAG_MAX) {
        if (!atom && t.name === 'enclosure') enclosure = tag;
        else if (atom && t.name === 'link' && /\brel\s*=\s*["']enclosure["']/i.test(tag)) enclosure = tag;
      }
      if (want.includes(t.name) && !val.has(t.name) && !tag.endsWith('/>')) open.set(t.name, t.end);
    } else if (open.has(t.name) && !val.has(t.name)) {
      val.set(t.name, text(block.slice(open.get(t.name), t.start)));
    }
    return undefined;
  });
  if (atom) {
    const audio = enclosure ? optionalURL(attrOf(enclosure, 'href')) : '';
    if (!audio) return null;
    const at = Date.parse(val.get('published') || val.get('updated') || '');
    return { id: episodeID(val.get('id') || audio), at };
  }
  const audio = optionalURL(attrOf(enclosure, 'url'));
  const type = attrOf(enclosure, 'type').toLowerCase();
  if (!audio || (type && !type.startsWith('audio/') && !['application/octet-stream', 'application/ogg'].includes(type)))
    return null;
  return { id: episodeID(val.get('guid') || audio), at: Date.parse(val.get('pubdate') || '') };
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
  let scanned = 0;
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
      // Out of time: what has come is scanned once more, then that is all.
      if (next === 'late') {
        timedOut = true;
        done = true;
      } else if (next.done) done = true;
      else {
        read += next.value.byteLength;
        buf += decoder.decode(next.value, { stream: true });
        if (read >= bounds.bytes) done = true;
      }
      // Scan once enough more has come (or at the end): each scan is linear (walk).
      if (!done && buf.length - scanned < SCAN_STEP) continue;
      scanned = buf.length;
      if (!marked) {
        if (/<!DOCTYPE|<!ENTITY/i.test(buf)) throw new CountError('not_a_feed');
        marked = /<rss\b|<feed\b/i.test(buf);
      }
      pos = walk(buf, pos, (t) => {
        if (t.name !== 'item' && t.name !== 'entry') return undefined;
        if (!t.closing && open < 0) {
          open = t.end;
          kind = t.name;
        } else if (t.closing && open >= 0 && t.name === kind) {
          const e = episodeOf(buf.slice(open, t.start), kind === 'entry');
          open = -1;
          if (!e || !Number.isFinite(e.at) || e.at <= 0 || e.at > now + AHEAD_MS) return undefined;
          out.latest_at = Math.max(out.latest_at ?? 0, e.at);
          if (e.at > since) out.newer.push(e);
          else if (++older >= OLDER_ENOUGH) return false;
        }
        return undefined;
      });
      // What was scanned is not kept, except an item still open.
      const keep = open >= 0 ? open : pos;
      if (keep > 64 * 1024) {
        buf = buf.slice(keep);
        if (open >= 0) open -= keep;
        pos -= keep;
        scanned -= keep;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!marked) throw new CountError(timedOut ? 'too_slow' : 'not_a_feed');
  if (timedOut && out.newer.length === 0 && out.latest_at === null) throw new CountError('too_slow');
  return out;
}
