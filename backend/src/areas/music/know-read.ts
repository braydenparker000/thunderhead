// The music knowledge as the mind and the owner read it (MUSIC.md §19.3): a facts row shaped into
// ArtistFacts or AlbumFacts (structured facts apart from `outside`, the free text from elsewhere), a
// person's credits, the unmatched albums. Keyed reads only: ids, names (by `know_names`), release
// groups (by `know_albums_rg`), a person's credits (by the key of `know_credits`).
import {
  type AlbumFacts,
  type ArtistFacts,
  type CreditsResponse,
  KNOW_LIMITS as K,
  type KnowOutside,
  type UnmatchedReason,
  type UnmatchedResponse,
} from '../../../../shared/contract/know.ts';
import type { Db } from '../../objects/base';
import { MBID } from './history-mb';
import { keyOf } from './history-parse';
import type { Facts, Outside } from './know-apply';
import * as ks from './know-store';

const outside = (o: Outside): KnowOutside => ({
  wikipedia: o.wikipedia ?? null,
  tags: o.tags ?? [],
  styles: o.styles ?? [],
});

/** One facts row as the contract has it. */
export function shape(db: Db, r: ks.FactsRow): ArtistFacts | AlbumFacts {
  const f = JSON.parse(r.facts_json) as Facts;
  const o = outside(JSON.parse(r.outside_json) as Outside);
  const filled = JSON.parse(r.filled_json) as ArtistFacts['filled'];
  const mbid = r.id.slice(2);
  if (r.kind === 'album') {
    const albums = ks.albumsOfGroup(db, mbid);
    return {
      kind: 'album',
      mbid,
      title: f.title ?? r.name,
      artist: f.artist ?? { mbid: null, name: '' },
      type: f.type ?? null,
      secondary: f.secondary ?? [],
      first_release: f.first_release ?? null,
      label: f.label ?? null,
      listeners: f.listeners ?? null,
      playcount: f.playcount ?? null,
      credits: f.credits ?? [],
      covers: f.covers ?? [],
      samples: f.samples ?? [],
      songs: {
        matched: albums.reduce((n, a) => n + a.matched_songs, 0),
        of: albums.reduce((n, a) => n + a.songs, 0),
      },
      in_library: albums.length > 0,
      filled,
      outside: o,
    };
  }
  const library = db.one<{ n: number }>(
    "SELECT count(*) AS n FROM know_albums WHERE artist_mbid = ? AND state = 'matched'",
    mbid,
  );
  return {
    kind: 'artist',
    mbid,
    name: f.name ?? r.name,
    type: f.type ?? null,
    origin: f.origin ?? null,
    begin: f.begin ?? null,
    end: f.end ?? null,
    members: f.members ?? [],
    member_of: f.member_of ?? [],
    influenced_by: f.influenced_by ?? [],
    influenced: f.influenced ?? [],
    awards: f.awards ?? [],
    discography: f.discography ?? [],
    library: library?.n ?? 0,
    filled,
    outside: o,
  };
}

/** The ids a reference names: a MusicBrainz id (artist or release group), or a name by its key. */
export function idsOf(db: Db, ref: string): string[] {
  const r = ref.trim().toLowerCase();
  if (MBID.test(r)) return [`a:${r}`, `g:${r}`];
  return ks.idsByName(db, keyOf(ref), K.refs * 2);
}

export function facts(db: Db, ref: string): (ArtistFacts | AlbumFacts)[] {
  const ids = idsOf(db, ref).filter((id) => !id.startsWith('n:'));
  return ks
    .factsByIds(db, ids)
    .filter((r) => r.kind !== 'lite' || r.facts_json !== '{}')
    .slice(0, K.refs)
    .map((r) => shape(db, r));
}

/** What in the library a person worked on (by the person's id, or a name), and their other work. */
export function credits(db: Db, ref: string): CreditsResponse {
  const r = ref.trim().toLowerCase();
  const people = MBID.test(r) ? [r] : idsOf(db, ref).map((id) => (id.startsWith('a:') ? id.slice(2) : id));
  for (const person of people) {
    const rows = ks.creditsOfPerson(db, person);
    if (!rows.length) continue;
    const roles = new Map<string, string[]>();
    for (const c of rows) roles.set(c.rg, [...(roles.get(c.rg) ?? []), c.role]);
    const groups = new Map(
      ks
        .factsByIds(
          db,
          [...roles.keys()].map((g) => `g:${g}`),
        )
        .map((g) => [g.id.slice(2), g]),
    );
    const library: CreditsResponse['library'] = [];
    for (const [rg, rs] of roles) {
      if (!ks.albumsOfGroup(db, rg).length) continue;
      const f = JSON.parse(groups.get(rg)?.facts_json ?? '{}') as Facts;
      library.push({
        album: f.title ?? groups.get(rg)?.name ?? '',
        mbid: rg,
        artist: f.artist?.name ?? '',
        roles: [...new Set(rs)],
      });
    }
    const own = person.startsWith('n:') ? null : ks.factsOf(db, `a:${person}`);
    const disco = (JSON.parse(own?.facts_json ?? '{}') as Facts).discography ?? [];
    return {
      person: { mbid: person.startsWith('n:') ? null : person, name: rows[0].name },
      library,
      other: disco.filter((d) => !roles.has(d.mbid) || !ks.albumsOfGroup(db, d.mbid).length).slice(0, 50),
    };
  }
  return { person: null, library: [], other: [] };
}

/** The albums left unmatched, the most played artist's first (the index `know_albums_due`). */
export function unmatched(db: Db, total: number): UnmatchedResponse {
  const items = db
    .all<{ artist: string; album: string; songs: number; reason: string }>(
      `SELECT artist, album, songs, reason FROM know_albums WHERE state = 'unmatched' ORDER BY plays DESC LIMIT ?`,
      K.unmatched_max,
    )
    .map((a) => ({ ...a, reason: a.reason as UnmatchedReason }));
  return { items, total: Math.max(total, items.length) };
}
