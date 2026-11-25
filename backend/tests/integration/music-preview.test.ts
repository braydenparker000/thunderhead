// A pick's preview, end to end (MUSIC.md §19.7): the owner's tap asks Apple's search for the pick's
// artist and album alone and passes the matching song's clip through, audio only, kept a day by the
// phone; when Apple refuses (429, as it answers the Worker in production) or lacks the album, Deezer's
// search is asked the same way and its clip passed through. The address is remembered in the isolate
// (nothing written), a lookup while both gates are closed (once a second each) is 429, an album
// neither has or a clip that is not audio is 404, and a mind key never reaches it. Apple and Deezer
// are fakes (useFetch, as know-helpers.ts fakes the other services); invented music only.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorBody } from '../../../shared/contract/api';
import { useFetch } from '../../src/areas/music/history-mb';
import { forgetPreviews } from '../../src/areas/music/preview-fetch';
import { api, apiJson, rowsDuring } from '../helpers';
import { mbidOf } from '../history-helpers';
import { gid, musicSql } from '../know-helpers';
import { type Principals, principals } from '../memory-helpers';
import { music } from '../music-helpers';

const ARTIST = 'The Quiet Harbours';
const CLIP = 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/x/1.m4a';
const DZ_CLIP = 'https://cdnt-preview.dzcdn.net/api/1/1/a/b/c/ferries.mp3';
const BYTES = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
const MP3 = new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0]);
const calls: string[] = [];
const heads: string[] = [];
let p: Principals;
let clipType = 'audio/x-m4a';
let appleRefuses = false;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });

/** Deezer's search: the ferries album has its song; every other album none. */
function deezer(url: string): Response {
  const q = new URL(url).searchParams.get('q') ?? '';
  const song = { id: 7, preview: DZ_CLIP, artist: { name: ARTIST }, album: { title: 'Night Ferries' } };
  const data = q.includes('album:"Night Ferries"') ? [song] : [];
  return json({ data, total: data.length });
}

const fake: typeof fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  calls.push(url);
  heads.push([...new Headers(init?.headers).entries()].map(([k, v]) => `${k}: ${v}`).join('\n'));
  if (url === CLIP) return new Response(BYTES, { headers: { 'Content-Type': clipType } });
  if (url === DZ_CLIP) return new Response(MP3, { headers: { 'Content-Type': 'audio/mpeg' } });
  if (url.startsWith('https://api.deezer.com/search?')) return deezer(url);
  if (appleRefuses) return new Response('{}', { status: 429 });
  const term = new URL(url).searchParams.get('term') ?? '';
  const song = (collectionName: string, trackNumber: number, previewUrl = `${CLIP}?n=${trackNumber}`) => ({
    wrapperType: 'track',
    kind: 'song',
    artistName: ARTIST,
    collectionName,
    trackNumber,
    previewUrl,
  });
  // The EP's first song and the album's third are not the one: the album's lowest track is.
  const lanterns = [song('Paper Lanterns - EP', 1), song('Paper Lanterns', 3), song('Paper Lanterns', 2, CLIP)];
  const results = term.includes('Paper Lanterns') ? lanterns : [];
  return json({ resultCount: results.length, results });
};

const pick = (n: number, album: string) =>
  musicSql(
    `INSERT INTO picks (id, kind, artist_mbid, body_json, score, state, played, made_at, state_at)
     VALUES (?, 'gap', ?, ?, 0.5, 'new', 0, 0, 0)`,
    gid(n),
    mbidOf(0),
    JSON.stringify({ album, artist: ARTIST, year: 2004, type: 'Album', reason: { kind: 'gap' } }),
  );
const preview = (n: number, token = p.D) => api('GET', `/v1/music/picks/${gid(n)}/preview`, { token });
const searches = () => calls.filter((u) => u.startsWith('https://itunes.apple.com/search?')).length;
const deezers = () => calls.filter((u) => u.startsWith('https://api.deezer.com/search?')).length;

