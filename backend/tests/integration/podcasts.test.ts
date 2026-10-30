// P8: Podcasts' hosts through the new Worker (PODCASTS.md §3.1, §4.4), for the owner's device only,
// from fake hosts (ported from the old repo's backend/tests/podcasts.test.js): the directory (Apple,
// then gpodder) and its categories, a feed passed through and cut at 4 MB, an episode's audio found
// in its feed with byte ranges kept, every redirect checked (a private address is refused, a loop
// stops), a non-audio body refused, a missing episode never proxied. A host's words reach the app
// in `details.reason`.
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { episodeID } from '../../../frontend/th/podcasts/feed.js';
import { app } from '../../src/app';
import { useFetch } from '../../src/areas/podcasts/upstream';
import { makeAgent, setupOwner } from '../helpers';

let D = '';
let C = '';
const FEED = 'https://feeds.example.org/podcast.xml';
const RSS = `<?xml version="1.0"?><rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>History &amp; Sound</title><item><title>Episode &amp; one</title><guid isPermaLink="false">episode-1</guid><enclosure url="https://media.example.org/audio.mp3?a=1&amp;b=2" type="audio/mpeg" length="12000"/></item><item><title>Episode two</title><guid>episode-2</guid><enclosure url="https://media.example.org/hop/0" type="audio/mpeg"/></item><item><title>Page</title><guid>episode-3</guid><enclosure url="https://media.example.org/page.html" type="audio/mpeg"/></item></channel></rss>`;
let asked: { url: string; range?: string; ua?: string }[] = [];
let host: (url: string, range?: string) => Response | undefined = () => undefined;

function fake(url: string, range?: string): Response {
  const u = new URL(url);
  const own = host(url, range);
  if (own) return own;
  if (url === FEED) return new Response(RSS, { headers: { 'Content-Type': 'application/rss+xml' } });
  if (u.pathname.startsWith('/hop/')) {
    const n = Number(u.pathname.slice(5));
    return n < 11
      ? new Response(null, { status: 302, headers: { Location: `/hop/${n + 1}` } })
      : new Response('later', {
          status: 206,
          headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 0-4/99' },
        });
  }
  if (u.pathname === '/audio.mp3')
    return new Response('0123456789', {
      status: 206,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Range': 'bytes 10-19/100',
        'Content-Length': '10',
        'Accept-Ranges': 'bytes',
      },
    });
  if (u.pathname === '/page.html')
    return new Response('<html>error</html>', { headers: { 'Content-Type': 'text/html' } });
  if (u.hostname === 'itunes.apple.com')
    return Response.json({
      results: [
        { collectionId: 1, collectionName: 'History', feedUrl: FEED },
        { collectionId: 2, collectionName: 'No RSS' },
      ],
    });
  return new Response('', { status: 404 });
}

