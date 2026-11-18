// Astra's relay, the follow path (SECURITY.md §8.2): in "play", the add-on's forward is walked by
// hand (a one-byte range, the site's Origin, no cookie or referrer) to the first 200 or 206, whose
// address, size, type and readability come back; a TorBox permanent link on the way is asked for
// its JSON with the phone's address; non-https, numeric and local hosts are refused, so are more
// than six hops and a slow add-on; the add-on's own short "not ready" video is no film; an error at
// the end says its status. Nothing the owner watches reaches a log line or an error body
// (ASTRA.md §5.3: a log capture). Invented hosts, hashes, key and films.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetMinute } from '../../src/areas/astra/routes';
import { useFetch, useTimes } from '../../src/areas/astra/upstream';
import {
  FILE_NAME,
  film,
  forward,
  HASH,
  KEY,
  LINK,
  MB,
  never,
  relay,
  SITE,
  stubFetch,
  TORBOX,
  torbox,
  world,
} from '../astra-helpers';
import { setupOwner } from '../helpers';

let D = '';
const CDN = 'https://nexus-123.latm.cdn.example/film/invented';
const go = (body: Record<string, unknown> = {}, key?: string) =>
  relay(D, { key, origin: SITE, body: { link: LINK, mode: 'play', ...body } });

beforeAll(async () => {
  useFetch(stubFetch);
  D = (await setupOwner()).token;
});
beforeEach(() => {
  world.asked = [];
  world.hosts.clear();
  forgetMinute();
  useTimes();
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  useFetch();
  useTimes();
});

describe('following the add-on’s forward', () => {
  it('walks a plain chain to the film, asking each hop for one byte as the page would', async () => {
    world.hosts.set('addon.example', forward('https://middle.example/r/1'));
    world.hosts.set(
      'middle.example',
      (req) => new Response(null, { status: 307, headers: { Location: req.url.endsWith('/r/1') ? '/r/2' : CDN } }),
    );
    world.hosts.set('nexus-123.latm.cdn.example', film(734_003_200));
    const { status, body } = await go();
    expect(status).toBe(200);
    expect(body).toEqual({
      url: CDN,
      via: 'follow',
      size: 734_003_200,
      type: 'video/x-matroska',
      readable: true,
      steps: [
        { step: 'key', ok: false, ms: expect.any(Number), note: 'No TorBox key is set on your server.' },
        { step: 'follow', ok: true, ms: expect.any(Number), note: 'Reached the film in 4 hops.' },
      ],
    });
    expect(world.asked.map((a) => a.method)).toEqual(['GET', 'GET', 'GET', 'GET']);
    for (const a of world.asked) {
      expect(a.headers.range).toBe('bytes=0-0');
      expect(a.headers.origin).toBe(SITE);
      expect(a.headers.cookie).toBeUndefined();
      expect(a.headers.referer).toBeUndefined();
      expect(a.headers.authorization).toBeUndefined();
    }
  });

  it('asks a TorBox permanent link for its JSON with the phone’s address, without the Worker’s key', async () => {
    const permalink = `${TORBOX}/torrents/requestdl?token=permalink-token&torrent_id=9&file_id=2&redirect=true`;
    world.hosts.set('addon.example', forward(permalink));
    world.hosts.set('api.torbox.app', torbox({ cached: [], owned: [] }));
    world.hosts.set('store-039.wnam.cdn.example', film(2100 * MB));
    const { body } = await go({}, KEY);
    expect([body.via, body.url]).toEqual(['follow', 'https://store-039.wnam.cdn.example/dl/9/2']);
    const asked = new URL(world.asked[1].url);
    expect([asked.searchParams.get('redirect'), asked.searchParams.get('user_ip')]).toEqual(['false', '192.0.2.10']);
    expect(world.asked[1].headers.authorization).toBeUndefined();
  });

  it('stops after six hops', async () => {
    let n = 0;
    world.hosts.set('addon.example', () => new Response(null, { status: 302, headers: { Location: `/hop/${++n}` } }));
    const { status, body } = await go();
    expect([status, body.error?.code, body.error?.details.reason]).toEqual([
      502,
      'upstream',
      "The add-on's forward went on too long.",
    ]);
    expect(world.asked.length).toBe(6);
  });

  it('refuses http, numeric and local addresses, in the link or on the way', async () => {
    const plain = await go({ link: 'http://addon.example/play/1' });
    expect([plain.status, plain.body.error?.details.reason]).toEqual([
      400,
      "The add-on's link is not a public https address.",
    ]);
    for (const to of [
      'http://cdn.example/film',
      'https://127.0.0.1/film',
      'https://[::1]/film',
      'https://localhost/film',
      'https://user:pw@cdn.example/film',
      'https://cdn.example:8443/film',
    ]) {
      world.asked = [];
      world.hosts.set('addon.example', forward(to));
      const { status, body } = await go();
      expect([status, body.error?.details.reason], to).toEqual([
        502,
        "The add-on's forward led to an address that is not public https.",
      ]);
      expect(world.asked.length).toBe(1);
    }
  });

  it('does not hand back the add-on’s own short “not ready” video', async () => {
    world.hosts.set('addon.example', (req) =>
      req.url.endsWith('/static/downloading.mp4')
        ? new Response('x', { status: 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(3 * MB) } })
        : new Response(null, { status: 307, headers: { Location: '/static/downloading.mp4' } }),
    );
    const { status, body, text } = await go({ hash: HASH });
    expect([status, body.error?.code, body.error?.details.reason]).toEqual([
      503,
      'unavailable',
      'The add-on says this film is not ready on TorBox yet.',
    ]);
    expect(text).not.toContain('downloading.mp4');
  });

  it('says whether a page may read the film: `*` or the site echoed, else not', async () => {
    world.hosts.set('addon.example', forward(CDN));
    world.hosts.set('nexus-123.latm.cdn.example', film(900 * MB, { 'Access-Control-Allow-Origin': SITE }));
    expect((await go()).body.readable).toBe(true);
    world.hosts.set('nexus-123.latm.cdn.example', film(900 * MB, {}));
    const closed = await go();
    expect([closed.body.url, closed.body.readable]).toEqual([CDN, false]);
  });

  it('an error at the end says its status; a slow add-on gives up in time', async () => {
    world.hosts.set('addon.example', forward(CDN));
    world.hosts.set('nexus-123.latm.cdn.example', () => new Response('gone', { status: 404 }));
    const ended = await go();
    expect([ended.status, ended.body.error?.details.steps.at(-1)?.note]).toEqual([
      502,
      'The forward ended with status 404.',
    ]);
    useTimes({ follow_ms: 40 });
    world.hosts.set('addon.example', never);
    const slow = await go();
    expect([slow.status, slow.body.error?.details.reason]).toEqual([502, 'The add-on took too long to answer.']);
  });

  it('never hands over an address that holds the key or is TorBox’s API itself', async () => {
    world.hosts.set('addon.example', forward(`${CDN}?t=${KEY}`));
    world.hosts.set('nexus-123.latm.cdn.example', film(900 * MB));
    const keyed = await go({}, KEY);
    expect([keyed.status, keyed.body.error?.code, keyed.body.error?.details.reason]).toEqual([
      502,
      'upstream',
      'The address could not be passed on safely.',
    ]);
    expect(keyed.text).not.toContain(KEY);
    // A permanent link whose answer is TorBox's API again is not passed on either.
    const permalink = `${TORBOX}/torrents/requestdl?token=permalink-token&torrent_id=9&file_id=2&redirect=true`;
    world.hosts.set('addon.example', forward(permalink));
    world.hosts.set('api.torbox.app', torbox({ cached: [], owned: [], link: `${TORBOX}/torrents/other?x=1` }));
    const looped = await go({}, KEY);
    expect([looped.status, looped.body.error?.details.reason, looped.body.error?.details.steps.at(-1)?.note]).toEqual([
      502,
      "TorBox did not give the file's address.",
      'The address held the key or pointed at TorBox itself, so it was not passed on.',
    ]);
  });

  it('"ahead" never follows a link', async () => {
    world.hosts.set('addon.example', forward(CDN));
    const { status, body } = await go({ mode: 'ahead' });
    expect([status, body.url]).toEqual([200, null]);
    expect(world.asked).toEqual([]);
  });
});

