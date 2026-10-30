// P6: Guitar's tab sources through the new Worker (GUITAR.md §11), for the owner's device only, from
// a fake upstream: Songsterr search, a song's tracks from its page, the chosen tracks' revisions
// (the second CDN when the first has none), GProTab search and a Guitar Pro download, and a
// sample. A source's own words reach the app in `details.reason`; a redirect off the source's own
// origin is refused; a song whose revision moved is a 409.
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { useFetch } from '../../src/areas/guitar/upstream';
import { makeAgent, setupOwner } from '../helpers';

let D = '';
let C = '';
const asked: string[] = [];
const META = {
  songId: 77,
  revisionId: 9001,
  image: 'img-1',
  title: 'Romanza',
  artist: 'Anonymous',
  tracks: [
    {
      partId: 0,
      instrumentId: 24,
      name: 'Guitar',
      instrument: 'Acoustic Nylon Guitar',
      tuning: [64, 59, 55, 50, 45, 40],
    },
    { partId: 1, instrumentId: 1024, name: 'Drums', isDrums: true },
  ],
};
const revision = {
  songId: 77,
  revisionId: 9001,
  partId: 0,
  measures: [{ voices: [{ beats: [{ notes: [{ fret: 0, string: 1 }] }] }] }],
};
const page = (meta: object) =>
  `<html><script id="state" type="application/json">${JSON.stringify({ meta: { current: meta } })}</script></html>`;

function upstream(url: string): Response {
  asked.push(url);
  const u = new URL(url);
  if (u.origin === 'https://www.songsterr.com' && u.pathname === '/api/songs')
    return Response.json([
      { songId: 77, title: 'Romanza', artist: 'Anonymous', tracks: META.tracks },
      { songId: 77, title: 'Romanza (dup)', artist: 'Anonymous' },
      { songId: 5, title: 'No player', artist: 'X', hasPlayer: false },
    ]);
  if (u.origin === 'https://www.songsterr.com' && u.pathname === '/a/wsa/song-tab-s77') return new Response(page(META));
  if (u.origin === 'https://www.songsterr.com' && u.pathname === '/a/wsa/song-tab-s78')
    return new Response(null, { status: 302, headers: { Location: 'https://elsewhere.example/x' } });
  if (u.origin === 'https://dqsljvtekg760.cloudfront.net') return new Response('', { status: 404 });
  if (u.origin === 'https://d3d3l6a6rcgkaf.cloudfront.net') return Response.json(revision);
  if (u.origin === 'https://gprotab.net' && u.pathname === '/en/search')
    return new Response(
      '<a href="/en/tabs/anon" class="tab-band">Anon &amp; Co</a> <a href="/en/tabs/anon/romanza" class="tab-name">Romanza</a>',
    );
  if (u.origin === 'https://gprotab.net' && u.pathname === '/en/tabs/anon/romanza')
    return new Response(Uint8Array.from([0x50, 0x4b, 3, 4, 1, 2, 3, 4]));
  if (u.origin === 'https://gleitz.github.io') return new Response(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0]));
  return new Response('', { status: 404 });
}

const get = async (path: string, token = D) => {
  const r = await app.fetch(
    new Request(`https://api.example.test/v1/guitar/${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '192.0.2.10' },
    }),
    env,
    createExecutionContext(),
  );
  return r;
};
const json = async (path: string, token = D) => {
  const r = await get(path, token);
  return {
    status: r.status,
    body: (await r.json()) as Record<string, unknown> & { error?: { code: string; details: { reason: string } } },
  };
};

beforeAll(async () => {
  useFetch(async (input) => upstream(String(input instanceof Request ? input.url : input)));
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
});
afterAll(() => useFetch((...a) => fetch(...a)));

describe('Guitar’s tab sources', () => {
  it('searches Songsterr, opens a song and builds the chosen tracks, from the second CDN if needed', async () => {
    const found = await json(`search?q=${encodeURIComponent('romanza')}`);
    expect(found.status).toBe(200);
    expect((found.body.results as { songId: number; title: string }[]).map((r) => [r.songId, r.title])).toEqual([
      [77, 'Romanza'],
    ]);
    const song = await json('songs/77');
    expect(song.body.song).toMatchObject({
      songId: 77,
      revisionId: 9001,
      tracks: [
        { partId: 0, kind: 'guitar' },
        { partId: 1, kind: 'drums' },
      ],
    });
    const score = await json('songs/77/score?revision=9001&parts=0');
    expect(score.status).toBe(200);
    expect((score.body.revisions as { revision: object }[])[0].revision).toEqual(revision);
    expect(asked.some((u) => u.startsWith('https://dqsljvtekg760.cloudfront.net'))).toBe(true);
  });

  it('a source’s words reach the app; a moved revision is a 409; a redirect elsewhere is refused', async () => {
    const short = await json('search?q=r');
    expect([short.status, short.body.error?.code, short.body.error?.details.reason]).toEqual([
      400,
      'bad_request',
      'Enter a song or artist (2–160 characters).',
    ]);
    const moved = await json('songs/77/score?revision=1&parts=0');
    expect([moved.status, moved.body.error?.details.reason]).toEqual([
      409,
      'This tab changed. Choose the song again to load the latest tracks.',
    ]);
    expect((await json('songs/77/score?revision=9001&parts=7')).status).toBe(400);
    const away = await json('songs/78');
    expect([away.status, away.body.error?.code]).toEqual([502, 'upstream']);
  });

  it('GProTab search and a Guitar Pro download; a sample; nothing for a mind', async () => {
    expect((await json('gprotab/search?q=romanza')).body.results).toEqual([
      { path: 'anon/romanza', artist: 'Anon & Co', title: 'Romanza' },
    ]);
    const file = await get(`gprotab/file?path=${encodeURIComponent('anon/romanza')}`);
    expect([file.status, file.headers.get('Content-Type')]).toEqual([200, 'application/octet-stream']);
    expect([...new Uint8Array(await file.arrayBuffer())].slice(0, 4)).toEqual([0x50, 0x4b, 3, 4]);
    const sample = await get('sounds/acoustic_guitar_nylon/E2.mp3');
    expect([sample.status, sample.headers.get('Content-Type')]).toEqual([200, 'audio/mpeg']);
    expect((await get('sounds/kazoo/E2.mp3')).status).toBe(404);
    expect((await get('search?q=romanza', C)).status).toBe(403);
  });
});
