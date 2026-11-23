// Matching the catalog to MusicBrainz (MUSIC.md §19.1): editions fold into one release group, ties
// are broken by type, secondary type and year, anything still unsure stays unmatched with its reason;
// songs match recordings only where the track list makes it sure. Invented artists and albums only.
import { describe, expect, it } from 'vitest';
import type { KnowRelease } from '../../../shared/contract/know.ts';
import { eligible, fold, matchAlbum, matchSongs, pickRelease } from '../../src/areas/music/know-match';
import { albumsOf } from '../../src/areas/music/know-seed';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const rg = (n: number, title: string, over: Partial<KnowRelease> = {}): KnowRelease => ({
  mbid: id(n),
  title,
  type: 'Album',
  secondary: [],
  date: '2001-05-01',
  listens: null,
  ...over,
});

describe('albums to release groups', () => {
  const disco = [
    rg(1, 'Paper Lanterns'),
    rg(2, 'Paper Lanterns', { type: 'Single', date: '2001-03-01' }),
    rg(3, 'Paper Lanterns (Live)', { secondary: ['Live'] }),
    rg(4, 'Night Orchard', { date: '2004-01-01' }),
    rg(5, 'Night Orchard', { date: '2009-01-01' }),
    rg(6, 'Glass Harbour'),
    rg(7, 'Glass Harbour', { secondary: ['Compilation'] }),
  ];

  it('folds deluxe, remastered and regional editions into the one group', () => {
    expect(fold('Paper Lanterns (Deluxe Edition)')).toBe('paper lanterns');
    expect(fold('Paper Lanterns [2011 Remaster]')).toBe('paper lanterns');
    expect(fold('Paper Lanterns - Remastered 2009')).toBe('paper lanterns');
    expect(fold('Paper Lanterns (Japan Edition)')).toBe('paper lanterns');
    expect(fold('Paper Lanterns (Live)')).toBe('paper lanterns live');
    const m = matchAlbum({ title: 'Paper Lanterns (Super Deluxe Edition)', songs: 14, year: 2021 }, disco);
    expect(m).toEqual({ rg: id(1) });
  });

  it('breaks ties by the type its track count suggests, then no secondary type, then the year', () => {
    expect(matchAlbum({ title: 'Paper Lanterns', songs: 2, year: 0 }, disco)).toEqual({ rg: id(2) });
    expect(matchAlbum({ title: 'Paper Lanterns', songs: 11, year: 0 }, disco)).toEqual({ rg: id(1) });
    expect(matchAlbum({ title: 'Glass Harbour', songs: 10, year: 0 }, disco)).toEqual({ rg: id(6) });
    expect(matchAlbum({ title: 'Night Orchard', songs: 10, year: 2009 }, disco)).toEqual({ rg: id(5) });
  });

  it('leaves an unsure one unmatched, with why', () => {
    expect(matchAlbum({ title: 'Night Orchard', songs: 10, year: 0 }, disco)).toEqual({
      reason: 'several_release_groups',
    });
    expect(matchAlbum({ title: 'Night Orchard', songs: 10, year: 1999 }, disco)).toEqual({
      reason: 'several_release_groups',
    });
    expect(matchAlbum({ title: 'An Album Nobody Made', songs: 10, year: 0 }, disco)).toEqual({
      reason: 'no_release_group',
    });
  });

  it('keeps only albums and EPs for a pick unless that is all there is', () => {
    expect(eligible(disco).map((r) => r.mbid)).toEqual([id(1), id(4), id(5), id(6)]);
    const live = [rg(8, 'Only Live', { secondary: ['Live'] })];
    expect(eligible(live)).toEqual(live);
  });
});

describe('songs to recordings', () => {
  const release = (n: number, titles: string[]) => ({
    id: id(100 + n),
    date: '2001-05-01',
    label: 'Invented Label',
    tracks: titles.map((t, i) => ({ position: i + 1, title: t, recording: id(200 + n * 10 + i) })),
  });
  const songs = [
    { id: 's1', title: 'First Light', track: 1 },
    { id: 's2', title: 'Interlude', track: 2 },
    { id: 's3', title: 'Interlude', track: 4 },
    { id: 's4', title: 'Not On It', track: 5 },
  ];

  it('chooses the release with the same track count and most titles in common', () => {
    const r = pickRelease(songs, [
      release(1, ['First Light']),
      release(2, ['First Light', 'Interlude', 'Other', 'Interlude']),
    ]);
    expect(r?.id).toBe(id(102));
    expect(pickRelease([{ title: 'Nothing alike' }], [release(1, ['First Light'])])).toBeNull();
  });

  it('matches a title found once, or by track number among several; leaves the rest', () => {
    const r = release(2, ['First Light', 'Interlude', 'Other', 'Interlude']);
    expect(matchSongs(songs, r)).toEqual([
      { id: 's1', recording: id(220) },
      { id: 's2', recording: id(221) },
      { id: 's3', recording: id(223) },
    ]);
    expect(matchSongs([{ id: 's9', title: 'Interlude', track: null }], r)).toEqual([]);
  });

  it("groups the catalog's songs by album, with Muse's ids where every song agrees", () => {
    const rec = (title: string, meta: Record<string, unknown>) => ({
      id: title,
      record_json: JSON.stringify({
        metadata: { title, artist: 'Invented Artist 1', album: 'Paper Lanterns', ...meta },
      }),
    });
    const a = albumsOf([
      rec('one', { track: 1, mbReleaseGroup: id(1), mbRecording: id(301) }),
      rec('two', { track: 2, mbReleaseGroup: id(1) }),
      rec('three', { album: '' }),
    ]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ artist_key: 'invented artist 1', hint: id(1), artist_mbid: null });
    expect(a[0].songs.map((s) => [s.id, s.track, s.recording])).toEqual([
      ['one', 1, id(301)],
      ['two', 2, null],
    ]);
    const split = albumsOf([rec('one', { mbReleaseGroup: id(1) }), rec('two', { mbReleaseGroup: id(2) })]);
    expect(split[0].hint).toBeNull();
  });
});
