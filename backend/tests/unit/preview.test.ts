// A pick's preview (MUSIC.md §19.7), the pure parts: the search sends the pick's artist and album and
// nothing else, only https addresses on Apple's hosts pass, and the match takes the pick's artist and
// album (editions, " - EP" and case folded), the same album before a longer one and the lowest track
// first. Deezer, the second source, is asked and matched the same way. Invented artists and albums
// only; the answers are shaped as Apple's and Deezer's search answers.
import { describe, expect, it } from 'vitest';
import { allowedPreview, deezerUrl, matchDeezer, matchPreview, searchUrl } from '../../src/areas/music/preview';

const clip = (n: number) => `https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/x/${n}.m4a`;
const song = (over: Record<string, unknown>) => ({
  wrapperType: 'track',
  kind: 'song',
  artistName: 'The Quiet Harbours',
  collectionName: 'Paper Lanterns',
  trackNumber: 3,
  previewUrl: clip(3),
  ...over,
});

describe('searchUrl', () => {
  it("asks for the album's songs by artist and album, the words alone", () => {
    const u = new URL(searchUrl('The Quiet  Harbours', 'Paper Lanterns & Kites'));
    expect(u.origin).toBe('https://itunes.apple.com');
    expect(u.pathname).toBe('/search');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      media: 'music',
      entity: 'song',
      limit: '25',
      term: 'The Quiet Harbours Paper Lanterns & Kites',
    });
  });
});

const BAD = [
  'http://audio-ssl.itunes.apple.com/a.m4a',
  'https://apple.com.example.net/a.m4a',
  'https://example.net/a.apple.com',
  'https://evilapple.com/a.m4a',
  'https://u:p@audio-ssl.itunes.apple.com/a.m4a',
  'https://audio-ssl.itunes.apple.com:8443/a.m4a',
  'http://cdnt-preview.dzcdn.net/a.mp3',
  'https://dzcdn.net.example.net/a.mp3',
  'https://evildzcdn.net/a.mp3',
  'not a url',
  42,
  null,
];

describe('allowedPreview', () => {
  it("passes https on Apple's and Deezer's preview hosts only", () => {
    expect(allowedPreview(clip(1))).toBe(clip(1));
    const dzClip = 'https://cdnt-preview.dzcdn.net/api/1/a.mp3';
    expect(allowedPreview(dzClip)).toBe(dzClip);
    expect(allowedPreview('https://is1-ssl.mzstatic.com/a/b.m4a')).toBe('https://is1-ssl.mzstatic.com/a/b.m4a');
    for (const bad of BAD) expect(allowedPreview(bad), String(bad)).toBeNull();
  });
});

describe('matchPreview', () => {
  const at = (results: unknown[]) =>
    matchPreview({ resultCount: results.length, results }, 'The Quiet Harbours', 'Paper Lanterns');
  const track = (n: number, over: Record<string, unknown> = {}) =>
    song({ trackNumber: n, previewUrl: clip(n), ...over });

  it('takes the lowest track of the same artist and album', () => {
    expect(at([track(3), track(1), track(2)])).toBe(clip(1));
  });

  it('folds case, accents and editions, and takes the album as the start of a longer name', () => {
    const deluxe = { artistName: 'THE QUIET HARBOURS', collectionName: 'Paper Lanterns (Deluxe Edition)' };
    expect(at([track(4, deluxe)])).toBe(clip(4));
    expect(at([track(5, { collectionName: 'Paper Lanterns - EP' })])).toBe(clip(5));
    expect(at([track(1, { collectionName: 'Paper Lanterns - EP' }), track(3)])).toBe(clip(3));
  });

  it('never another artist, another album, a bad address or an answer of another shape', () => {
    expect(at([song({ artistName: 'The Quiet Harbours Tribute Band' })])).toBeNull();
    expect(at([song({ collectionName: 'Paper' })])).toBeNull();
    expect(at([song({ collectionName: 'Paper Lanternsong' })])).toBeNull();
    expect(at([song({ previewUrl: 'https://example.net/a.m4a' })])).toBeNull();
    expect(at([song({ previewUrl: undefined })])).toBeNull();
    expect(at([])).toBeNull();
    expect(matchPreview(null, 'The Quiet Harbours', 'Paper Lanterns')).toBeNull();
    expect(matchPreview({ results: 'none' }, 'The Quiet Harbours', 'Paper Lanterns')).toBeNull();
  });
});

const dz = (n: number) => `https://cdnt-preview.dzcdn.net/api/1/1/${n}.mp3`;
const dsong = (n: number, over: Record<string, unknown> = {}) => ({
  id: n,
  title: `Lamp ${n}`,
  preview: dz(n),
  artist: { name: 'The Quiet Harbours' },
  album: { title: 'Paper Lanterns' },
  ...over,
});

describe('deezerUrl', () => {
  it('asks for the artist and the album by field, quotes in a name dropped, 25 at most', () => {
    const u = new URL(deezerUrl('The "Quiet" Harbours', 'Paper Lanterns'));
    expect([u.origin, u.pathname]).toEqual(['https://api.deezer.com', '/search']);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      q: 'artist:"The Quiet Harbours" album:"Paper Lanterns"',
      limit: '25',
    });
  });
});

describe('matchDeezer', () => {
  const at = (data: unknown[]) => matchDeezer({ data, total: data.length }, 'The Quiet Harbours', 'Paper Lanterns');

  it("takes the first song of the pick's album, before a longer album's", () => {
    expect(at([dsong(4), dsong(2)])).toBe(dz(4));
    expect(at([dsong(1, { album: { title: 'Paper Lanterns - EP' } }), dsong(3)])).toBe(dz(3));
    expect(at([dsong(5, { album: { title: 'PAPER LANTERNS (Deluxe Edition)' } })])).toBe(dz(5));
    expect(at([dsong(6, { album: { title: 'Paper Lanterns Tour Extra' } })])).toBe(dz(6));
  });

  it('never another artist, another album, a bad address or an answer of another shape', () => {
    expect(at([dsong(1, { artist: { name: 'Quiet Harbours Tribute' } })])).toBeNull();
    expect(at([dsong(1, { album: { title: 'Paper' } })])).toBeNull();
    expect(at([dsong(1, { preview: 'https://example.net/a.mp3' })])).toBeNull();
    expect(at([dsong(1, { preview: '' }), null, 'x'])).toBeNull();
    expect(at([dsong(1, { artist: null, album: null })])).toBeNull();
    expect(matchDeezer({ error: { code: 4 } }, 'The Quiet Harbours', 'Paper Lanterns')).toBeNull();
    expect(matchDeezer(null, 'The Quiet Harbours', 'Paper Lanterns')).toBeNull();
  });
});
