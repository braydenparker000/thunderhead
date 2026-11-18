// Which file of a torrent Astra's relay asks TorBox for (areas/astra/files.ts): the add-on's index
// when it agrees with the name and size, else the one file of that name, else of that size, else
// the one video (samples and small files set aside), and never a guess between two. Invented
// torrents only.
import { describe, expect, it } from 'vitest';
import { chooseFile, type Hints, mediaType, type TorrentFile, typeOfName } from '../../src/areas/astra/files';

const MB = 1024 * 1024;
const file = (id: number, name: string, size: number | null, type: string | null = null): TorrentFile => ({
  id,
  name,
  size,
  type,
});
const PACK = [
  file(0, 'Invented Show S01/Invented.Show.S01E01.mkv', 900 * MB),
  file(1, 'Invented Show S01/Invented.Show.S01E02.mkv', 910 * MB),
  file(2, 'Invented Show S01/Sample/Invented.Show.S01E01.sample.mkv', 30 * MB),
  file(3, 'Invented Show S01/info.nfo', 2000),
];
const none: Hints = { fileIndex: null, fileName: null, fileSize: null };
const id = (h: Partial<Hints>, files = PACK) => chooseFile(files, { ...none, ...h })?.id ?? null;

describe('choosing the file', () => {
  it('takes the index when it names a file and agrees with the name and size given', () => {
    expect(id({ fileIndex: 1 })).toBe(1);
    expect(id({ fileIndex: 1, fileName: 'Invented.Show.S01E02.mkv', fileSize: 910 * MB })).toBe(1);
  });

  it('trusts the name and size over an index that disagrees, or names no file', () => {
    // The add-on counted files differently: index 0, but the name and size are the second episode's.
    expect(id({ fileIndex: 0, fileName: 'Invented.Show.S01E02.mkv' })).toBe(1);
    expect(id({ fileIndex: 0, fileSize: 910 * MB })).toBe(1);
    expect(id({ fileIndex: 9, fileName: 'Invented.Show.S01E01.mkv' })).toBe(0);
  });

  it('takes the one file of that base name, narrowed by size when several share it', () => {
    expect(id({ fileName: 'Invented.Show.S01E01.mkv' })).toBe(0);
    // A path is compared by its last part.
    expect(id({ fileName: 'Some Folder/Invented.Show.S01E02.mkv' })).toBe(1);
    const twins = [file(0, 'A/movie.mkv', 700 * MB), file(1, 'B/movie.mkv', 1400 * MB)];
    expect(id({ fileName: 'movie.mkv', fileSize: 1400 * MB }, twins)).toBe(1);
    expect(id({ fileName: 'movie.mkv' }, twins)).toBeNull();
  });

  it('takes the one file of that size', () => {
    expect(id({ fileSize: 900 * MB })).toBe(0);
    expect(id({ fileName: 'Not.In.This.Torrent.mkv', fileSize: 910 * MB })).toBe(1);
  });

  it('takes the one video when nothing else tells, setting aside samples and small files', () => {
    const film = [
      file(0, 'Invented Film (2001)/Invented.Film.2001.mp4', 2100 * MB),
      file(1, 'Invented Film (2001)/Sample.mp4', 60 * MB),
      file(2, 'Invented Film (2001)/extras-trailer.mkv', 40 * MB),
      file(3, 'Invented Film (2001)/subs.srt', 80_000),
    ];
    expect(id({}, film)).toBe(0);
    expect(id({ fileName: 'renamed-by-the-addon.mp4' }, film)).toBe(0);
  });

  it('refuses to guess between two candidates', () => {
    expect(id({})).toBeNull();
    expect(id({ fileName: 'Invented.Show.S01E03.mkv' })).toBeNull();
    const same = [file(0, 'a.mkv', 800 * MB), file(1, 'b.mkv', 800 * MB)];
    expect(id({ fileSize: 800 * MB }, same)).toBeNull();
    expect(id({}, [])).toBeNull();
  });

  it('reads types from a header or an extension, and nothing else of them', () => {
    expect(mediaType('video/x-matroska; charset=binary')).toBe('video/x-matroska');
    expect(mediaType('text/html<script>')).toBeNull();
    expect(mediaType(42)).toBeNull();
    expect(typeOfName('Invented.Show.S01E01.MKV')).toBe('video/x-matroska');
    expect(typeOfName('info.nfo')).toBeNull();
  });
});
