// What the picks are scored from (MUSIC.md §19.4): the owner's love for each artist and album, from
// the imported history (plays by year), plays on the site (`track_plays`, by when last played),
// ratings and early skips, recent listening weighing more than old; then the stored facts of the
// artists they love and of the artists and people a pick may come through. Read once a rebuild (at
// most daily): the catalog's albums, the plays and the ratings whole, the history of the top 100
// artists and the facts rows by key.
import type { Db } from '../../objects/base';
import { topArtists } from './history-store';
import { fold } from './know-match';
import { albumKey, type SeedSong } from './know-seed';
import type { AlbumRow } from './know-store';

/** A play this many years ago counts half; a site play last made this many days ago counts half. */
const YEAR_HALF = 3;
const SITE_HALF_DAYS = 180;
/** A site play weighs as much as this many imported plays (it is the owner choosing now). */
const SITE_W = 2;
/** A rating's weight, as plays: 5 adds 4, 1 takes 4 away. */
const RATING_W = 2;
const SKIP_W = 1;

export interface Love {
  /** By artist MusicBrainz id: raw love (plays, weighted) and a canonical name when known. */
  artists: Map<string, { raw: number; name: string }>;
  /** By release group: raw love, the album's artist id, and how much was played on the site since. */
  albums: Map<string, { raw: number; artist: string | null; site: number; lastPlayed: number }>;
  library: { rgs: Set<string>; artists: Set<string>; titles: Map<string, Set<string>> };
}

export function loveOf(db: Db, now: number, skips: Record<string, number>): Love {
  const albums = db.all<AlbumRow>('SELECT * FROM know_albums');
  const song = new Map<string, AlbumRow>();
  for (const a of albums) for (const s of JSON.parse(a.songs_json) as SeedSong[]) song.set(s.id, a);
  const keyToMbid = new Map<string, string>();
  for (const a of albums) if (a.artist_mbid) keyToMbid.set(a.artist_key, a.artist_mbid);
  const out: Love = {
    artists: new Map(),
    albums: new Map(),
    library: {
      rgs: new Set(albums.flatMap((a) => (a.rg ? [a.rg] : []))),
      artists: new Set(albums.flatMap((a) => (a.artist_mbid ? [a.artist_mbid] : []))),
      titles: new Map(),
    },
  };
  // Every album the owner has, matched or not, by its artist and folded title.
  for (const a of albums)
    if (a.artist_mbid)
      out.library.titles.set(a.artist_mbid, (out.library.titles.get(a.artist_mbid) ?? new Set()).add(fold(a.album)));
  const rgOfKey = new Map(albums.flatMap((a) => (a.rg ? [[a.album_key, a.rg] as const] : [])));
  const addArtist = (mbid: string | null | undefined, raw: number, name = '') => {
    if (!mbid) return;
    const a = out.artists.get(mbid) ?? { raw: 0, name };
    a.raw += raw;
    if (name) a.name = name;
    out.artists.set(mbid, a);
  };
  const addAlbum = (rg: string | null | undefined, artist: string | null, raw: number, site = 0, last = 0) => {
    if (!rg) return;
    const a = out.albums.get(rg) ?? { raw: 0, artist, site: 0, lastPlayed: 0 };
    a.raw += raw;
    a.site += site;
    a.lastPlayed = Math.max(a.lastPlayed, last);
    out.albums.set(rg, a);
  };
  const thisYear = new Date(now).getUTCFullYear();
  for (const t of topArtists(db, 100)) {
    const mbid = t.mbid ?? keyToMbid.get(t.artist_key) ?? null;
    if (!mbid) continue;
    const rows = db.all<{ album: string; year: number; plays: number }>(
      'SELECT album, year, plays FROM listens WHERE artist_key = ?',
      t.artist_key,
    );
    for (const r of rows) {
      const w = r.plays * 0.5 ** (Math.max(0, thisYear - r.year) / YEAR_HALF);
      addArtist(mbid, w, t.mb_state === 'found' ? (t.canonical ?? '') : '');
      addAlbum(rgOfKey.get(albumKey(t.artist_key, r.album)), mbid, w);
    }
  }
  for (const p of db.all<{ track_id: string; plays: number; last_played: number }>(
    'SELECT track_id, plays, last_played FROM track_plays',
  )) {
    const a = song.get(p.track_id);
    if (!a) continue;
    const w = SITE_W * p.plays * 0.5 ** (Math.max(0, now - p.last_played) / (SITE_HALF_DAYS * 86_400_000));
    addArtist(a.artist_mbid, w);
    addAlbum(a.rg, a.artist_mbid, w, p.plays, p.last_played);
  }
  for (const r of db.all<{ track_id: string; rating: number }>(
    'SELECT track_id, rating FROM track_ratings WHERE rating > 0',
  )) {
    const a = song.get(r.track_id);
    if (!a) continue;
    addArtist(a.artist_mbid, RATING_W * (r.rating - 3));
    addAlbum(a.rg, a.artist_mbid, RATING_W * (r.rating - 3));
  }
  for (const [id, n] of Object.entries(skips)) {
    const a = song.get(id);
    if (!a) continue;
    addArtist(a.artist_mbid, -SKIP_W * n);
    addAlbum(a.rg, a.artist_mbid, -SKIP_W * n);
  }
  return out;
}

/** Raw love scaled 0–1 by its log against the largest; none for a love at or under zero. */
export function scaled<T extends { raw: number }>(m: Map<string, T>): Map<string, number> {
  const max = Math.max(0, ...[...m.values()].map((v) => v.raw));
  const out = new Map<string, number>();
  if (max <= 0) return out;
  for (const [k, v] of m) if (v.raw > 0) out.set(k, Math.round((Math.log1p(v.raw) / Math.log1p(max)) * 1000) / 1000);
  return out;
}
