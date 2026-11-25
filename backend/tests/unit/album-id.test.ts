// Every song's album id (areas/music/album-id.ts): the same album spelled with other case,
// punctuation, a leading "The", an edition's words or a featured artist is one id; other albums, or
// the same title by another artist, are others; a MusicBrainz release group wins. The catalog's build
// adds the id to an older record's text without parsing it, and leaves one that has it. And the extra
// tags a song keeps (meta-extra.ts, through validate.ts). Invented artists and albums only.
import { describe, expect, it } from 'vitest';
import { albumIdOf, withAlbumId } from '../../src/areas/music/album-id';
import { BadTag } from '../../src/areas/music/meta-extra';
import { ignoredKeys, metadata } from '../../src/areas/music/validate';

const RG = '0f3c8a52-1d2e-4b7a-9c61-5e2f7a8b9c0d';

describe('albumIdOf', () => {
  it('folds case, punctuation, accents, a leading "The" and editions into one id', () => {
    const id = albumIdOf({ artist: 'The Quiet Harbours', album: 'Paper Lanterns' });
    expect(id).toBe('al:quiet-harbours|paper-lanterns');
    for (const meta of [
      { artist: 'quiet harbours', album: 'PAPER LANTERNS' },
      { artist: 'The Quiet Harbours!', album: 'Paper  Lanterns.' },
      { artist: 'Quiet Hárbours', album: 'Paper Lanterns (Deluxe Edition)' },
      { artist: 'The Quiet Harbours', album: 'Paper Lanterns - Remastered 2011' },
    ])
      expect(albumIdOf(meta), JSON.stringify(meta)).toBe(id);
  });

  it("takes the album's artist, else the artist without a featured one", () => {
    const id = albumIdOf({ artist: 'The Quiet Harbours', album: 'Paper Lanterns' });
    for (const artist of [
      'The Quiet Harbours feat. Mira Okon',
      'The Quiet Harbours ft. Mira Okon',
      'The Quiet Harbours (feat. Mira Okon)',
      'The Quiet Harbours [ft Mira Okon]',
      'The Quiet Harbours featuring Mira Okon',
    ])
      expect(albumIdOf({ artist, album: 'Paper Lanterns' }), artist).toBe(id);
    expect(albumIdOf({ albumArtist: 'The Quiet Harbours', artist: 'Mira Okon', album: 'Paper Lanterns' })).toBe(id);
  });

  it('keeps other albums, and the same title by another artist, apart', () => {
    const id = albumIdOf({ artist: 'The Quiet Harbours', album: 'Paper Lanterns' });
    expect(albumIdOf({ artist: 'The Quiet Harbours', album: 'Paper Lanterns Live' })).not.toBe(id);
    expect(albumIdOf({ artist: 'The Quiet Harbours', album: 'Harbour Lights' })).not.toBe(id);
    expect(albumIdOf({ artist: 'Mira Okon', album: 'Paper Lanterns' })).not.toBe(id);
    const various = { artist: 'Mira Okon', album: 'Paper Lanterns', albumArtist: 'Various Artists' };
    expect(albumIdOf(various)).not.toBe(id);
  });

  it('a release group wins over the names', () => {
    expect(albumIdOf({ artist: 'The Quiet Harbours', album: 'Paper Lanterns', mbReleaseGroup: RG })).toBe(`rg:${RG}`);
    expect(albumIdOf({ artist: 'Someone Else', album: 'Other', mbReleaseGroup: RG })).toBe(`rg:${RG}`);
  });
});

describe('withAlbumId', () => {
  const rec = (metadata: object, extra: object = {}) => JSON.stringify({ id: 'r2_native_x', metadata, ...extra });

  it("adds the id to an older record's metadata, the record otherwise as it was", () => {
    const meta = { title: 'Lamp "One"', artist: 'The Quiet Harbours', album: 'Paper Lanterns', dur: 200 };
    const out = JSON.parse(withAlbumId(rec(meta, { path: 'a.opus' })));
    expect(out).toEqual({
      id: 'r2_native_x',
      metadata: { albumId: 'al:quiet-harbours|paper-lanterns', ...meta },
      path: 'a.opus',
    });
    expect(JSON.parse(withAlbumId(rec({})))).toEqual({ id: 'r2_native_x', metadata: { albumId: 'al:|' } });
  });

  it('reads escaped names, never a value that looks like a key, nor the analysis album', () => {
    const meta = {
      title: 'x","album":"Decoy',
      artist: 'The \\"Quiet\\" Harbours',
      album: 'Paper Lanterns',
      audioAnalysis: { album: { id: 'g' } },
    };
    const out = JSON.parse(withAlbumId(rec(meta)));
    expect(out.metadata.albumId).toBe(albumIdOf(meta));
    expect(out.metadata.albumId).toBe('al:quiet-harbours|paper-lanterns');
  });

  it('leaves a record that has its id, and takes a release group', () => {
    const has = rec({ albumId: 'al:kept|as-is', artist: 'A', album: 'B' });
    expect(withAlbumId(has)).toBe(has);
    const grouped = JSON.parse(withAlbumId(rec({ artist: 'A', album: 'B', mbReleaseGroup: RG })));
    expect(grouped.metadata.albumId).toBe(`rg:${RG}`);
  });
});

describe('the extra tags', () => {
  const base = { title: 'Lamp One', artist: 'The Quiet Harbours', dur: 200 };
  const bad = (over: object) => {
    try {
      metadata({ ...base, ...over });
    } catch (e) {
      return e instanceof BadTag ? e.message : 'invalid';
    }
    return null;
  };

  it('keeps isrc (upper-cased), label, totals, compilation and the original year; takes lower-case totals', () => {
    const m = metadata({
      ...base,
      isrc: 'usabc2600001',
      label: 'Invented Records',
      tracktotal: 9,
      disctotal: 2,
      compilation: false,
      originalyear: 1999,
    });
    expect(m).toMatchObject({
      isrc: 'USABC2600001',
      label: 'Invented Records',
      trackTotal: 9,
      discTotal: 2,
      compilation: false,
      originalYear: 1999,
    });
    expect(m).not.toHaveProperty('tracktotal');
    expect(metadata({ ...base, trackTotal: 10, tracktotal: 9 }).trackTotal).toBe(10);
  });

  it('refuses a bad value naming its field', () => {
    expect(bad({ isrc: 'US-ABC-26-00001' })).toBe('isrc');
    expect(bad({ isrc: 'USABC26' })).toBe('isrc');
    expect(bad({ trackTotal: 0 })).toBe('trackTotal');
    expect(bad({ disctotal: 1.5 })).toBe('discTotal');
    expect(bad({ compilation: 'yes' })).toBe('compilation');
    expect(bad({ originalYear: -1 })).toBe('originalYear');
    expect(bad({ label: 'a\nb' })).toBe('label');
    expect(bad({ label: 'Invented Records' })).toBeNull();
  });

  it('names the keys it does not keep', () => {
    const sent = { ...base, isrc: 'USABC2600001', tracktotal: 9, mood: 'calm', bpm: 120 };
    expect(ignoredKeys(sent)).toEqual(['mood', 'bpm']);
    expect(ignoredKeys({ ...base, albumId: 'al:x|y' })).toEqual([]);
    expect(ignoredKeys(null)).toEqual([]);
  });
});
