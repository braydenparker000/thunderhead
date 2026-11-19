// Astra's relay, the TorBox side (ASTRA.md §4.4, SECURITY.md §8.2; owner rulings 2026-11-18):
// only the owner's device may call it. A tap goes straight to createtorrent with add_only_if_cached
// (seeding off, no zip), checkcached beside it, then requestdl beside the torrent's own listing:
// four calls, two in a row; TorBox refusing the add as not cached is a 503 and nothing is followed. Anything else that stops the direct path (no
// key, no hash, TorBox failing or slow, a file that cannot be told apart) answers no address, and
// the add-on's link is left to the page (the follow path is off unless ASTRA_FOLLOW is "on"). A 429
// is tried once more and no more. GET /v1/astra/torbox tells only whether the key is set and taken,
// and the plan number. The hand-over of TorBox's address and the memory are in astra-links.test.ts,
// the counts and the press's short list in astra-guards.test.ts. Invented hosts, hashes, key, films.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { forget } from '../../src/areas/astra/kept';
import { forgetMinute } from '../../src/areas/astra/routes';
import { useFetch, useTimes } from '../../src/areas/astra/upstream';
import {
  FILE_SERVER,
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
  TORBOX,
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
/** Calls made together finish in no fixed order: compared sorted. */
const sorted = (list: string[]) => [...list].sort();
const stepOf = (b: { steps?: { step: string }[] }, name: string) => b.steps?.find((s) => s.step === name);
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
  forgetMinute();
  forget();
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

describe('POST /v1/astra/play, a tap', () => {
  const FOLLOW_OFF =
    "Astra's server does not open add-on links for the phone, since an add-on may tie a link to the connection that asked for it.";
  const noAddress = (b: { url: string | null; via: string | null; steps: { step: string; note?: string }[] }) =>
    expect([b.url, b.via, b.steps.at(-1)]).toEqual([
      null,
      null,
      expect.objectContaining({ step: 'follow', ok: false, note: FOLLOW_OFF }),
    ]);

  it('without the key, answers no address and opens nothing: the page plays the add-on’s link', async () => {
    const { status, body } = await play({ hash: HASH }, 'none');
    expect(status).toBe(200);
    noAddress(body);
    expect(steps(body)).toEqual(['key:false', 'follow:false']);
    expect(world.asked).toEqual([]);
  });

  it('a cached film already in the account: its address from TorBox, two calls in a row', async () => {
    world.hosts.set('api.torbox.app', torbox({ cached: [FILM], owned: [structuredClone(FILM)] }));
    const { status, body } = await play({ hash: HASH, fileName: 'Invented.Film.2001.mkv' });
    expect([status, body.via, body.url, body.size, body.type]).toEqual([
      200,
      'torbox',
      `https://${FILE_SERVER}/dl/77/0`,
      2100 * MB,
      'video/x-matroska',
    ]);
    expect(sorted(steps(body))).toEqual(['add:true', 'cached:true', 'file:true', 'key:true', 'link:true']);
    expect(stepOf(body, 'add')?.note).toBe('TorBox did not say whether it was new to your account.');
    // checkcached beside the add; requestdl for the file's place beside the listing that confirms its id.
    expect(sorted(pathsAsked().slice(0, 2))).toEqual(['/torrents/checkcached', '/torrents/createtorrent']);
    expect(sorted(pathsAsked().slice(2))).toEqual(['/torrents/mylist', '/torrents/requestdl']);
    expect(body.total_ms).toBeGreaterThanOrEqual(0);
    const link = new URL(torboxCalls().find((a) => a.url.includes('/requestdl'))?.url ?? LINK);
    expect([link.searchParams.get('redirect'), link.searchParams.get('user_ip')]).toEqual(['false', '192.0.2.10']);
    expect(world.asked.some((a) => !a.url.startsWith(TORBOX))).toBe(false);
  });

  it('when TorBox refuses a second add, finds it in the account’s longer list, and asks no listing more', async () => {
    world.hosts.set('api.torbox.app', torbox({ cached: [FILM], owned: [structuredClone(FILM)], add: 'duplicate' }));
    const { body } = await play({ hash: HASH, fileIndex: 0 });
    expect([body.via, body.url]).toEqual(['torbox', `https://${FILE_SERVER}/dl/77/0`]);
    expect(stepOf(body, 'add')).toMatchObject({ ok: false, note: 'TorBox answered with status 400.' });
    expect(stepOf(body, 'owned')).toMatchObject({ ok: true, note: 'It was already in your TorBox account.' });
    expect(pathsAsked().slice(2)).toEqual(['/torrents/mylist', '/torrents/requestdl']);
    expect(new URL(torboxCalls()[2].url).searchParams.get('limit')).toBe('1000');
  });

  it('takes the files createtorrent lists with their ids, with no listing after it', async () => {
    const inner = torbox({ cached: [FILM], owned: [structuredClone(FILM)] });
    world.hosts.set('api.torbox.app', async (req, signal) => {
      const res = await inner(req, signal);
      if (!req.url.includes('/createtorrent')) return res;
      const answer = (await res.json()) as { data: Record<string, unknown> };
      return Response.json({ ...answer, data: { ...answer.data, files: FILM.files } });
    });
    const { body } = await play({ hash: HASH, fileName: 'Invented.Film.2001.mkv' });
    expect(body.url).toBe(`https://${FILE_SERVER}/dl/77/0`);
    expect(pathsAsked().slice(2)).toEqual(['/torrents/requestdl']);
  });

  it('a file whose place in checkcached’s list is not its id is asked for again by its id', async () => {
    world.hosts.set('api.torbox.app', torbox({ cached: [PACK], owned: [structuredClone(PACK)] }));
    const { body } = await play({ hash: OTHER, fileName: 'Invented.Show.S01E02.mkv' });
    expect(body.url).toBe(`https://${FILE_SERVER}/dl/78/5`);
    expect(body.steps).toContainEqual(
      expect.objectContaining({ step: 'file', ok: true, note: expect.stringMatching(/not its id/) }),
    );
    expect(sorted(pathsAsked().slice(2, 4))).toEqual(['/torrents/mylist', '/torrents/requestdl']);
    expect(pathsAsked().slice(4)).toEqual(['/torrents/requestdl']);
    expect(new URL(torboxCalls()[4].url).searchParams.get('file_id')).toBe('5');
  });

  it('adds a cached film only if cached, seeding off, no zip, and says what TorBox said of it', async () => {
    const owned: Torrent[] = [];
    world.hosts.set('api.torbox.app', torbox({ cached: [FILM], owned, nextId: 501, addDetail: 'Torrent added.' }));
    const { body } = await play({ hash: HASH.toUpperCase(), fileSize: 2100 * MB });
    expect([body.via, body.url]).toEqual(['torbox', `https://${FILE_SERVER}/dl/501/0`]);
    expect(torboxCalls().find((a) => a.url.includes('/createtorrent'))?.form).toEqual({
      magnet: `magnet:?xt=urn:btih:${HASH}`,
      add_only_if_cached: 'true',
      seed: '3',
      allow_zip: 'false',
      as_queued: 'false',
    });
    expect([owned.map((t) => t.id), torboxCalls().length]).toEqual([[501], 4]);
    expect(stepOf(body, 'add')?.note).toBe('TorBox said it added it to your account now.');
    forget();
    world.hosts.set('api.torbox.app', torbox({ cached: [FILM], owned, addDetail: 'This item already exists.' }));
    expect(stepOf((await play({ hash: HASH })).body, 'add')?.note).toBe('TorBox said it was already in your account.');
  });

  it('an uncached film is never added nor followed, even with following on; a press answers no address', async () => {
    world.hosts.set('api.torbox.app', torbox({ cached: [], owned: [] }));
    const played = await relay(D, { key: KEY, follow: 'on', body: { link: LINK, hash: HASH, mode: 'play' } });
    expect([played.status, played.body.error?.code, played.body.error?.details.reason]).toEqual([
      503,
      'unavailable',
      'This film is not on TorBox yet, so Astra did not start it.',
    ]);
    expect(sorted(steps(played.body.error?.details ?? {}))).toEqual(['add:false', 'cached:false', 'key:true']);
    expect(sorted(pathsAsked())).toEqual(['/torrents/checkcached', '/torrents/createtorrent']);
    expect(world.asked.some((a) => !a.url.startsWith(TORBOX))).toBe(false);
    world.asked = [];
    const ahead = await play({ hash: HASH, mode: 'ahead' });
    expect([ahead.status, ahead.body.url, ahead.body.via, ahead.body.ready]).toEqual([200, null, null, false]);
    expect(sorted(pathsAsked())).toEqual(['/torrents/checkcached', '/torrents/mylist']);
  });

  it('TorBox failing, or no hash: no address and nothing followed; with following on, the add-on is followed', async () => {
    world.hosts.set('api.torbox.app', () => new Response('', { status: 503 }));
    const down = await play({ hash: HASH });
    noAddress(down.body);
    expect(stepOf(down.body, 'add')).toMatchObject({ ok: false, note: 'TorBox answered with status 503.' });
    // checkcached and the add, each tried once more.
    expect([torboxCalls().length, world.asked.some((a) => !a.url.startsWith(TORBOX))]).toEqual([4, false]);
    noAddress((await play({})).body);
    const on = await relay(D, { key: KEY, follow: 'on', body: { link: LINK, hash: HASH, mode: 'play' } });
    expect([on.body.via, on.body.url]).toEqual(['follow', 'https://store-001.lon.cdn.example/f/1']);
  });

  it('"ahead" answers from the account only, never adding: checkcached beside the list, then requestdl', async () => {
    world.hosts.set('api.torbox.app', torbox({ cached: [FILM, PACK], owned: [structuredClone(PACK)] }));
    const held = await play({ hash: OTHER, mode: 'ahead', fileName: 'Invented.Show.S01E02.mkv' });
    expect([held.body.via, held.body.url, held.body.ready]).toEqual([
      'torbox',
      `https://${FILE_SERVER}/dl/78/5`,
      false,
    ]);
    expect(sorted(pathsAsked().slice(0, 2))).toEqual(['/torrents/checkcached', '/torrents/mylist']);
    expect(pathsAsked().slice(2)).toEqual(['/torrents/requestdl']);
    world.asked = [];
    // Ready on TorBox, not in the account: no address, and what was learnt is kept for the tap.
    const notHeld = await play({ hash: HASH, mode: 'ahead' });
    expect([notHeld.body.url, notHeld.body.ready, sorted(steps(notHeld.body))]).toEqual([
      null,
      true,
      ['cached:true', 'key:true', 'owned:false'],
    ]);
    expect(sorted(pathsAsked())).toEqual(['/torrents/checkcached', '/torrents/mylist']);
    world.asked = [];
    const again = await play({ hash: HASH, mode: 'ahead' });
    expect([again.body.ready, pathsAsked()]).toEqual([true, []]);
    const tapped = await play({ hash: HASH });
    expect(tapped.body.url).toBe(`https://${FILE_SERVER}/dl/500/0`);
    expect(pathsAsked()[0]).toBe('/torrents/createtorrent');
    expect(sorted(pathsAsked().slice(1))).toEqual(['/torrents/mylist', '/torrents/requestdl']);
  });

  it('never guesses between two files: no address (the cached item left in the account is harmless)', async () => {
    world.hosts.set('api.torbox.app', torbox({ cached: [PACK], owned: [] }));
    const { body } = await play({ hash: OTHER });
    noAddress(body);
    expect(body.steps).toContainEqual(
      expect.objectContaining({
        step: 'file',
        ok: false,
        note: 'The file could not be told apart from the others in this torrent.',
      }),
    );
    expect(sorted(pathsAsked())).toEqual(['/torrents/checkcached', '/torrents/createtorrent', '/torrents/mylist']);
    // The add-on's index counted differently: the name wins (the files are remembered: one call).
    world.asked = [];
    const named = await play({ hash: OTHER, fileIndex: 4, fileName: 'Invented.Show.S01E02.mkv' });
    expect([named.body.url, pathsAsked()]).toEqual([`https://${FILE_SERVER}/dl/500/5`, ['/torrents/requestdl']]);
  });

  it('tries a 429 once more after a short wait; a slow TorBox gives up in time', async () => {
    let busy = 1;
    const inner = torbox({ cached: [FILM], owned: [structuredClone(FILM)] });
    const add = (req: { url: string }) => req.url.includes('/createtorrent') && busy-- > 0;
    world.hosts.set('api.torbox.app', (req, s) => (add(req) ? new Response('', { status: 429 }) : inner(req, s)));
    useTimes({ retry_ms: 5 });
    expect((await play({ hash: HASH })).body.via).toBe('torbox');
    expect(pathsAsked().filter((p) => p === '/torrents/createtorrent').length).toBe(2);
    expect(pathsAsked().length).toBe(5);
    forget();
    world.hosts.set('api.torbox.app', never);
    useTimes({ torbox_ms: 30 });
    const slow = await play({ hash: HASH });
    expect(stepOf(slow.body, 'add')).toMatchObject({ ok: false, note: 'TorBox did not answer in time.' });
    noAddress(slow.body);
  });

  it('refuses a malformed request with 422, echoing nothing of it', async () => {
    const { status, text } = await play({ hash: 'not-a-hash-of-anything', mode: 'later' });
    expect(status).toBe(422);
    expect(text).not.toContain('not-a-hash-of-anything');
  });
});
