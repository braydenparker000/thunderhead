// SQL for the routines (routines.ts, DATA.md §4.3): at most 12 rows, so a list reads them all; the
// tick's check reads the soonest `next_at` through `routines_next` and an event's through
// `routines_event`. Stores never write the change feed.
import type { Db } from '../../objects/base';

export interface RoutineRow {
  id: string;
  name: string;
  what: string;
  why: string;
  steps_json: string;
  /** The condition as approved: `{at, days?}`, `{after}`, or `{fact, at, days}` (its usual time). */
  cond_json: string;
  when_text: string;
  event_type: string | null;
  actor: string;
  proposal_id: string;
  permit: string | null;
  status: 'on' | 'off';
  approved_at: number;
  updated_at: number;
  next_at: number | null;
  last_run_at: number | null;
  last_ledger_id: string | null;
  last_day: string | null;
  last_error: string | null;
}

export const byId = (db: Db, id: string) => db.one<RoutineRow>('SELECT * FROM routines WHERE id = ?', id);

export const all = (db: Db) => db.all<RoutineRow>('SELECT * FROM routines ORDER BY approved_at, id LIMIT 50');

export const count = (db: Db) => db.one<{ n: number }>('SELECT COUNT(*) AS n FROM routines')?.n ?? 0;

export function insert(db: Db, r: RoutineRow): void {
  db.run(
    `INSERT INTO routines (id, name, what, why, steps_json, cond_json, when_text, event_type, actor, proposal_id,
       permit, status, approved_at, updated_at, next_at, last_run_at, last_ledger_id, last_day, last_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.id,
    r.name,
    r.what,
    r.why,
    r.steps_json,
    r.cond_json,
    r.when_text,
    r.event_type,
    r.actor,
    r.proposal_id,
    r.permit,
    r.status,
    r.approved_at,
    r.updated_at,
    r.next_at,
    r.last_run_at,
    r.last_ledger_id,
    r.last_day,
    r.last_error,
  );
}

/** The soonest time a routine that is on comes due (one index read), or null. */
export const soonest = (db: Db) =>
  db.one<{ t: number }>('SELECT next_at AS t FROM routines WHERE next_at IS NOT NULL ORDER BY next_at LIMIT 1')?.t ??
  null;

/** Routines due by `now`, soonest first. */
export const due = (db: Db, now: number, limit: number) =>
  db.all<{ id: string }>(
    'SELECT id FROM routines WHERE next_at IS NOT NULL AND next_at <= ? ORDER BY next_at LIMIT ?',
    now,
    limit,
  );

/** Due before `end` (the brief's "Now": routines today), soonest first. */
export const dueBefore = (db: Db, end: number, limit: number) =>
  db.all<{ name: string; next_at: number }>(
    'SELECT name, next_at FROM routines WHERE next_at IS NOT NULL AND next_at < ? ORDER BY next_at LIMIT ?',
    end,
    limit,
  );

/** The sense types routines that are on wait for. */
export const eventTypes = (db: Db) =>
  db
    .all<{ t: string }>(
      "SELECT DISTINCT event_type AS t FROM routines WHERE event_type IS NOT NULL AND status = 'on' LIMIT 50",
    )
    .map((r) => r.t);

export const onEvent = (db: Db, type: string) =>
  db.all<{ id: string }>(
    "SELECT id FROM routines WHERE event_type = ? AND status = 'on' ORDER BY approved_at LIMIT 12",
    type,
  );

export function setStatus(db: Db, id: string, status: 'on' | 'off', next: number | null, at: number): void {
  db.run('UPDATE routines SET status = ?, next_at = ?, updated_at = ? WHERE id = ?', status, next, at, id);
}

export const setNext = (db: Db, id: string, next: number | null) =>
  db.run('UPDATE routines SET next_at = ? WHERE id = ?', next, id);

/** A run recorded: when, its ledger row (null when it failed: nothing to undo), its logical day,
 * and why it stopped. */
export function ran(
  db: Db,
  id: string,
  r: { at: number; ledger_id: string | null; day: string; error: string | null; next: number | null },
): void {
  db.run(
    `UPDATE routines SET last_run_at = ?, last_ledger_id = ?, last_day = ?, last_error = ?,
       next_at = ?, updated_at = ? WHERE id = ?`,
    r.at,
    r.ledger_id,
    r.day,
    r.error,
    r.next,
    r.at,
    id,
  );
}

export const remove = (db: Db, id: string) => db.run('DELETE FROM routines WHERE id = ?', id);
