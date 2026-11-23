// SQL for the picks (know-sql.ts `picks`, MUSIC.md §19.4): one row per release group, its kind,
// score and reason (`body_json`: album, artist, year, type, reason, the order it went into) and the
// owner's answer (`state` new, declined, ordered, added). A rebuild replaces only rows still `new`;
// a declined one is never made again. The per-kind weights live in `music_state` (`picks.weights`).
import { PICK_KINDS, type Pick, type PickKind, type PickState } from '../../../../shared/contract/know.ts';
import type { Db } from '../../objects/base';
import { getState, putState } from './listen-store';
import { lineOf, type Scored, START_WEIGHTS } from './picks-score';

export interface PickRow {
  id: string;
  kind: PickKind;
  artist_mbid: string;
  body_json: string;
  score: number;
  state: PickState;
  why: string | null;
  played: number;
  made_at: number;
  state_at: number;
}
type Body = Omit<Scored, 'id' | 'kind' | 'artist_mbid' | 'score'> & { order_id?: string };

export const pickOf = (db: Db, id: string) => db.one<PickRow>('SELECT * FROM picks WHERE id = ?', id);
export const picksIn = (db: Db, state: PickState, limit: number) =>
  db.all<PickRow>('SELECT * FROM picks WHERE state = ? ORDER BY score DESC LIMIT ?', state, limit);

export function toPick(r: PickRow): Pick {
  const b = JSON.parse(r.body_json) as Body;
  const p = { album: b.album, artist: b.artist, year: b.year, reason: b.reason };
  return {
    id: r.id,
    kind: r.kind,
    album: b.album,
    artist: b.artist,
    artist_mbid: r.artist_mbid,
    year: b.year,
    type: b.type,
    score: r.score,
    reason: b.reason,
    line: lineOf(p),
    state: r.state,
    made_at: r.made_at,
    state_at: r.state_at,
  };
}

/** A rebuild's picks: new rows, rows still `new` updated; `new` rows it no longer makes go. */
export function putPicks(db: Db, picks: Scored[], at: number): number {
  let n = 0;
  const keep = new Set(picks.map((p) => p.id));
  for (const p of picks) {
    const { id, kind, artist_mbid, score, ...body } = p;
    n += db.run(
      `INSERT INTO picks (id, kind, artist_mbid, body_json, score, state, played, made_at, state_at)
       VALUES (?, ?, ?, ?, ?, 'new', 0, ?, ?)
       ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, body_json = excluded.body_json, score = excluded.score
       WHERE picks.state = 'new' AND (picks.score <> excluded.score OR picks.body_json <> excluded.body_json)`,
      id,
      kind,
      artist_mbid,
      JSON.stringify(body),
      score,
      at,
      at,
    );
  }
  for (const r of db.all<{ id: string }>(`SELECT id FROM picks WHERE state = 'new'`))
    if (!keep.has(r.id)) n += db.run('DELETE FROM picks WHERE id = ?', r.id);
  return n;
}

export function setState(
  db: Db,
  id: string,
  state: PickState,
  at: number,
  extra: { why?: string; order_id?: string } = {},
) {
  const r = pickOf(db, id);
  if (!r) return 0;
  const body = extra.order_id ? JSON.stringify({ ...JSON.parse(r.body_json), order_id: extra.order_id }) : r.body_json;
  return db.run(
    'UPDATE picks SET state = ?, state_at = ?, why = coalesce(?, why), body_json = ? WHERE id = ?',
    state,
    at,
    extra.why ?? null,
    body,
    id,
  );
}
export const markPlayed = (db: Db, id: string) => db.run('UPDATE picks SET played = 1 WHERE id = ?', id);

export const weightsOf = (db: Db): Record<PickKind, number> => ({
  ...START_WEIGHTS,
  ...getState<Partial<Record<PickKind, number>>>(db, 'picks.weights'),
});
export const putWeights = (db: Db, w: Record<PickKind, number>) => putState(db, 'picks.weights', w);

/** Picks by state, counted (the table holds at most a few hundred rows: the kept list and answers). */
export function pickCounts(db: Db): Record<PickState, number> {
  const out = { new: 0, declined: 0, ordered: 0, added: 0 } as Record<PickState, number>;
  for (const r of db.all<{ state: PickState; n: number }>('SELECT state, count(*) AS n FROM picks GROUP BY state'))
    out[r.state] = r.n;
  return out;
}
export const isKind = (k: string): k is PickKind => (PICK_KINDS as readonly string[]).includes(k);
