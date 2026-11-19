// Astra's relay, TorBox's address and the memory (SECURITY.md §8.2, owner's phone 2026-11-18):
// requestdl's answer is handed over when it is public https and not on TorBox's API host, even
// when it carries the account's token; an answer on api.torbox.app is asked once more inside the
// Worker (its redirect, or its JSON), at most twice, and never handed over; the `link` step says in
// fixed words which case it was. A torrent found is remembered in memory, so the next ask for the
// same film costs requestdl alone; an id TorBox no longer knows is asked again in full, once.
// Invented hosts, hashes, key and films.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { forget } from '../../src/areas/astra/kept';
import { forgetMinute } from '../../src/areas/astra/routes';
import { useFetch, useTimes } from '../../src/areas/astra/upstream';
import {
  FILE_SERVER,
  HASH,
  KEY,
  LINK,
  MB,
  pathsAsked,
  relay,
  stubFetch,
  TORBOX,
  type Torrent,
  torbox,
  world,
} from '../astra-helpers';
import { setupOwner } from '../helpers';

let D = '';
const FILM: Torrent = {
  id: 77,
  hash: HASH,
  files: [{ id: 0, name: 'Invented Film (2001)/Invented.Film.2001.mkv', size: 2100 * MB }],
};
const tap = (mode = 'play') => relay(D, { key: KEY, body: { link: LINK, hash: HASH, mode } });
const linkStep = (b: { steps: { step: string; ok: boolean; note?: string }[] }) =>
  b.steps.find((s) => s.step === 'link');
const PERMALINK = `${TORBOX}/torrents/requestdl?token=permalink-token&torrent_id=77&file_id=0`;

beforeAll(async () => {
  useFetch(stubFetch);
  D = (await setupOwner()).token;
});
beforeEach(() => {
  world.asked = [];
  world.hosts.clear();
  forgetMinute();
  forget();
  useTimes();
});
afterAll(() => {
  useFetch();
  useTimes();
});

describe('TorBox’s address, handed over', () => {
  it('a file server’s address, straight from TorBox', async () => {
    world.hosts.set('api.torbox.app', torbox({ cached: [FILM], owned: [structuredClone(FILM)] }));
    const { body } = await tap();
    expect([body.url, linkStep(body)]).toEqual([
      `https://${FILE_SERVER}/dl/77/0`,
      expect.objectContaining({
        ok: true,
        note: 'The address is on a TorBox file server, came straight from TorBox, and carries no account token.',
      }),
    ]);
  });

  it('one carrying the account’s token goes to the owner’s device, and the note says so', async () => {
    const link = `https://${FILE_SERVER}/dl/77/0?token=${KEY}`;
    world.hosts.set('api.torbox.app', torbox({ cached: [FILM], owned: [structuredClone(FILM)], link }));
    const { body } = await tap();
    expect(body.url).toBe(link);
    expect(linkStep(body)?.note).toBe(
      "The address is on a TorBox file server, came straight from TorBox, and carries your account's token.",
    );
    expect(JSON.stringify(body.steps)).not.toContain(KEY);
  });

  it('another host is named as such', async () => {
    world.hosts.set(
      'api.torbox.app',
      torbox({ cached: [FILM], owned: [structuredClone(FILM)], link: 'https://elsewhere.example/f' }),
    );
    expect(linkStep((await tap()).body)?.note).toBe(
      'The address is on another host, not a TorBox file server, came straight from TorBox, and carries no account token.',
    );
  });

  it('an answer on TorBox’s API is asked once more, and its redirect handed over', async () => {
    const link = `${PERMALINK}&redirect=true`;
    world.hosts.set('api.torbox.app', torbox({ cached: [FILM], owned: [structuredClone(FILM)], link }));
    const { body } = await tap();
    expect(body.url).toBe(`https://${FILE_SERVER}/dl/77/0`);
    expect(linkStep(body)?.note).toBe(
      'The address is on a TorBox file server, came after 1 exchange with TorBox, and carries no account token.',
    );
    expect(pathsAsked().filter((p) => p === '/torrents/requestdl').length).toBe(2);
    expect(pathsAsked().length).toBe(5);
    const exchange = world.asked.filter((a) => a.url.includes('/requestdl'))[1];
    expect(new URL(exchange.url).searchParams.get('user_ip')).toBe('192.0.2.10');
  });

  it('never hands over an address on TorBox’s API, after two exchanges at most', async () => {
    // TorBox answering with its own API address every time (here: a requestdl without redirect).
    world.hosts.set('api.torbox.app', torbox({ cached: [FILM], owned: [structuredClone(FILM)], link: PERMALINK }));
    const { status, body, text } = await tap();
    expect([status, body.url, linkStep(body)]).toEqual([
      200,
      null,
      expect.objectContaining({
        ok: false,
        note: 'TorBox kept answering with its own API address, so nothing was passed on.',
      }),
    ]);
    expect(pathsAsked().length).toBe(6);
    expect(text).not.toContain('api.torbox.app');
    expect(text).not.toContain(KEY);
  });
});

describe('the memory', () => {
  it('a second ask for the same film, tap or press, costs requestdl alone', async () => {
    world.hosts.set('api.torbox.app', torbox({ cached: [FILM], owned: [structuredClone(FILM)] }));
    expect((await tap()).body.url).toBe(`https://${FILE_SERVER}/dl/77/0`);
    expect(pathsAsked().length).toBe(4);
    for (const mode of ['play', 'ahead']) {
      world.asked = [];
      const again = await tap(mode);
      expect([again.body.url, pathsAsked()]).toEqual([`https://${FILE_SERVER}/dl/77/0`, ['/torrents/requestdl']]);
      expect(again.body.steps[1]).toMatchObject({
        step: 'owned',
        ok: true,
        note: 'Your server remembered this torrent from the last half hour.',
      });
    }
  });

  it('a remembered torrent TorBox no longer knows is asked again in full, once', async () => {
    const owned = [structuredClone(FILM)];
    world.hosts.set('api.torbox.app', torbox({ cached: [FILM], owned, nextId: 600 }));
    await tap();
    owned.length = 0; // removed from the account meanwhile
    world.asked = [];
    const { body } = await tap();
    expect(body.url).toBe(`https://${FILE_SERVER}/dl/600/0`);
    expect(pathsAsked()[0]).toBe('/torrents/requestdl');
    expect([...pathsAsked().slice(1, 3)].sort()).toEqual(['/torrents/checkcached', '/torrents/createtorrent']);
    expect([...pathsAsked().slice(3)].sort()).toEqual(['/torrents/mylist', '/torrents/requestdl']);
    expect(linkStep(body)).toMatchObject({
      ok: false,
      note: 'TorBox no longer knew the remembered torrent, so it was asked again.',
    });
  });
});
