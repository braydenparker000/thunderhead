// The three listening-history formats (areas/music/history-parse.ts) and the zip reader
// (history-zip.ts), on invented exports (history-helpers.ts): plays, minutes and skips counted, track
// titles never kept, the summary the same on every run.
import { describe, expect, it } from 'vitest';
import { cells, keyOf, parseExport, sourceOf, summarise, yearOf } from '../../src/areas/music/history-parse';
import { guessSource, readExport } from '../../src/areas/music/history-read';
import { historyEntries, zipEntries } from '../../src/areas/music/history-zip';
import { ARTIST, lastfmCsv, lastfmPages, spotifyRows, youtubeRows, zip } from '../history-helpers';

describe('the three exports', () => {
  it("Spotify: a play from 30 s, every stream's minutes, podcasts skipped", () => {
    const p = parseExport('Streaming_History_Audio_2019-2023_0.json', JSON.stringify(spotifyRows(100, 4)));
    expect(p?.source).toBe('spotify');
    expect(p?.skipped).toBe(2);
    expect(p?.plays.length).toBe(98);
    expect(p?.plays.filter((x) => x.play).length).toBe(98 - 18);
    expect(Object.keys(p?.plays[0] ?? {}).sort()).toEqual(['album', 'artist', 'ms', 'play', 'year']);
  });

  it("Spotify's older account-data file reads too", () => {
    const rows = [{ endTime: '2020-03-01 10:00', artistName: ARTIST(1), trackName: 'Invented', msPlayed: 40_000 }];
    const p = parseExport('StreamingHistory_music_0.json', JSON.stringify(rows));
    expect(p?.plays).toEqual([{ artist: ARTIST(1), album: '', year: 2020, ms: 40_000, play: 1 }]);
  });

  it('YouTube Music: only Music entries, the "- Topic" left off the artist', () => {
    const p = parseExport('watch-history.json', JSON.stringify(youtubeRows(12, 3)));
    expect(p?.source).toBe('youtube');
    expect(p?.plays.length).toBe(12);
    expect(new Set(p?.plays.map((x) => x.artist))).toEqual(new Set([ARTIST(0), ARTIST(1), ARTIST(2)]));
  });

  it('Last.fm: json pages without the one now playing, and csv with quotes', () => {
    const j = parseExport('scrobbles.json', JSON.stringify(lastfmPages(30, 3)));
    expect([j?.source, j?.plays.length, j?.plays[0].year]).toEqual(['lastfm', 30, 2015]);
    const c = parseExport('lastfm.csv', lastfmCsv(20, 2));
    expect([c?.source, c?.plays.length, c?.plays[0].album, c?.plays[0].year]).toEqual([
      'lastfm',
      20,
      'Invented album, 0',
      2018,
    ]);
    const named = parseExport('x.csv', `uts,utc_time,artist,artist_mbid,album\n1500000000,x,${ARTIST(3)},,A`);
    expect(named?.plays).toEqual([{ artist: ARTIST(3), album: 'A', year: 2017, ms: 0, play: 1 }]);
    expect(cells('"a ""b""",c')).toEqual(['a "b"', 'c']);
  });

  it('a file of none of the three is refused, and the kind is told from the first row', () => {
    expect(parseExport('notes.json', '[{"text":"x"}]')).toBeNull();
    expect(parseExport('broken.json', '[{')).toBeNull();
    expect(sourceOf('export.json', [{ ms_played: 1 }])).toBe('spotify');
    expect(sourceOf('export.json', [{ header: 'YouTube Music', time: 'x' }])).toBe('youtube');
    expect([yearOf('nope'), yearOf(0), yearOf('1999-01-01T00:00:00Z')]).toEqual([0, 0, 0]);
  });
});

describe('the summary', () => {
  it('sums by artist key, album and year, the same order every time, and keeps no title', () => {
    const plays = parseExport('Streaming_History_Audio_0.json', JSON.stringify(spotifyRows(500, 5, 2)))?.plays ?? [];
    const a = summarise(plays);
    expect(summarise([...plays].reverse())).toEqual(a);
    expect(a.reduce((s, r) => s + r.p, 0)).toBe(plays.filter((x) => x.play).length);
    expect(JSON.stringify(a)).not.toContain('Invented song');
    expect(keyOf('  Invented  ARTIST 1 - Topic')).toBe('invented artist 1');
  });
});

describe('zips', () => {
  it("reads a Spotify zip's audio files, deflated or stored, and leaves the video and the rest", async () => {
    const z = await zip([
      {
        name: 'Spotify Extended Streaming History/Streaming_History_Audio_2019_0.json',
        text: JSON.stringify(spotifyRows(60, 3)),
      },
      {
        name: 'Spotify Extended Streaming History/Streaming_History_Audio_2020_1.json',
        text: JSON.stringify(spotifyRows(40, 3)),
        store: true,
      },
      {
        name: 'Spotify Extended Streaming History/Streaming_History_Video_2020.json',
        text: JSON.stringify(spotifyRows(10, 3)),
      },
      { name: 'Spotify Extended Streaming History/ReadMeFirst.pdf', text: 'x' },
    ]);
    expect(historyEntries(zipEntries(z) ?? []).map((e) => e.name.split('/')[1])).toEqual([
      'Streaming_History_Audio_2019_0.json',
      'Streaming_History_Audio_2020_1.json',
    ]);
    expect(guessSource('my_spotify_data.zip', z)).toBe('spotify');
    const r = await readExport('my_spotify_data.zip', z);
    expect(r?.source).toBe('spotify');
    expect(r?.skipped).toBe(2 + 1);
    expect(r?.rows.reduce((s, x) => s + x.p, 0)).toBe(80);
  });

  it("reads a Takeout zip's watch history and not its searches", async () => {
    const z = await zip([
      { name: 'Takeout/YouTube and YouTube Music/history/watch-history.json', text: JSON.stringify(youtubeRows(8, 2)) },
      {
        name: 'Takeout/YouTube and YouTube Music/history/search-history.json',
        text: JSON.stringify(youtubeRows(5, 2)),
      },
    ]);
    const r = await readExport('takeout.zip', z);
    expect([r?.source, r?.rows.reduce((s, x) => s + x.p, 0)]).toEqual(['youtube', 8]);
    expect(zipEntries(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
