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
