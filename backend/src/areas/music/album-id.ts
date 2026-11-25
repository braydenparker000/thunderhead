// Every song's album id (`metadata.albumId`, MUSIC.md §1.3): `rg:<mbReleaseGroup>` when the song has
// one, else `al:<artist>|<title>`, the album's artist (`albumArtist`, else `artist` without a
// " feat. …" tail) and its title folded as the music knowledge folds them (know-match.ts: case,
// accents, punctuation, edition words; and a leading "The"). Stored when a song is registered or
// patched; for a record from before, the catalog's build adds it to the text without parsing it
// (`withAlbumId`), so the build stays one pass of string work and writes nothing.
import { fold, norm } from './know-match';

/** A featured artist's tail: " feat. X", " ft. X", " featuring X", "(feat X)", "[ft. X]". */
const FEAT = /\s*[([]\s*(?:feat|ft|featuring)\b\.?[^)\]]*[)\]]\s*$|\s+(?:feat|ft|featuring)\b\.?\s.*$/i;
const word = (s: string) => s.replace(/^the /, '').replace(/ /g, '-');

/** The album id of a song's tags. */
export function albumIdOf(meta: {
  album?: unknown;
  albumArtist?: unknown;
  artist?: unknown;
  mbReleaseGroup?: unknown;
}): string {
  if (typeof meta.mbReleaseGroup === 'string' && meta.mbReleaseGroup) return `rg:${meta.mbReleaseGroup}`;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const lead = str(meta.albumArtist).trim();
  const artist = lead || str(meta.artist).replace(FEAT, '');
  return `al:${word(norm(artist))}|${word(fold(str(meta.album)))}`;
}

/** The four tags the id is made of, as JSON string values (an escaped quote never ends a key). */
const TAG = /"(album|albumArtist|artist|mbReleaseGroup)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
const METADATA = /"metadata"\s*:\s*\{(\s*\})?/;

/** A stored record's JSON with `metadata.albumId` added when it has none, without parsing the record:
 * its tags read by one pattern pass. Nested objects hold no string under these names (the analysis's
 * `album` is an object), and a key's closing quote is never an escaped one, so a value cannot pass
 * for a key. A record without a `metadata` object is left as it is. */
export function withAlbumId(json: string): string {
  if (json.includes('"albumId":')) return json;
  const tags: Record<string, string> = {};
  for (const m of json.matchAll(TAG)) tags[m[1]] ??= m[2].includes('\\') ? (JSON.parse(`"${m[2]}"`) as string) : m[2];
  const id = JSON.stringify(albumIdOf(tags));
  return json.replace(METADATA, (_m, empty?: string) => `"metadata":{"albumId":${id}${empty ? '}' : ','}`);
}
