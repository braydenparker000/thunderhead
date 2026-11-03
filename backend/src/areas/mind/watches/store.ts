// SQL for watches (shared/contract/watches.ts; the table is Core step 34, in mind/migrations.ts).
// Every read of the waiting ones names `state IN ('live', 'queued')`, the `watches_waiting` index's
// own condition, so it is one index read; the settled ones go through `watches_settled`. Stores
// never write the change feed.
import type { WatchKind, WatchState } from '../../../../../shared/contract/watches.ts';
import { DAY } from '../../../lib/time';
import type { Db } from '../../../objects/base';

export interface WatchRow {
  id: string;
  kind: WatchKind;
  fire_at: number | null;
  type: string | null;
  ref: string | null;
  why: string;
  note: string | null;
  outside: number;
  state: WatchState;
  created_at: number;
  until: number;
  session_id: string | null;
  met_at: number | null;
  met_ref: string | null;
  settled_at: number | null;
  by: 'wake' | 'event' | null;
  wake_id: string | null;
  to_session: string | null;
}

const WAITING = "state IN ('live', 'queued')";

export function insert(
  db: Db,
  r: Pick<
    WatchRow,
    'id' | 'kind' | 'fire_at' | 'type' | 'ref' | 'why' | 'note' | 'outside' | 'created_at' | 'until'
  > & {
    session_id: string | null;
  },
): void {
  db.run(
    `INSERT INTO watches (id, kind, fire_at, type, ref, why, note, outside, state, created_at, until, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?, ?)`,
    r.id,
    r.kind,
    r.fire_at,
    r.type,
    r.ref,
    r.why,
    r.note,
    r.outside,
    r.created_at,
    r.until,
    r.session_id,
  );
}

export const byId = (db: Db, id: string) => db.one<WatchRow>('SELECT * FROM watches WHERE id = ?', id);

/** The waiting watches (live and queued), oldest first: at most 20 by the set's own cap. */
export const waiting = (db: Db) => db.all<WatchRow>(`SELECT * FROM watches WHERE ${WAITING} ORDER BY created_at`);

/** What the Core keeps in memory: each waiting kind and type, the soonest time, any queued. */
export function summary(
  db: Db,
): { kind: WatchKind; type: string | null; n: number; at: number | null; queued: number }[] {
  return db.all(
    `SELECT kind, type, count(*) AS n, min(CASE WHEN state = 'live' THEN fire_at END) AS at,
       sum(state = 'queued') AS queued FROM watches WHERE ${WAITING} GROUP BY kind, type`,
  );
}

/** The live watches of a kind on these types (an event's or a change's). */
export function liveOn(db: Db, kind: 'event' | 'change', types: string[]): WatchRow[] {
  if (!types.length) return [];
  return db.all<WatchRow>(
    `SELECT * FROM watches WHERE ${WAITING} AND kind = ? AND type IN (${types.map(() => '?').join(', ')})
     AND state = 'live'`,
    kind,
    ...types,
  );
}

/** Live `at` watches due by `now`. */
export const dueAt = (db: Db, now: number) =>
  db.all<WatchRow>(
    `SELECT * FROM watches WHERE ${WAITING} AND kind = 'at' AND fire_at <= ? AND state = 'live' ORDER BY fire_at`,
    now,
  );

export function met(db: Db, id: string, at: number, ref: string | null): void {
  db.run("UPDATE watches SET state = 'queued', met_at = ?, met_ref = ? WHERE id = ? AND state = 'live'", at, ref, id);
}

/** Settles a waiting watch: fired, refused, cancelled or lapsed. */
export function settle(
  db: Db,
  id: string,
  state: Exclude<WatchState, 'live' | 'queued'>,
  at: number,
  extra: { by?: 'wake' | 'event'; wake_id?: string | null; to_session?: string | null } = {},
): void {
  db.run(
    `UPDATE watches SET state = ?, settled_at = ?, by = ?, wake_id = ?, to_session = ? WHERE id = ? AND ${WAITING}`,
    state,
    at,
    extra.by ?? null,
    extra.wake_id ?? null,
    extra.to_session ?? null,
    id,
  );
}

/** A cancelled watch waiting again (watch.cancel's undo). */
export function revive(db: Db, id: string): number {
  return db.run(
    "UPDATE watches SET state = 'live', settled_at = NULL, met_at = NULL, met_ref = NULL WHERE id = ? AND state = 'cancelled'",
    id,
  );
}

/** Watches fired into a wake no session has taken yet (a claim takes them; the last 12 hours). */
export const unclaimedFired = (db: Db, since: number) =>
  db.all<WatchRow>(
    "SELECT * FROM watches WHERE settled_at >= ? AND state = 'fired' AND by = 'wake' AND to_session IS NULL",
    since,
  );

export function handTo(db: Db, id: string, sessionId: string): void {
  db.run('UPDATE watches SET to_session = ? WHERE id = ?', sessionId, id);
}

/** The watches handed to a session since `since` (its briefing's reasons). */
export const handedTo = (db: Db, sessionId: string, since: number) =>
  db.all<WatchRow>(
    "SELECT * FROM watches WHERE settled_at >= ? AND state = 'fired' AND to_session = ? ORDER BY settled_at",
    since,
    sessionId,
  );

/** Watches settled since `since` (the list's last day, the meter), newest first. */
export const settledSince = (db: Db, since: number, limit: number) =>
  db.all<WatchRow>('SELECT * FROM watches WHERE settled_at >= ? ORDER BY settled_at DESC LIMIT ?', since, limit);

export function countWaiting(db: Db): number {
  return db.one<{ n: number }>(`SELECT count(*) AS n FROM watches WHERE ${WAITING}`)?.n ?? 0;
}

/** Refused over the budget since `since`. */
export function refusedSince(db: Db, since: number): number {
  return (
    db.one<{ n: number }>("SELECT count(*) AS n FROM watches WHERE settled_at >= ? AND state = 'over_budget'", since)
      ?.n ?? 0
  );
}

/** Chat wakes a watch fired since `since`: the budget's count (a retry is the same wake). */
export function watchWakes(db: Db, since: number): number {
  return (
    db.one<{ n: number }>(
      "SELECT count(*) AS n FROM wakes WHERE at >= ? AND task = 'chat' AND reason = 'watch' AND retry_of IS NULL",
      since,
    )?.n ?? 0
  );
}

/** The wake's reason (RUNTIME.md §4.2): `{watch, kind, note}`. */
export function setReason(db: Db, wakeId: string, reason: Record<string, unknown>): void {
  db.run('UPDATE wakes SET reason_json = ? WHERE id = ?', JSON.stringify(reason), wakeId);
}

/** A settled watch goes 30 days after it settled; a waiting one settles within 7 days and 12 hours. */
export function pruneWatches(db: Db, now: number, max: number): number {
  return db.all(
    'DELETE FROM watches WHERE id IN (SELECT id FROM watches WHERE settled_at < ? LIMIT ?) RETURNING 1',
    now - 30 * DAY,
    max,
  ).length;
}
