// Astra's relay, its guards (SECURITY.md §8.2): presses ("ahead") have their own count of 60 a
// minute and past it answer no address, never a 429, so they never starve a tap; taps and GET
// /v1/astra/torbox share 30 a minute, then 429. A press reads only the newest 100 items of the
// account's list. (The hand-over of TorBox's address is in astra-links.test.ts.) Invented hosts,
// hashes, key and films.
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
  relay,
  stubFetch,
  type TorboxAnswer,
  type Torrent,
  torbox,
  torboxCalls,
  world,
} from '../astra-helpers';
import { setupOwner } from '../helpers';

let D = '';
const FILM: Torrent = {
  id: 77,
  hash: HASH,
  files: [{ id: 0, name: 'Invented Film (2001)/Invented.Film.2001.mkv', size: 2100 * MB }],
};
/** Torrents the account holds, newest first: `n` others before the film. */
const account = (n: number): Torrent[] => [
  ...Array.from({ length: n }, (_, i) => ({
    id: 1000 + i,
    hash: (i + 1).toString(16).padStart(40, 'f'),
    files: [{ id: 0, name: `Invented ${i}.mkv`, size: 700 * MB }],
  })),
  structuredClone(FILM),
];
const press = (key = 'none') => relay(D, { key, body: { link: LINK, hash: HASH, mode: 'ahead' } });
const tap = (key = 'none') => relay(D, { key, body: { link: LINK, hash: HASH, mode: 'play' } });

beforeAll(async () => {
  useFetch(stubFetch);
  D = (await setupOwner()).token;
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

describe('the counts', () => {
  it('presses past 60 a minute answer no address, never a 429, and leave the taps their own 30', async () => {
    for (let i = 0; i < 60; i++) expect((await press()).status).toBe(200);
    const over = await press();
    expect([over.status, over.body]).toEqual([
      200,
      {
        url: null,
        via: null,
        size: null,
        type: null,
        readable: null,
        ready: false,
        steps: [],
        total_ms: expect.any(Number),
      },
    ]);
    const played = await tap();
    expect([played.status, played.body.steps.map((x) => x.step)]).toEqual([200, ['key', 'follow']]);
  });

  it('taps and GET /v1/astra/torbox share 30 a minute, then 429; presses go on', async () => {
    for (let i = 0; i < 29; i++) expect((await relay<TorboxAnswer>(D)).status).toBe(200);
    expect((await tap()).status).toBe(200);
    const { status, body } = await tap();
    expect([status, body.error?.code]).toEqual([429, 'rate_limited']);
    expect(body.error?.retry_after).toBeGreaterThan(0);
    expect((await relay<TorboxAnswer>(D)).status).toBe(429);
    expect((await press()).status).toBe(200);
  });
});

describe('a press reads only the newest of the list', () => {
  it('finds the film among the newest 100, and past them answers no address without adding', async () => {
    world.hosts.set('api.torbox.app', torbox({ cached: [FILM], owned: account(99) }));
    expect((await press(KEY)).body.url).toBe(`https://${FILE_SERVER}/dl/77/0`);
    const list = torboxCalls().find((a) => new URL(a.url).pathname.endsWith('/mylist'));
    expect(new URL(list?.url ?? LINK).searchParams.get('limit')).toBe('100');
    world.asked = [];
    forget();
    world.hosts.set('api.torbox.app', torbox({ cached: [FILM], owned: account(100) }));
    const far = await press(KEY);
    expect([far.status, far.body.url, far.body.ready]).toEqual([200, null, true]);
    expect(far.body.steps).toContainEqual(expect.objectContaining({ step: 'owned', ok: false }));
    expect(torboxCalls().some((a) => a.url.endsWith('/createtorrent'))).toBe(false);
    // The tap that follows finds it through the add, which answers the existing id.
    world.asked = [];
    expect((await tap(KEY)).body.url).toBe(`https://${FILE_SERVER}/dl/77/0`);
    expect(torboxCalls().some((a) => a.url.includes('/checkcached'))).toBe(false);
  });
});
