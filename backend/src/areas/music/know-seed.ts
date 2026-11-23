// The catalog's albums as the matching sees them (MUSIC.md §19.1): songs grouped by their artist's
// and album's keys, with the track count, the year, and the MusicBrainz ids Muse sent with the songs
// (`mbArtist`, `mbReleaseGroup`, `mbRecording` in a song's tags), which match exactly; kept in
// `know_albums` when the catalog changes, and a release group's songs matched to one of its releases.
import type { Db } from '../../objects/base';
import { MBID } from './history-mb';
import { keyOf } from './history-parse';
import type { Applied } from './know-apply';
import { matchSongs, pickRelease } from './know-match';
import * as ks from './know-store';
import { inParts, marks } from './store-notes';

export interface SeedSong {
  id: string;
  title: string;
  track: number | null;
  recording: string | null;
}
export interface SeedAlbum {
  album_key: string;
  artist_key: string;
  artist: string;
  album: string;
  year: number;
  songs: SeedSong[];
  /** The release group Muse named, when every song that names one names the same. */
  hint: string | null;
  /** The artist Muse named, likewise. */
  artist_mbid: string | null;
}

export const albumKey = (artistKey: string, album: string) => `${artistKey}\u0001${keyOf(album)}`;

const one = (ids: (string | null)[]) => {
  const set = new Set(ids.filter((x): x is string => !!x));
  return set.size === 1 ? [...set][0] : null;
};
const mbid = (v: unknown) => (typeof v === 'string' && MBID.test(v) ? v : null);

/** Every catalog album with a name, from the tracks' records. */
export function albumsOf(rows: { id: string; record_json: string }[]): SeedAlbum[] {
  const by = new Map<string, SeedAlbum & { rgs: (string | null)[]; arts: (string | null)[] }>();
  for (const r of rows) {
    const m = ((JSON.parse(r.record_json) as { metadata?: Record<string, unknown> }).metadata ?? {}) as Record<
      string,
      unknown
    >;
    const s = (k: string) => (typeof m[k] === 'string' ? (m[k] as string).trim() : '');
    const artist = s('albumArtist') || s('artist');
    const album = s('album');
    const ak = keyOf(artist);
    if (!ak || !keyOf(album)) continue;
    const key = albumKey(ak, album);
    const a = by.get(key) ?? {
      album_key: key,
      artist_key: ak,
      artist: artist.slice(0, 200),
      album: album.slice(0, 200),
      year: 0,
      songs: [],
      hint: null,
      artist_mbid: null,
      rgs: [],
      arts: [],
    };
    const track = Number(m.track);
    a.songs.push({
      id: r.id,
      title: s('title'),
      track: Number.isInteger(track) && track > 0 ? track : null,
      recording: mbid(m.mbRecording),
    });
    a.year = Math.max(a.year, Number(m.year) || 0);
    a.rgs.push(mbid(m.mbReleaseGroup));
    a.arts.push(mbid(m.mbArtist));
    by.set(key, a);
  }
  return [...by.values()].map(({ rgs, arts, ...a }) => ({ ...a, hint: one(rgs), artist_mbid: one(arts) }));
}

/** The catalog's albums into `know_albums` (catalog version `v`), each with its artist's plays and
 * the artist's MusicBrainz id when Muse or the history gave one: a row is written only when what it
 * holds changed; albums no longer there go. The waveforms are counted by kind on the way. */
export function seedAlbums(
  db: Db,
  rows: { id: string; record_json: string; w: number }[],
  v: number,
  now: number,
): void {
  const albums = albumsOf(rows);
  const waveforms = { rms: 0, peak: 0, none: 0 };
  for (const r of rows)
    if (!r.w) waveforms.none++;
    else if (r.record_json.includes('"waveformKind":"rms"')) waveforms.rms++;
    else waveforms.peak++;
  const keys = [...new Set(albums.map((a) => a.artist_key))];
  const plays = new Map(
    inParts(keys, (p) =>
      db.all<{ artist_key: string; plays: number; mbid: string | null }>(
        `SELECT artist_key, plays, mbid FROM listen_artists WHERE artist_key IN (${marks(p.length)})`,
        ...p,
      ),
    ).map((r) => [r.artist_key, r]),
  );
  for (const a of albums) {
    const songs: SeedSong[] = a.songs.map((s) => ({ ...s, title: s.title.slice(0, 200) }));
    ks.putAlbum(db, {
      ...a,
      songs: songs.length,
      songs_json: JSON.stringify(songs),
      plays: plays.get(a.artist_key)?.plays ?? 0,
      seen: v,
      at: now,
    });
    const mbid = a.artist_mbid ?? plays.get(a.artist_key)?.mbid ?? null;
    if (mbid) ks.setArtist(db, a.artist_key, mbid, null, now);
  }
  ks.dropGone(db, new Set(albums.map((a) => a.album_key)));
  ks.putKnowState(db, { ...ks.knowState(db), seeded: v, waveforms });
}

/** A release group's releases: for each catalog album of it, the release that stands for it, its
 * label and date (into the album's facts), and its songs matched to recordings where sure. */
export function keepReleases(db: Db, rg: string, a: Applied): number {
  let n = 0;
  for (const al of ks.albumsOfGroup(db, rg)) {
    const songs = JSON.parse(al.songs_json) as SeedSong[];
    const r = pickRelease(songs, a.releases ?? []);
    if (!r) continue;
    a.work.release ??= r.id;
    a.facts.label ??= r.label;
    a.facts.first_release ??= r.date;
    const sure = matchSongs(songs, r).map((s) => ({ ...s, how: 'tracklist' }));
    const muse = songs.flatMap((s) => (s.recording ? [{ id: s.id, recording: s.recording, how: 'muse' }] : []));
    const by = new Map([...sure, ...muse].map((s) => [s.id, s]));
    n += ks.putSongs(db, al.album_key, [...by.values()]);
  }
  return n;
}
