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

/** Adds rows to a class's day as they happen: written where no meter counts them (the drill's
 * scratch copy, class `scratch`), or read in another object by a heavy step (a backup part, the
 * senses archive), ahead of that object's own answer at the next tick, which `putDay` then folds in
 * (it only raises). 1 row written; dropped, never thrown, if the meter can't be written. */
export function addRows(db: Db, day: string, cls: string, read: number, written: number, at: number): void {
  try {
    db.run(
      `INSERT INTO meter_days (day, class, rows_read, rows_written, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (day, class) DO UPDATE SET rows_read = rows_read + excluded.rows_read,
         rows_written = rows_written + excluded.rows_written, updated_at = excluded.updated_at`,
      day,
      cls,
      read,
      written,
      at,
    );
  } catch {
    // A meter that can't be written drops these rows; it never fails the step or the tick that read
    // them (the object's own answer at the next tick still brings its reads).
  }
}

/** A class's stored day, and when it was last written. */
export function dayOf(db: Db, day: string, cls: string): (DayRow & { updated_at: number }) | null {
  return db.one<DayRow & { updated_at: number }>(
    'SELECT day, class, rows_read, rows_written, updated_at FROM meter_days WHERE day = ? AND class = ?',
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

/** One day's rows, a row per class Core heard from (six at most). */
export function dayRows(db: Db, day: string): DayRow[] {
  return db.all<DayRow>(
    'SELECT day, class, rows_read, rows_written FROM meter_days WHERE day = ? ORDER BY class LIMIT 20',
    day,
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