const get = (path: string, headers: Record<string, string> = {}, token = D) =>
  app.fetch(
    new Request(`https://api.example.test/v1/podcasts/${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '192.0.2.10', ...headers },
    }),
    env,
    createExecutionContext(),
  );
const failed = async (r: Response) => {
  const b = (await r.json()) as { error: { code: string; details?: { reason: string } } };
  return [r.status, b.error.code, b.error.details?.reason];
};
const audio = (id: string, feed = FEED) => `audio?feed=${encodeURIComponent(feed)}&id=${id}`;

beforeAll(async () => {
  useFetch(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const h = new Headers(init?.headers);
    asked.push({ url, range: h.get('Range') ?? undefined, ua: h.get('User-Agent') ?? undefined });
    return fake(url, h.get('Range') ?? undefined);
  });
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
});
afterAll(() => useFetch((...a) => fetch(...a)));

describe('Podcasts’ hosts', () => {
  it('the owner’s device only', async () => {
    expect((await get('directory?q=history', {}, '')).status).toBe(401);
    expect((await get('directory?q=history', {}, C)).status).toBe(403);
  });

  it('the directory: shows with a feed, by words or category; words too short are the app’s words', async () => {
    asked = [];
    const r = await get('directory?q=History&country=ar');
    expect(r.status).toBe(200);
    expect(((await r.json()) as { shows: { title: string }[] }).shows.map((s) => s.title)).toEqual(['History']);
    const u = new URL(asked[0].url);
    expect([u.searchParams.get('country'), u.searchParams.get('media'), u.searchParams.get('limit')]).toEqual([
      'ar',
      'podcast',
      '36',
    ]);
    expect(asked[0].ua).toMatch(/^Thunderhead-Podcasts\/1\.0/);
    asked = [];
    expect((await get('directory?category=faith')).status).toBe(200);
    expect(new URL(asked[0].url).searchParams.get('term')).toBe('religion spirituality');
    expect(await failed(await get('directory?category=constructor'))).toEqual([
      400,
      'bad_request',
      'Unknown podcast category',
    ]);
    expect(await failed(await get('directory?q=x'))).toEqual([
      400,
      'bad_request',
      'Enter at least two characters to search.',
    ]);
  });

  it('Apple refusing falls back to gpodder', async () => {
    asked = [];
    host = (url) =>
      url.startsWith('https://itunes.apple.com/')
        ? new Response('Rejected', { status: 403 })
        : url.startsWith('https://gpodder.net/')
          ? Response.json([
              { title: 'A history show', author: 'Host', url: FEED, logo_url: 'https://images.example.org/show.jpg' },
            ])
          : undefined;
    const r = await get('directory?q=history');
    const { shows } = (await r.json()) as { shows: { id: string; feedUrl: string }[] };
    expect(asked.length).toBe(3);
    expect(shows[0]).toMatchObject({ feedUrl: FEED, id: episodeID(FEED) });
    host = () => undefined;
  });

  it('a feed passes through as sent; a big one stops at 4 MB; private addresses and redirects are refused', async () => {
    const r = await get(`feed?url=${encodeURIComponent(FEED)}`);
    expect([r.status, r.headers.get('Content-Type'), await r.text()]).toEqual([200, 'application/xml', RSS]);
    host = (url) => (url.includes('big') ? new Response('x'.repeat(5 * 1024 * 1024)) : undefined);
    expect(
      (await (await get(`feed?url=${encodeURIComponent('https://feeds.example.org/big.xml')}`)).arrayBuffer())
        .byteLength,
    ).toBe(4 * 1024 * 1024);
    host = (url) =>
      url.includes('away')
        ? new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/metadata' } })
        : undefined;
    asked = [];
    expect(await failed(await get(`feed?url=${encodeURIComponent('https://feeds.example.org/away.xml')}`))).toEqual([
      400,
      'bad_request',
      'Only public podcast feed addresses are supported.',
    ]);
    expect(asked.length).toBe(1);
    host = (url) =>
      url.includes('loop') ? new Response(null, { status: 302, headers: { Location: url } }) : undefined;
    expect(await failed(await get(`feed?url=${encodeURIComponent('https://feeds.example.org/loop.xml')}`))).toEqual([
      502,
      'upstream',
      'The podcast host returned a redirect loop.',
    ]);
    for (const bad of [
      'http://127.0.0.1/',
      'https://localhost/feed',
      'https://name:pass@feeds.example.org/',
      'file:///etc/passwd',
    ])
      expect((await get(`feed?url=${encodeURIComponent(bad)}`)).status).toBe(400);
    host = () => undefined;
  });

  it('an episode’s audio comes from its feed’s enclosure, byte range kept, through a long redirect chain', async () => {
    asked = [];
    const r = await get(audio(episodeID('episode-1')), { Range: 'bytes=10-19' });
    expect(r.status).toBe(206);
    expect([r.headers.get('Content-Range'), r.headers.get('Accept-Ranges'), r.headers.get('Content-Type')]).toEqual([
      'bytes 10-19/100',
      'bytes',
      'audio/mpeg',
    ]);
    expect(await r.text()).toBe('0123456789');
    expect(asked.map((a) => [a.url, a.range])).toEqual([
      [FEED, undefined],
      ['https://media.example.org/audio.mp3?a=1&b=2', 'bytes=10-19'],
    ]);
    // A seek: the feed is not asked again.
    asked = [];
    expect((await get(audio(episodeID('episode-1')), { Range: 'bytes=0-1' })).status).toBe(206);
    expect(asked.map((a) => a.url)).toEqual(['https://media.example.org/audio.mp3?a=1&b=2']);
    asked = [];
    const far = await get(audio(episodeID('episode-2')), { Range: 'bytes=0-4' });
    expect([far.status, await far.text()]).toEqual([206, 'later']);
    expect(asked.filter((a) => a.url.includes('/hop/')).every((a) => a.range === 'bytes=0-4')).toBe(true);
    // The redirects' end is remembered: the next range goes straight there.
    asked = [];
    await (await get(audio(episodeID('episode-2')), { Range: 'bytes=5-9' })).text();
    expect(asked.map((a) => a.url)).toEqual(['https://media.example.org/hop/11']);
  });

  it('an older episode further down a long feed is found, in pieces', async () => {
    const LONG = 'https://feeds.example.org/long.xml';
    const notes = 'n'.repeat(2000);
    const items = Array.from(
      { length: 150 },
      (_, i) =>
        `<item><title>E${i}</title><guid>long-${i}</guid><description>${notes}</description><enclosure url="https://media.example.org/audio.mp3?long=${i}" type="audio/mpeg"/></item>`,
    ).join('');
    host = (url) =>
      url === LONG
        ? new Response(new Blob([`<rss><channel><title>Long</title>${items}</channel></rss>`]).stream())
        : undefined;
    asked = [];
    expect((await get(audio(episodeID('long-120'), LONG), { Range: 'bytes=10-19' })).status).toBe(206);
    expect(asked.at(-1)?.url).toBe('https://media.example.org/audio.mp3?long=120');
    expect((await get(audio(episodeID('long-150'), LONG))).status).toBe(404);
    host = () => undefined;
  });

  it('never an arbitrary proxy: a missing episode is a 404, a non-audio body a 415, a bad range a 400', async () => {
    expect(await failed(await get(audio('missing')))).toEqual([
      404,
      'not_found',
      'This episode is no longer in the feed. Use its original audio link.',
    ]);
    expect(await failed(await get(audio(episodeID('episode-3'))))).toEqual([
      415,
      'unsupported_media_type',
      'The episode host returned an unsupported audio format.',
    ]);
    expect(await failed(await get(audio(episodeID('episode-1')), { Range: 'lines=1' }))).toEqual([
      400,
      'bad_request',
      'Invalid byte range',
    ]);
  });

  it('the site may send a range and read where the bytes fall', async () => {
    const r = await app.fetch(
      new Request('https://api.example.test/v1/podcasts/audio', {
        method: 'OPTIONS',
        headers: {
          Origin: env.SITE_ORIGINS.split(',')[0].trim(),
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'authorization,range',
        },
      }),
      env,
      createExecutionContext(),
    );
    expect(r.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain('range');
    const got = await get(audio(episodeID('episode-1')), {
      Range: 'bytes=10-19',
      Origin: env.SITE_ORIGINS.split(',')[0].trim(),
    });
    expect(got.headers.get('Access-Control-Expose-Headers')).toContain('Content-Range');
  });
});
