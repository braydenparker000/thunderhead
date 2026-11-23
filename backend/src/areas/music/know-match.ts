// Matching the catalog to MusicBrainz (MUSIC.md §19.1), pure: an album to one release group of its
// artist's discography, and its songs to the recordings of one release of that group. As strict as
// `lookup()`: a match only when it is sure; anything else stays unmatched with its reason. Titles are
// compared here, in the Worker: no title of the owner's ever leaves it (the discography was fetched by
// the artist's MusicBrainz id alone).
import type { KnowRelease, UnmatchedReason } from '../../../../shared/contract/know.ts';

/** A title for comparing: case, accents, punctuation and "&" folded. */
export const norm = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const EDITION =
  /\b(deluxe|remaster(ed)?|edition|expanded|anniversary|bonus|special|version|reissue|mono|stereo|explicit|clean|japan(ese)?|uk|us|international|collector s?|super|legacy)\b/;

/** A title with its edition's words left out: "(Deluxe Edition)", "[2011 Remaster]", "- Remastered
 * 2009" fold into the one release group. "(Live)" does not: a live album is its own group. */
export function fold(s: string): string {
  let t = s.replace(/[([{]([^)\]}]*)[)\]}]/g, (m, inner: string) => (EDITION.test(norm(inner)) ? ' ' : m));
  t = t.replace(/\s[-–—:]\s([^-–—:]*)$/, (m, tail: string) => (EDITION.test(norm(tail)) ? '' : m));
  return norm(t);
}

const yearOf = (date: string | null) => (date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null);

/** The release-group type a track count suggests. */
function typesFor(songs: number): string[] {
  if (songs >= 7) return ['Album'];
  if (songs >= 3) return ['EP', 'Album'];
  return ['Single', 'EP'];
}

/** One catalog album against its artist's discography: the release group, or why not. Exact titles
 * first, then folded ones; ties broken by the type its track count suggests, then by having no
 * secondary type, then by the year; still tied is unsure. */
export function matchAlbum(
  album: { title: string; songs: number; year: number },
  disco: KnowRelease[],
): { rg: string } | { reason: UnmatchedReason } {
  const want = norm(album.title);
  const exact = disco.filter((r) => norm(r.title) === want);
  let pool = exact.length ? exact : disco.filter((r) => fold(r.title) === fold(album.title));
  if (!pool.length) return { reason: 'no_release_group' };
  const narrow = (keep: (r: KnowRelease) => boolean) => {
    const kept = pool.filter(keep);
    if (kept.length) pool = kept;
  };
  if (pool.length > 1) narrow((r) => typesFor(album.songs).includes(r.type ?? ''));
  if (pool.length > 1) narrow((r) => !r.secondary.length);
  if (pool.length > 1 && album.year) narrow((r) => yearOf(r.date) === album.year);
  return pool.length === 1 ? { rg: pool[0].mbid } : { reason: 'several_release_groups' };
}

export interface ReleaseTracks {
  id: string;
  date: string | null;
  label: string | null;
  tracks: { position: number; title: string; recording: string }[];
}

/** The release that stands for the group in the catalog: the one with the catalog's track count and
 * the most titles in common, else the most titles in common. */
export function pickRelease(songs: { title: string }[], releases: ReleaseTracks[]): ReleaseTracks | null {
  const titles = new Set(songs.map((s) => fold(s.title)));
  const common = (r: ReleaseTracks) => r.tracks.filter((t) => titles.has(fold(t.title))).length;
  const ranked = [...releases].sort(
    (a, b) =>
      Number(b.tracks.length === songs.length) - Number(a.tracks.length === songs.length) ||
      common(b) - common(a) ||
      (a.id < b.id ? -1 : 1),
  );
  return ranked[0] && common(ranked[0]) > 0 ? ranked[0] : null;
}

/** Each catalog song to a recording of the release where its track list makes it sure: the one
 * track of that title, or of several, the one at the song's own track number. */
export function matchSongs(
  songs: { id: string; title: string; track: number | null }[],
  release: ReleaseTracks,
): { id: string; recording: string }[] {
  const out: { id: string; recording: string }[] = [];
  for (const s of songs) {
    const same = release.tracks.filter((t) => fold(t.title) === fold(s.title));
    const one = same.length === 1 ? same[0] : same.find((t) => s.track !== null && t.position === s.track);
    if (one) out.push({ id: s.id, recording: one.recording });
  }
  return out;
}

/** The kinds left out of a pick unless an artist has nothing else (MUSIC.md §19.4). */
const AWAY = new Set(['live', 'compilation', 'remix', 'dj-mix', 'mixtape/street', 'demo', 'interview', 'audiobook']);
/** An artist's release groups a pick may name: albums and EPs with no live, compilation or remix
 * type; all of them when that is all there is. */
export function eligible(disco: KnowRelease[]): KnowRelease[] {
  const plain = disco.filter(
    (r) =>
      (r.type === 'Album' || r.type === 'EP') &&
      !r.secondary.some((s) => AWAY.has(s.toLowerCase())) &&
      !/\b(reissue|remaster(ed)?)\b/.test(norm(r.title)),
  );
  return plain.length ? plain : disco;
}
