// The row meter (DATA.md §3): every query's rows read and written, the units the Free plan bills
// per account and UTC day (5,000,000 read, 100,000 written). Counted in memory and kept in the
// object's own `meter_days` row for the day. The row is written when what isn't written yet
// reaches 10,000 rows read or 25 written, or 5 minutes have passed since its last write (counted
// from the stored row's own time, so a fresh instance writes at its first query if the last write
// is older), and once more for a day that closed. The check runs as each query's rows are added,
// so even a last big scan before an eviction is written; the write itself waits for the end of the
// current synchronous run, so a transaction's many queries cost one write. What an object loses
// to an eviction is therefore under 10,000 rows read and 25 written. The meter's own queries count
// toward the day, never toward a caller's numbers (the cost tests compare those).
import * as store from '../areas/meter/store';
import { DAY, dayBefore, MINUTE, utcDay } from '../lib/time';
import type { Db } from './base';

/** The most time between two writes of the day's row while it grows. */
export const FLUSH_MS = 5 * MINUTE;
/** What is written at once, whatever the time: rows read, and rows written, not yet stored. */
export const READ_STEP = 10_000;
export const WRITE_STEP = 25;

/** One UTC day's totals for this object. */
export interface MeterDay {
  day: string;
  rows_read: number;
  rows_written: number;
}

type Cursor = SqlStorageCursor<Record<string, SqlStorageValue>>;

export class Meter {
  /** Rows since this object started, the meter's own left out: what the cost tests compare. */
  rowsRead = 0;
  rowsWritten = 0;
  /** How many times the meter wrote its row since this object started (its own cost). */
  writes = 0;
  private db: Db | null = null;
  private cls = '';
  /** The UTC day counted, its bounds, and its totals: as stored when counting began, plus since. */
  private day = '';
  private from = 0;
  private to = 0;
  private read = 0;
  private written = 0;
  /** When the totals were last written, what they were then, and whether they grew since. */
  private storedAt = 0;
  private storedRead = 0;
  private storedWritten = 0;
  private dirty = false;
  /** A write waits for the end of the current synchronous run. */
  private pending = false;
  /** One of the meter's own queries is running. */
  private own = false;
  /** The day before today, for Core's tick: kept at the day's turn, else read once a start. */
  private before: MeterDay | null | undefined = undefined;

  /** Adds a finished query's rows (Db calls this for every query). */
  add(cursor: Cursor): void {
    const r = cursor.rowsRead;
    const w = cursor.rowsWritten;
    if (this.own) {
      this.read += r;
      this.written += w;
      return;
    }
    this.rowsRead += r;
    this.rowsWritten += w;
    if (!this.db) return;
    const now = Date.now();
    this.turn(now);
    this.read += r;
    this.written += w;
    this.dirty = true;
    if (this.due(now) && !this.pending) {
      // A microtask, not a timer: it runs before this object's code next waits on anything.
      this.pending = true;
      queueMicrotask(() => {
        this.pending = false;
        if (this.dirty) this.flush(Date.now());
      });
    }
  }

  /** Starts keeping the day once the object's schema has the table (base.ts, after its migrations).
   * What the start-up read before this counts toward the day too. */
  attach(db: Db, cls: string, now = Date.now()): void {
    this.db = db;
    this.cls = cls;
    this.storedAt = this.open(now)?.updated_at ?? 0;
    this.read += this.rowsRead;
    this.written += this.rowsWritten;
    this.dirty = this.rowsRead + this.rowsWritten > 0;
  }

  /** Today's totals, stored and not yet stored. */
  today(now = Date.now()): MeterDay {
    if (!this.db) return { day: utcDay(now), rows_read: this.rowsRead, rows_written: this.rowsWritten };
    this.turn(now);
    return { day: this.day, rows_read: this.read, rows_written: this.written };
  }

  /** Today's totals as they stand, without turning the day or writing (Core's quota reads them with
   * its stored rows); null before the meter keeps a day, or when its day isn't `now`'s. */
  live(now = Date.now()): (MeterDay & { class: string }) | null {
    if (!this.db || now < this.from || now >= this.to) return null;
    return { day: this.day, class: this.cls, rows_read: this.read, rows_written: this.written };
  }

  /** Core's tick asks (the RPC `meterFlush`): writes the day's row if it is due, and answers today's
   * totals and the day before's, so the minutes before midnight reach Core too. */
  report(now = Date.now()): MeterDay[] {
    if (!this.db) return [];
    const db = this.db;
    this.turn(now);
    if (this.dirty && this.due(now)) this.flush(now);
    if (this.before === undefined) {
      const row = this.mine(() => store.dayOf(db, dayBefore(this.day), this.cls));
      this.before = row ? { day: row.day, rows_read: row.rows_read, rows_written: row.rows_written } : null;
    }
    return [this.today(now), ...(this.before ? [this.before] : [])];
  }

  private due(now: number): boolean {
    return (
      this.read - this.storedRead >= READ_STEP ||
      this.written - this.storedWritten >= WRITE_STEP ||
      Math.abs(now - this.storedAt) >= FLUSH_MS
    );
  }

  /** A new UTC day (or the clock moved back past the day's start): the day that closed is written,
   * whatever the rules say, and the new one begins from what is stored for it. */
  private turn(now: number): void {
    if (now >= this.from && now < this.to) return;
    if (this.dirty) this.flush(now);
    const closed = now >= this.to ? { day: this.day, rows_read: this.read, rows_written: this.written } : undefined;
    this.open(now);
    this.before = closed;
  }

  /** Begins `now`'s day from its stored row, which it returns. */
  private open(now: number) {
    const db = this.db as Db;
    this.day = utcDay(now);
    this.from = Date.parse(`${this.day}T00:00:00Z`);
    this.to = this.from + DAY;
    this.read = 0;
    this.written = 0;
    this.dirty = false;
    const row = this.mine(() => store.dayOf(db, this.day, this.cls));
    this.read += row?.rows_read ?? 0;
    this.written += row?.rows_written ?? 0;
    this.storedRead = row?.rows_read ?? 0;
    this.storedWritten = row?.rows_written ?? 0;
    this.mine(() => store.pruneDays(db, now, 50));
    return row;
  }

  private flush(now: number): void {
    const db = this.db as Db;
    this.storedAt = now;
    this.storedRead = this.read;
    this.storedWritten = this.written;
    this.dirty = false;
    this.writes++;
    const row = { day: this.day, class: this.cls, rows_read: this.read, rows_written: this.written };
    this.mine(() => store.putDay(db, row, now));
  }

  /** One of the meter's own queries: its rows count toward the day only, and a failure (the table
   * gone with a drill instance's deleteAll, say) is dropped, since the next write stores the whole
   * totals again. */
  private mine<T>(fn: () => T): T | null {
    this.own = true;
    try {
      return fn();
    } catch {
      return null;
    } finally {
      this.own = false;
    }
  }
}