beforeAll(async () => {
  p = await principals();
  await pick(201, 'Paper Lanterns');
  await pick(202, 'Harbour Lights');
  await pick(203, 'Night Ferries');
  forgetPreviews();
  useFetch(fake);
});

describe("a pick's preview", () => {
  it("asks Apple for the pick's artist and album alone and passes the clip through, writing nothing", async () => {
    let r = new Response();
    const rows = await rowsDuring(music() as never, async () => {
      r = await preview(201);
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('audio/x-m4a');
    expect(r.headers.get('Cache-Control')).toBe('private, max-age=86400');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(BYTES);
    expect(rows.written).toBe(0);
    const search = new URL(calls[0]);
    expect(Object.fromEntries(search.searchParams)).toEqual({
      media: 'music',
      entity: 'song',
      limit: '25',
      term: `${ARTIST} Paper Lanterns`,
    });
    // Apple had it: Deezer is not asked.
    expect(calls[1]).toBe(CLIP);
    expect(deezers()).toBe(0);
    expect(heads[0]).toContain('user-agent: Thunderhead/1.0');
    expect(heads.join('\n')).not.toMatch(/authorization|cookie/i);
  });

  it('remembers the address; inside a second Deezer alone is asked, then both gates are closed: 429', async () => {
    expect((await preview(201)).status).toBe(200);
    expect(searches()).toBe(1);
    // Apple's gate is closed: Deezer alone is asked, has no such album; not remembered (Apple wasn't asked).
    expect((await preview(202)).status).toBe(404);
    expect([searches(), deezers()]).toEqual([1, 1]);
    const busy = await apiJson<ErrorBody>('GET', `/v1/music/picks/${gid(202)}/preview`, { token: p.D });
    expect([busy.status, busy.body.error.code]).toEqual([429, 'rate_limited']);
    expect([searches(), deezers()]).toEqual([1, 1]);
  });

  it('an album neither has, a clip that is not audio, or no such pick is 404 not_found', async () => {
    useFetch(fake);
    const miss = await apiJson<ErrorBody>('GET', `/v1/music/picks/${gid(202)}/preview`, { token: p.D });
    expect([miss.status, miss.body.error.code]).toEqual([404, 'not_found']);
    expect([searches(), deezers()]).toEqual([2, 2]);
    // Both answered without it: the miss is remembered.
    expect((await preview(202)).status).toBe(404);
    expect([searches(), deezers()]).toEqual([2, 2]);
    clipType = 'text/html';
    expect((await preview(201)).status).toBe(404);
    clipType = 'audio/x-m4a';
    expect((await preview(999)).status).toBe(404);
    expect((await api('GET', '/v1/music/picks/not-an-id/preview', { token: p.D })).status).toBe(422);
  });

  it("Apple refusing (429): Deezer's search for the artist and album, and its clip passed through", async () => {
    appleRefuses = true;
    useFetch(fake);
    const before = calls.length;
    let r = new Response();
    const rows = await rowsDuring(music() as never, async () => {
      r = await preview(203);
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(MP3);
    expect(rows.written).toBe(0);
    const asked = calls.slice(before);
    expect(asked[0]).toMatch(/^https:\/\/itunes\.apple\.com\/search\?/);
    const dz = new URL(asked[1]);
    expect([dz.origin, dz.pathname]).toEqual(['https://api.deezer.com', '/search']);
    expect(Object.fromEntries(dz.searchParams)).toEqual({ q: `artist:"${ARTIST}" album:"Night Ferries"`, limit: '25' });
    expect(asked[2]).toBe(DZ_CLIP);
    // Remembered: no lookup the second time.
    expect((await preview(203)).status).toBe(200);
    expect(calls.length).toBe(before + 4);
    appleRefuses = false;
  });

  it('is the owner tap alone: a mind key is 403', async () => {
    const before = calls.length;
    expect((await preview(201, p.C)).status).toBe(403);
    expect(calls.length).toBe(before);
  });
});
