// What an answer gives tables beside its facts row (MUSIC.md §19.2): credits by person (and their
// names, so `th music credits <name>` reads by key), similar artists merged into `similar_artists`,
// a release group's songs matched to recordings, an album's MusicBrainz title by name; and a facts row
// put back after a restore (its first facts from the album's own row until MusicBrainz names it).
import { TASTE_LIMITS as T } from '../../../../shared/contract/taste.ts';
import type { Db } from '../../objects/base';
import { mergeSimilar, type Similar } from './history-mb';
import { keyOf } from './history-parse';
import { putSimilar, similarOf } from './history-store';
import type { Applied } from './know-apply';
import { keepReleases } from './know-seed';
import * as ks from './know-store';

export function keepExtras(db: Db, row: ks.FactsRow, a: Applied, now: number): number {
  let n = 0;
  const mbid = row.id.slice(2);
  if (a.credits) {
    const people = a.credits.map((c) => ({ person: c.mbid ?? `n:${keyOf(c.name)}`, role: c.role, name: c.name }));
    n += ks.putCredits(db, mbid, people);
    for (const p of people) n += ks.putName(db, keyOf(p.name), p.person.startsWith('n:') ? p.person : `a:${p.person}`);
  }
  if (a.similar) {
    const had = similarOf(db, mbid);
    const old = had && now - had.fetched_at < T.similar_ms ? (JSON.parse(had.items_json) as Similar[]) : null;
    n += putSimilar(db, mbid, mergeSimilar(old, a.similar), now);
  }
  if (a.releases) n += keepReleases(db, mbid, a);
  if (row.kind === 'album' && a.facts.title && a.work.named) n += ks.putName(db, keyOf(a.facts.title), row.id);
  return n;
}

/** A facts row a restore left out, put back to be fetched again. */
export function putBack(
  db: Db,
  r: { id: string; kind: 'artist' | 'album'; name: string; prio: number; todo: string },
  now: number,
): void {
  ks.ensureFacts(db, r.id, r.kind, r.name, r.prio, r.todo, now);
  if (r.kind !== 'album') return;
  const a = ks.albumsOfGroup(db, r.id.slice(2))[0];
  const row = ks.factsOf(db, r.id);
  if (a && row?.facts_json === '{}')
    ks.saveFacts(db, row, {
      ...row,
      facts_json: JSON.stringify({ title: a.album, artist: { mbid: a.artist_mbid, name: a.artist } }),
      at: now,
    });
}
