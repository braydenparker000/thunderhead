// Counts mode's reader (areas/podcasts/counts.ts): new episodes after a time, from RSS and Atom, with
// the phone's own ids (so started ones can be left out), dates missing or ahead skipped, CDATA and
// comments never ending an item, and bounded: a 5 MB feed is read only as far as it must, a slow one
// gives up in time, garbage and DTDs are no feed. Synthetic feeds only.
import { describe, expect, it } from 'vitest';
import { parseFeed } from '../../../frontend/th/podcasts/feed.js';
import { CountError, countFeed, episodeOf } from '../../src/areas/podcasts/counts';

const NOW = Date.parse('2026-11-01T06:00:00Z');
const H = 3_600_000;
const day = (h: number) => new Date(NOW - h * H).toUTCString();
const iso = (h: number) => new Date(NOW - h * H).toISOString();
const stream = (text: string, chunk = 1000) => {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (at >= bytes.length) return c.close();
      c.enqueue(bytes.subarray(at, at + chunk));
      at += chunk;
    },
  });
};
const item = (n: number, hoursAgo: number | null, extra = '') =>
  `<item><title>Invented ${n}</title><guid>g-${n}</guid>${hoursAgo === null ? '' : `<pubDate>${day(hoursAgo)}</pubDate>`}<enclosure url="https://media.example.org/${n}.mp3" type="audio/mpeg"/>${extra}</item>`;
const rss = (items: string) =>
  `<?xml version="1.0"?><rss><channel><title>Invented Show</title>${items}</channel></rss>`;
const count = async (text: string, since: number, bounds?: { bytes: number; ms: number }) =>
  countFeed(stream(text), since, NOW, bounds);
const reason = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'counted';
  } catch (e) {
    return e instanceof CountError ? e.reason : String(e);
  }
};

