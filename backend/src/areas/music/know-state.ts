// The music knowledge job's own record in `music_state` (know-store.ts, MUSIC.md §19.2): `know.state`
// (the catalog version last read, when facts and the top artists were refreshed, when picks were
// built and from what, the phase, the waveforms' counts) and `know.hosts` (each host's failures in a
// row, when it may be asked again, when it last answered and refused).
import type { Db } from '../../objects/base';
import { getState, putState } from './listen-store';

export interface KnowState {
  seeded: number;
  refreshed: number;
  top_at: number;
  picks_at: number;
  /** What the picks were last built from: facts saved, and the plays' newest change. */
  facts_v: number;
  built_v: string;
  phase: 'matching' | 'facts' | 'picks' | 'idle';
  at: number;
  /** Stored waveforms by kind, counted as the albums are read (the seed reads every track anyway). */
  waveforms?: { rms: number; peak: number; none: number };
}
export const knowState = (db: Db): KnowState => ({
  seeded: -1,
  refreshed: 0,
  top_at: 0,
  picks_at: 0,
  facts_v: 0,
  built_v: '',
  phase: 'matching',
  at: 0,
  ...getState<Partial<KnowState>>(db, 'know.state'),
});
export const putKnowState = (db: Db, s: KnowState) => putState(db, 'know.state', s);

/** Each host: failures in a row, when it may be asked again, when it last answered and refused. */
export type Hosts = Record<string, { fails: number; until: number; ok_at?: number; refused_at?: number }>;
export const hostsOf = (db: Db): Hosts => getState<Hosts>(db, 'know.hosts') ?? {};
export const putHosts = (db: Db, h: Hosts) => putState(db, 'know.hosts', h);

/** The keys the job last saw (`know.keys`). A key that has arrived since (the owner added Last.fm's,
 * Discogs's or ListenBrainz's) puts its sources back on every row that could ask them and that the
 * service has never filled: such a row dropped them for want of the key and would otherwise wait for
 * its monthly round. ListenBrainz's labs host fills the same family without a token, so its token puts
 * `lbtop` back on every row that lacks it. Rows put back. */
export function keysArrived(
  db: Db,
  keys: { lastfm: boolean; discogs: boolean; listenbrainz: boolean },
  sources: Record<string, readonly string[]>,
): number {
  const seen = getState<Partial<typeof keys>>(db, 'know.keys');
  const families = ['lastfm', 'discogs', 'listenbrainz'] as const;
  if (seen && families.every((f) => !!seen[f] === keys[f])) return 0;
  let n = 0;
  for (const [family, prefix, filled] of [
    ['lastfm', 'fm', true],
    ['discogs', 'dc', true],
    ['listenbrainz', 'lbtop', false],
  ] as const) {
    if (!keys[family] || seen?.[family]) continue;
    for (const [kind, all] of Object.entries(sources)) {
      const add = all.filter((x) => x.startsWith(prefix));
      if (!add.length) continue;
      n += db.run(
        `UPDATE know_facts SET busy = 1, todo = trim(todo || ',' || ?1, ',')
         WHERE kind = ?2 AND (?5 = 0 OR json_extract(filled_json, ?3) IS NULL) AND instr(',' || todo || ',', ?4) = 0`,
        add.join(','),
        kind,
        `$.${family}`,
        `,${add[0]},`,
        filled ? 1 : 0,
      );
    }
  }
  putState(db, 'know.keys', keys);
  return n;
}
