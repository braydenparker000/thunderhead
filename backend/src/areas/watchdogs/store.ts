// SQL for the watchdogs' state (migrations.ts) and the counts their checks read: the open day's
// start, server and client error counts, stuck jobs. Counts and names only, never content.
import type { WatchdogHandledRequest, WatchdogName } from '../../../../shared/contract/watchdogs.ts';
import type { Db } from '../../objects/base';

export interface WatchRow {
  name: WatchdogName;
  state: 'ok' | 'tripped';
  since: number | null;
  detail: string | null;
  trips: number;
  checked_at: number;
  snapshot_json: string | null;
  handled_at: number | null;
  handled_outcome: WatchdogHandledRequest['outcome'] | null;
  handled_note: string | null;
}

export const all = (db: Db): WatchRow[] => db.all<WatchRow>('SELECT * FROM watchdogs');
export const byName = (db: Db, name: string): WatchRow | null =>
  db.one<WatchRow>('SELECT * FROM watchdogs WHERE name = ?', name);

export function put(db: Db, r: WatchRow): void {
  db.run(
    `INSERT INTO watchdogs (name, state, since, detail, trips, checked_at, snapshot_json, handled_at, handled_outcome, handled_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET state = excluded.state, since = excluded.since, detail = excluded.detail,
       trips = excluded.trips, checked_at = excluded.checked_at, snapshot_json = excluded.snapshot_json,
       handled_at = excluded.handled_at, handled_outcome = excluded.handled_outcome, handled_note = excluded.handled_note`,
    r.name,
    r.state,
    r.since,
    r.detail,
    r.trips,
    r.checked_at,
    r.snapshot_json,
    r.handled_at,
    r.handled_outcome,
    r.handled_note,
  );
}

/** When the open day began: the day roll's write of `day.current`. */
export const dayStartedAt = (db: Db): { day: string; at: number } | null => {
  const r = db.one<{ value_json: string; updated_at: number }>(
    "SELECT value_json, updated_at FROM settings WHERE key = 'day.current'",
  );
  return r ? { day: JSON.parse(r.value_json) as string, at: r.updated_at } : null;
};

/** Every fingerprint's count for these sources (the errors table is a few hundred rows at most). */
export function errorCounts(db: Db, sources: readonly string[]): { fingerprint: string; count: number }[] {
  return db.all(
    `SELECT fingerprint, count FROM errors WHERE source IN (${sources.map(() => '?').join(', ')}) LIMIT 500`,
    ...sources,
  );
}

/** A job running too long or tried too often, if any. */
export function stuckJob(
  db: Db,
  runningBefore: number,
  attempts: number,
): { id: string; kind: string; state: string; attempts: number } | null {
  return db.one(
    `SELECT id, kind, state, attempts FROM jobs WHERE state IN ('queued', 'running', 'paused')
       AND ((state = 'running' AND updated_at < ?) OR attempts >= ?) LIMIT 1`,
    runningBefore,
    attempts,
  );
}

/** Reflex wakes since `since`, and whether one is still open. */
export function reflexWakes(db: Db, since: number): { n: number; open: number } {
  return (
    db.one<{ n: number; open: number }>(
      `SELECT count(*) AS n, coalesce(sum(status IN ('fired', 'unclaimed')), 0) AS open FROM wakes WHERE task = 'reflex' AND at >= ?`,
      since,
    ) ?? { n: 0, open: 0 }
  );
}
