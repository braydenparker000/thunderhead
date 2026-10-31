// SQL for the row meter's days (DATA.md §3), in every object's own database: one row per UTC day and
// object class. A write stores a day's whole totals and only ever raises them, so a write lost with
// a transaction that rolled back is made good by the next one, and an older answer never lowers a
// newer one.
import { DAY, utcDay } from '../../lib/time';
import type { Db } from '../../objects/base';

export interface DayRow {
  day: string;
  class: string;
  rows_read: number;
  rows_written: number;
}

/** Stores a class's totals for a day where they grew: 1 row written, none when nothing grew. */
export function putDay(db: Db, r: DayRow, at: number): void {
  db.run(
    `INSERT INTO meter_days (day, class, rows_read, rows_written, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (day, class) DO UPDATE SET rows_read = max(rows_read, excluded.rows_read),
       rows_written = max(rows_written, excluded.rows_written), updated_at = excluded.updated_at
     WHERE excluded.rows_read > rows_read OR excluded.rows_written > rows_written`,
    r.day,
    r.class,
    r.rows_read,
    r.rows_written,
    at,
  );
}

/** Adds rows written where no meter counts them (the drill's scratch copy, class `scratch`) to a
 * day's row: 1 row written. */
export function addWritten(db: Db, day: string, cls: string, rows: number, at: number): void {
  db.run(
    `INSERT INTO meter_days (day, class, rows_read, rows_written, updated_at) VALUES (?, ?, 0, ?, ?)
     ON CONFLICT (day, class) DO UPDATE SET rows_written = rows_written + excluded.rows_written,
       updated_at = excluded.updated_at`,
    day,
    cls,
    rows,
    at,
  );
}

export function dayOf(db: Db, day: string, cls: string): DayRow | null {
  return db.one<DayRow>(
    'SELECT day, class, rows_read, rows_written FROM meter_days WHERE day = ? AND class = ?',
    day,
    cls,
  );
}

/** Every class's rows from `from` on, newest day first (30 days of five classes at most). */
export function daysFrom(db: Db, from: string): DayRow[] {
  return db.all<DayRow>(
    'SELECT day, class, rows_read, rows_written FROM meter_days WHERE day >= ? ORDER BY day DESC, class LIMIT 400',
    from,
  );
}

/** A day's totals across every class Core heard from. */
export function dayTotals(db: Db, day: string): { rows_read: number; rows_written: number } {
  return (
    db.one<{ rows_read: number; rows_written: number }>(
      'SELECT coalesce(sum(rows_read), 0) AS rows_read, coalesce(sum(rows_written), 0) AS rows_written FROM meter_days WHERE day = ?',
      day,
    ) ?? { rows_read: 0, rows_written: 0 }
  );
}

/** Days older than 400 go (DATA.md §10), at most `max` rows a call. */
export function pruneDays(db: Db, now: number, max: number): number {
  return db.all(
    `DELETE FROM meter_days WHERE (day, class) IN (SELECT day, class FROM meter_days WHERE day < ? LIMIT ?)
     RETURNING 1`,
    utcDay(now - 400 * DAY),
    max,
  ).length;
}
