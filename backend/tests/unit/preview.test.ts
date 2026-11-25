// A pick's preview (MUSIC.md §19.7), the pure parts: the search sends the pick's artist and album and
// nothing else, only https addresses on Apple's hosts pass, and the match takes the pick's artist and
// album (editions, " - EP" and case folded), the same album before a longer one and the lowest track
// first. Invented artists and albums only; the answers are shaped as Apple's search answers.
import { describe, expect, it } from 'vitest';
import { allowedPreview, matchPreview, searchUrl } from '../../src/areas/music/preview';

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
  'not a url',
  42,
  null,
];

describe('allowedPreview', () => {
  it("passes https on Apple's hosts only", () => {
    expect(allowedPreview(clip(1))).toBe(clip(1));
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