describe('nothing the owner watches is logged or echoed (ASTRA.md §5.3)', () => {
  it('no address, hash, key or file name in any log line, note or error body', async () => {
    const lines: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const)
      vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(' ')));
    const secrets = [LINK, 'addon.example', HASH, KEY, FILE_NAME, 'cdn.example', 'permalink-token'];
    // TorBox saying for certain the film is not cached (503, nothing followed); then TorBox down
    // (cachedness unknown, so the add-on is followed): a host whose failure carries the address in
    // its message, a broken answer the app does not expect (an internal error), and a success.
    world.hosts.set('api.torbox.app', torbox({ cached: [], owned: [] }));
    const uncached = await go({ hash: HASH, fileName: FILE_NAME }, KEY);
    expect(uncached.status).toBe(503);
    world.hosts.set('api.torbox.app', () => new Response('', { status: 503 }));
    world.hosts.set('addon.example', () => {
      throw new TypeError(`fetch failed for ${LINK} ${HASH}`);
    });
    const failed = await go({ hash: HASH, fileName: FILE_NAME, fileSize: 1 }, KEY);
    world.hosts.set('addon.example', () => ({ status: 302 }) as unknown as Response);
    const broken = await go({ hash: HASH, fileName: FILE_NAME }, KEY);
    expect([broken.status, broken.body.error?.code]).toEqual([500, 'internal']);
    world.hosts.set('addon.example', forward(CDN));
    world.hosts.set('nexus-123.latm.cdn.example', film(900 * MB));
    const ok = await go({ hash: HASH, fileName: FILE_NAME }, KEY);
    expect([failed.status, ok.status]).toEqual([502, 200]);
    expect(lines.length).toBeGreaterThan(0);
    for (const text of [...lines, uncached.text, failed.text, broken.text, JSON.stringify(ok.body.steps)])
      for (const s of secrets) expect(text, s).not.toContain(s);
    expect(failed.body.error?.details.reason).toBe('The add-on could not be reached.');
  });
});
