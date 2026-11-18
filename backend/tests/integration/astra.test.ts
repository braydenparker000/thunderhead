// Astra's relay, the TorBox side (ASTRA.md §4.4, SECURITY.md §8.2; owner rulings 2026-11-18):
// only the owner's device may call it; without the key the direct path is skipped and the follow
// path still works; a cached item already in the account plays from TorBox, a cached one not yet
// in it is added with add_only_if_cached (seeding off, no zip), an uncached one is never added and
// falls to the follow path in "play" and to no address in "ahead"; "ahead" never adds; a file that
// cannot be told apart is never guessed and nothing is added for it; the direct path costs at most
// four TorBox calls, a 429 is tried once more and no more; a slow TorBox gives up in time; GET
// /v1/astra/torbox tells only whether the key is set and taken, and the plan number. Invented
// hosts, hashes, key and films.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { forgetMinute } from '../../src/areas/astra/routes';
import { useFetch, useTimes } from '../../src/areas/astra/upstream';
import {
  film,
  forward,
  HASH,
  KEY,
  LINK,
  MB,
  never,
  OTHER,
  pathsAsked,
  relay,
  stubFetch,
  type TorboxAnswer,
  type Torrent,
  torbox,
  torboxCalls,
  world,
} from '../astra-helpers';
import { makeAgent, setupOwner } from '../helpers';

let D = '';
let C = '';
let M = '';
const FILM: Torrent = {
  id: 77,
  hash: HASH,
  files: [
    { id: 0, name: 'Invented Film (2001)/Invented.Film.2001.mkv', size: 2100 * MB, mimetype: 'video/x-matroska' },
    { id: 1, name: 'Invented Film (2001)/Sample/sample.mkv', size: 20 * MB },
  ],
};
const PACK: Torrent = {
  id: 78,
  hash: OTHER,
  files: [
    { id: 4, name: 'Invented Show S01/Invented.Show.S01E01.mkv', size: 900 * MB },
    { id: 5, name: 'Invented Show S01/Invented.Show.S01E02.mkv', size: 910 * MB },
  ],
};
const steps = (b: { steps?: { step: string; ok: boolean }[] }) => (b.steps ?? []).map((s) => `${s.step}:${s.ok}`);
const play = (body: Record<string, unknown>, key: string | undefined = KEY) =>
  relay(D, { key, body: { link: LINK, mode: 'play', ...body } });

beforeAll(async () => {
  useFetch(stubFetch);
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
  M = await makeAgent(D, 'muse');
});
beforeEach(() => {
  world.asked = [];
  world.hosts.clear();
  world.hosts.set('addon.example', forward('https://store-001.lon.cdn.example/f/1'));
  world.hosts.set('store-001.lon.cdn.example', film(2100 * MB));
  world.hosts.set('store-039.wnam.cdn.example', film(2100 * MB));
  forgetMinute();
  useTimes();
});
afterAll(() => {
  useFetch();
  useTimes();
});

describe('who may ask', () => {
  it('only the owner’s device: the mind and Muse get 403, and nothing is asked', async () => {
    for (const t of [C, M]) {
      expect((await relay(t, { key: KEY, body: { link: LINK, hash: HASH, mode: 'play' } })).status).toBe(403);
      expect((await relay(t, { key: KEY })).status).toBe(403);
    }
    expect(world.asked).toEqual([]);
  });
});

describe('GET /v1/astra/torbox', () => {
  it('says the key is not set, asking nobody', async () => {
    const { status, body } = await relay<TorboxAnswer>(D);
    expect([status, body]).toEqual([200, { configured: false, ok: null, plan: null, note: expect.any(String) }]);
    expect(world.asked).toEqual([]);
  });

  it('says TorBox takes the key and gives the plan number, nothing else of the account', async () => {
    world.hosts.set('api.torbox.app', torbox({ cached: [], owned: [] }));
    expect((await relay<TorboxAnswer>(D, { key: KEY })).body).toEqual({ configured: true, ok: true, plan: 2 });
    const refused = await relay<TorboxAnswer>(D, { key: 'invented-wrong-key' });
    expect(refused.body).toEqual({ configured: true, ok: false, plan: null, note: 'TorBox did not accept the key.' });
    expect(refused.text).not.toContain('invented-wrong-key');
  });
});