describe('counting new episodes', () => {
  it('RSS: the episodes after the time, the newest time seen, the phone’s own ids', async () => {
    const feed = rss([item(1, 2), item(2, 10), item(3, 30), item(4, 50)].join(''));
    const got = await count(feed, NOW - 24 * H);
    expect(got.newer.map((e) => e.id)).toEqual(
      parseFeed(feed, 'https://feeds.example.org/a.xml')
        .episodes.slice(0, 2)
        .map((e) => e.id),
    );
    expect(got.latest_at).toBe(Date.parse(day(2)));
  });

  it('Atom: entries with an enclosure, by published, else updated', async () => {
    const entry = (n: number, date: string, enclosure = true) =>
      `<entry><id>urn:invented:${n}</id><title>Invented ${n}</title>${date}${enclosure ? `<link rel="enclosure" href="https://media.example.org/${n}.m4a" type="audio/mp4"/>` : ''}<link rel="alternate" href="https://example.org/${n}"/></entry>`;
    const feed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Invented</title>${[
      entry(1, `<published>${iso(1)}</published><updated>${iso(0.5)}</updated>`),
      entry(2, `<updated>${iso(5)}</updated>`),
      entry(3, `<published>${iso(3)}</published>`, false),
      entry(4, `<published>${iso(40)}</published>`),
    ].join('')}</feed>`;
    const got = await count(feed, NOW - 24 * H);
    expect(got.newer.length).toBe(2);
    expect(got.latest_at).toBe(Date.parse(iso(1)));
  });

  it('missing or unreadable dates, scheduled ones, and items with no audio are not counted', async () => {
    const feed = rss(
      [
        item(1, null),
        item(2, 1).replace(/<pubDate>[^<]*/, '<pubDate>not a date'),
        item(3, -5),
        `<item><guid>g-4</guid><pubDate>${day(1)}</pubDate><enclosure url="https://media.example.org/4.html" type="text/html"/></item>`,
        `<item><guid>g-5</guid><pubDate>${day(1)}</pubDate></item>`,
        item(6, 2),
      ].join(''),
    );
    const got = await count(feed, NOW - 24 * H);
    expect(got.newer).toEqual([{ id: expect.any(String), at: Date.parse(day(2)) }]);
  });

  it('CDATA and comments never end an item, and their text is never a field', async () => {
    const notes = `<description><![CDATA[a literal </item> and <pubDate>${day(0)}</pubDate> in the notes]]></description><!-- </item> -->`;
    const feed = rss(item(1, 3, notes) + item(2, 30));
    const got = await count(feed, NOW - 24 * H);
    expect(got.newer.map((e) => e.at)).toEqual([Date.parse(day(3))]);
    // A guid in CDATA is the phone's id too.
    const e = episodeOf(`<guid><![CDATA[g-9]]></guid><enclosure url="https://media.example.org/9.mp3"/>`, false);
    const phone = parseFeed(
      rss(`<item><guid><![CDATA[g-9]]></guid><enclosure url="https://media.example.org/9.mp3"/></item>`),
      'https://feeds.example.org/a.xml',
    );
    expect(e?.id).toBe(phone.episodes[0].id);
  });

  it('garbage, HTML and DTDs are no feed', async () => {
    expect(await reason(count('{"not":"xml"}', 0))).toBe('not_a_feed');
    expect(await reason(count('<html><body>Moved</body></html>', 0))).toBe('not_a_feed');
    expect(await reason(count(`<!DOCTYPE rss [<!ENTITY x "y">]>${rss(item(1, 1))}`, 0))).toBe('not_a_feed');
    expect(await count(rss(''), 0)).toEqual({ newer: [], latest_at: null });
  });

  it('a 5 MB feed is read only as far as it must', async () => {
    const old = Array.from({ length: 12_000 }, (_, i) => item(100 + i, 48 + i)).join('');
    const feed = rss(item(1, 1) + item(2, 2) + old);
    expect(feed.length).toBeGreaterThan(5 * 1024 * 1024 * 0.25);
    const big = feed + ' '.repeat(Math.max(0, 5 * 1024 * 1024 - feed.length));
    let pulled = 0;
    const bytes = new TextEncoder().encode(big);
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (pulled >= bytes.length) return c.close();
        c.enqueue(bytes.subarray(pulled, pulled + 16_384));
        pulled += 16_384;
      },
    });
    const got = await countFeed(body, NOW - 24 * H, NOW);
    expect(got.newer.length).toBe(2);
    expect(pulled).toBeLessThan(64 * 1024);
    // With no older episode to stop at, it stops at the byte bound.
    pulled = 0;
    const flood = rss(Array.from({ length: 30_000 }, (_, i) => item(i, 1)).join(''));
    const fbytes = new TextEncoder().encode(flood);
    const fbody = new ReadableStream<Uint8Array>({
      pull(c) {
        if (pulled >= fbytes.length) return c.close();
        c.enqueue(fbytes.subarray(pulled, pulled + 16_384));
        pulled += 16_384;
      },
    });
    const capped = await countFeed(fbody, NOW - 24 * H, NOW, { bytes: 256 * 1024, ms: 5000 });
    expect(pulled).toBeLessThanOrEqual(256 * 1024 + 16_384);
    expect(capped.newer.length).toBeGreaterThan(100);
  });

  it('a slow feed gives up in time: nothing yet is too slow; some counted is kept', async () => {
    const hang = (head: string) =>
      new ReadableStream<Uint8Array>({
        start(c) {
          if (head) c.enqueue(new TextEncoder().encode(head));
        },
      });
    const t0 = Date.now();
    expect(await reason(countFeed(hang(''), 0, NOW, { bytes: 1e6, ms: 200 }))).toBe('too_slow');
    expect(await reason(countFeed(hang('<rss><channel>'), 0, NOW, { bytes: 1e6, ms: 200 }))).toBe('too_slow');
    const some = await countFeed(hang(`<rss><channel>${item(1, 1)}`), NOW - H * 24, NOW, { bytes: 1e6, ms: 200 });
    expect(some.newer.length).toBe(1);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
