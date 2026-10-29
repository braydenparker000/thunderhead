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
