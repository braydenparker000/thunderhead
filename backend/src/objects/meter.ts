// The row meter (DATA.md §3): every query's rows read and written, the units the Free plan bills
// per account and UTC day (5,000,000 read, 100,000 written). Counted in memory and kept in the
// object's own `meter_days` row for the day, written on the first query a minute or more after the
// last write, and on the first query of a new UTC day for the day that closed. So it costs at most
// one row written a minute, and only in minutes the object is used. What an object counted since
// its last write is lost if Cloudflare evicts it before the next one: at most about the last minute
// of its use. The meter's own queries count toward the day, never toward a caller's numbers (the
// cost tests compare those).
import * as store from '../areas/meter/store';
import { DAY, dayBefore, MINUTE, utcDay } from '../lib/time';
import type { Db } from './base';

/** The least time between two writes of the day's row. */
export const FLUSH_MS = MINUTE;

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
  private db: Db | null = null;
  private cls = '';
  /** The UTC day counted, its bounds, and its totals: as stored when counting began, plus since. */
  private day = '';
  private from = 0;
  private to = 0;
  private read = 0;
  private written = 0;
  /** When the totals were last written, and whether they grew since. */
  private storedAt = 0;
  private dirty = false;
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
    if (Math.abs(now - this.storedAt) >= FLUSH_MS) this.flush(now);
  }

  /** Starts keeping the day once the object's schema has the table (base.ts, after its migrations).
   * What the start-up read before this counts toward the day too. */
  attach(db: Db, cls: string, now = Date.now()): void {
    this.db = db;
    this.cls = cls;
    this.storedAt = now;
    this.open(now);
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

  /** Core's tick asks (the RPC `meterFlush`): writes the day's row if it grew and a minute has passed
   * (`force`, Core's own row at its tick: whenever it grew), and answers today's totals and the day
   * before's, so the minutes before midnight reach Core too. */
  report(now = Date.now(), force = false): MeterDay[] {
    if (!this.db) return [];
    const db = this.db;
    this.turn(now);
    if (this.dirty && (force || Math.abs(now - this.storedAt) >= FLUSH_MS)) this.flush(now);
    if (this.before === undefined) {
      const row = this.mine(() => store.dayOf(db, dayBefore(this.day), this.cls));
      this.before = row ? { day: row.day, rows_read: row.rows_read, rows_written: row.rows_written } : null;
    }
    return [this.today(now), ...(this.before ? [this.before] : [])];
  }

  /** A new UTC day (or the clock moved back past the day's start): the day that closed is written,
   * whatever the minute rule says, and the new one begins from what is stored for it. */
  private turn(now: number): void {
    if (now >= this.from && now < this.to) return;
    if (this.dirty) this.flush(now);
    const closed = now >= this.to ? { day: this.day, rows_read: this.read, rows_written: this.written } : undefined;
    this.open(now);
    this.before = closed;
  }

  private open(now: number): void {
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
    this.mine(() => store.pruneDays(db, now, 50));
  }

  private flush(now: number): void {
    const db = this.db as Db;
    this.storedAt = now;
    this.dirty = false;
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