describe('POST /v1/astra/play, the direct path', () => {
  it('without the key, skips TorBox and follows the add-on’s link', async () => {
    const { status, body } = await play({ hash: HASH }, 'none');
    expect([status, body.via, body.url]).toEqual([200, 'follow', 'https://store-001.lon.cdn.example/f/1']);
    expect(body.steps[0]).toMatchObject({ step: 'key', ok: false, note: 'No TorBox key is set on your server.' });
    expect(torboxCalls()).toEqual([]);
  });

  it('a cached film already in the account: its address from TorBox in four calls, for the phone', async () => {
    world.hosts.set('api.torbox.app', torbox({ cached: [FILM], owned: [structuredClone(FILM)] }));
    const { status, body } = await play({ hash: HASH, fileName: 'Invented.Film.2001.mkv' });
    expect([status, body.via, body.url, body.size, body.type]).toEqual([
      200,
      'torbox',
      'https://store-039.wnam.cdn.example/dl/77/0',
      2100 * MB,
      'video/x-matroska',
    ]);
    expect(steps(body)).toEqual(['key:true', 'cached:true', 'add:true', 'file:true', 'link:true']);
    expect(pathsAsked()).toEqual([
      '/torrents/checkcached',
      '/torrents/createtorrent',
      '/torrents/mylist',
      '/torrents/requestdl',
    ]);
    const link = new URL(torboxCalls()[3].url);
    expect([link.searchParams.get('redirect'), link.searchParams.get('user_ip')]).toEqual(['false', '192.0.2.10']);
    expect(world.asked.some((a) => a.url.startsWith('https://addon.example'))).toBe(false);
  });

  it('when TorBox refuses a second add, finds it in the account instead, still in four calls', async () => {
    world.hosts.set('api.torbox.app', torbox({ cached: [FILM], owned: [structuredClone(FILM)], add: 'duplicate' }));
    const { body } = await play({ hash: HASH, fileIndex: 0 });
    expect([body.via, body.url]).toEqual(['torbox', 'https://store-039.wnam.cdn.example/dl/77/0']);
    expect(body.steps[2]).toMatchObject({ step: 'add', ok: true, note: 'It was already in your TorBox account.' });
    expect(torboxCalls().length).toBeLessThanOrEqual(4);
  });

  it('a cached film not in the account is added only if cached, seeding off, no zip', async () => {
    const owned: Torrent[] = [];
    world.hosts.set('api.torbox.app', torbox({ cached: [FILM], owned, nextId: 501 }));
    const { body } = await play({ hash: HASH.toUpperCase(), fileSize: 2100 * MB });
    expect([body.via, body.url]).toEqual(['torbox', 'https://store-039.wnam.cdn.example/dl/501/0']);
    const add = torboxCalls().find((a) => a.url.endsWith('/torrents/createtorrent'));
    expect(add?.form).toEqual({
      magnet: `magnet:?xt=urn:btih:${HASH}`,
      add_only_if_cached: 'true',
      seed: '3',
      allow_zip: 'false',
      as_queued: 'false',
    });
    expect(owned.map((t) => t.id)).toEqual([501]);
    expect(torboxCalls().length).toBe(4);
  });

  it('an uncached film is never added: "play" follows the add-on, "ahead" answers no address', async () => {
    world.hosts.set('api.torbox.app', torbox({ cached: [], owned: [] }));
    const played = await play({ hash: HASH });
    expect([played.body.via, steps(played.body)]).toEqual(['follow', ['key:true', 'cached:false', 'follow:true']]);
    expect(pathsAsked()).toEqual(['/torrents/checkcached']);
    world.asked = [];
    const ahead = await play({ hash: HASH, mode: 'ahead' });
    expect([ahead.status, ahead.body.url, ahead.body.via]).toEqual([200, null, null]);
    expect(pathsAsked()).toEqual(['/torrents/checkcached']);
    expect(world.asked.some((a) => !a.url.startsWith('https://api.torbox.app'))).toBe(false);
  });

  it('"ahead" answers from the account only, never adding, in three calls', async () => {
    world.hosts.set('api.torbox.app', torbox({ cached: [FILM, PACK], owned: [structuredClone(PACK)] }));
    const held = await play({ hash: OTHER, mode: 'ahead', fileName: 'Invented.Show.S01E02.mkv' });
    expect([held.body.via, held.body.url]).toEqual(['torbox', 'https://store-039.wnam.cdn.example/dl/78/5']);
    expect(pathsAsked()).toEqual(['/torrents/checkcached', '/torrents/mylist', '/torrents/requestdl']);
    world.asked = [];
    const notHeld = await play({ hash: HASH, mode: 'ahead' });
    expect([notHeld.body.url, steps(notHeld.body)]).toEqual([null, ['key:true', 'cached:true', 'owned:false']]);
    expect(pathsAsked()).toEqual(['/torrents/checkcached', '/torrents/mylist']);
  });

  it('never guesses between two files, and adds nothing for a file it cannot tell apart', async () => {
    world.hosts.set('api.torbox.app', torbox({ cached: [PACK], owned: [] }));
    const { body } = await play({ hash: OTHER });
    expect(body.via).toBe('follow');
    expect(body.steps).toContainEqual(
      expect.objectContaining({
        step: 'file',
        ok: false,
        note: 'The file could not be told apart from the others in this torrent.',
      }),
    );
    expect(pathsAsked()).toEqual(['/torrents/checkcached']);
    // The add-on's index counted differently: the name wins.
    world.asked = [];
    world.hosts.set('api.torbox.app', torbox({ cached: [PACK], owned: [structuredClone(PACK)] }));
    const named = await play({ hash: OTHER, fileIndex: 4, fileName: 'Invented.Show.S01E02.mkv' });
    expect(named.body.url).toBe('https://store-039.wnam.cdn.example/dl/78/5');
  });

  it('tries a 429 once more after a short wait, and a failing TorBox no more than that', async () => {
    let busy = 1;
    const inner = torbox({ cached: [FILM], owned: [structuredClone(FILM)] });
    world.hosts.set('api.torbox.app', (req, s) => (busy-- > 0 ? new Response('', { status: 429 }) : inner(req, s)));
    useTimes({ retry_ms: 5 });
    expect((await play({ hash: HASH })).body.via).toBe('torbox');
    expect(pathsAsked()).toEqual([
      '/torrents/checkcached',
      '/torrents/checkcached',
      '/torrents/createtorrent',
      '/torrents/mylist',
      '/torrents/requestdl',
    ]);
    world.asked = [];
    world.hosts.set('api.torbox.app', () => new Response('', { status: 503 }));
    const down = await play({ hash: HASH });
    expect(down.body.steps[1]).toMatchObject({ step: 'cached', ok: false, note: 'TorBox answered with status 503.' });
    expect(torboxCalls().length).toBe(2);
    expect(down.body.via).toBe('follow');
  });

  it('gives up on a slow TorBox in time and still follows the add-on', async () => {
    world.hosts.set('api.torbox.app', never);
    useTimes({ torbox_ms: 30 });
    const { body } = await play({ hash: HASH });
    expect(body.steps[1]).toMatchObject({ step: 'cached', ok: false, note: 'TorBox did not answer in time.' });
    expect(body.via).toBe('follow');
  });

  it('takes at most 30 requests a minute in an isolate', async () => {
    for (let i = 0; i < 30; i++) expect((await relay<TorboxAnswer>(D)).status).toBe(200);
    const { status, body } = await relay(D, { body: { link: LINK, mode: 'ahead' } });
    expect([status, body.error?.code]).toEqual([429, 'rate_limited']);
    expect(body.error?.retry_after).toBeGreaterThan(0);
  });

  it('refuses a malformed request with 422, echoing nothing of it', async () => {
    const { status, text } = await play({ hash: 'not-a-hash-of-anything', mode: 'later' });
    expect(status).toBe(422);
    expect(text).not.toContain('not-a-hash-of-anything');
  });
});
