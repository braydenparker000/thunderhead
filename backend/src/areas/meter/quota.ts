// Today's database use against the day's budget (DATA.md §8.1): the Free plan's daily limits less
// the old Worker's share, which the meter cannot see (OLD_WORKER_RESERVE). What the quota watchdogs
// check, what the Briefing page and the mind's briefing say from 60%, the owner's one push from
// 80%, and the hold that makes the heavy work wait for 00:00 UTC from 80%. Read from Core's
// meter_days, a row per class, each raised to what is known live: Core's own meter as it stands
// (`db.meter`, written or not), and any class a caller has fresher numbers for (the upload tools'
// check brings Music's). Counted: the five objects, and what the drill wrote into its scratch copy
// (class `scratch`); not the drill copy's reads, nor the eval sandbox.
import type { MeterResponse } from '../../../../shared/contract/api';
import { DAY_BUDGET, QUOTA_LEVELS, type QuotaToday } from '../../../../shared/contract/meter.ts';
import { DAY, dayBefore, utcDay, wallMinute } from '../../lib/time';
import type { Db } from '../../objects/base';
import { type DayRow, dayRows, daysFrom } from './store';

const pct = (n: number, of: number) => Math.floor((n * 100) / of);

/** 00:00 UTC after `now`: when the day's quota starts again. */
export const nextUtcDay = (now: number) => Date.parse(`${utcDay(now)}T00:00:00Z`) + DAY;

/** The day's stored rows, each class raised to its live numbers where they are higher. */
function merged(db: Db, now: number, live: DayRow[]): DayRow[] {
  const day = utcDay(now);
  const byClass = new Map(dayRows(db, day).map((r) => [r.class, r]));
  for (const l of [db.meter.live(now), ...live])
    if (l && l.day === day) {
      const r = byClass.get(l.class);
      byClass.set(l.class, {
        day,
        class: l.class,
        rows_read: Math.max(r?.rows_read ?? 0, l.rows_read),
        rows_written: Math.max(r?.rows_written ?? 0, l.rows_written),
      });
    }
  return [...byClass.values()];
}

export function quota(db: Db, now: number, live: DayRow[] = []): QuotaToday {
  return summed(merged(db, now, live), now);
}

function summed(rows: DayRow[], now: number): QuotaToday {
  const rows_read = rows.reduce((n, r) => n + r.rows_read, 0);
  const rows_written = rows.reduce((n, r) => n + r.rows_written, 0);
  const read_pct = pct(rows_read, DAY_BUDGET.rows_read);
  const written_pct = pct(rows_written, DAY_BUDGET.rows_written);
  const top = Math.max(read_pct, written_pct);
  return {
    day: utcDay(now),
    rows_read,
    rows_written,
    read_pct,
    written_pct,
    pct: top,
    hold_until: top >= QUOTA_LEVELS.hold ? nextUtcDay(now) : null,
  };
}

/** `quota`, or null when it can't be read: the guard never breaks a request, a tick or an alarm. */
export function safeQuota(db: Db, now: number, live: DayRow[] = []): QuotaToday | null {
  try {
    return quota(db, now, live);
  } catch {
    return null;
  }
}

/** When the heavy work may run again (00:00 UTC), while today is past the hold level; else null
 * (also when the meter can't be read: nothing is held then). */
export const quotaHold = (db: Db, now: number, live: DayRow[] = []): number | null =>
  safeQuota(db, now, live)?.hold_until ?? null;

const clock = (at: number, tz: string) => {
  const m = wallMinute(at, tz);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** The owner's line (the Briefing page, the push), from 60% of the day's budget, which it calls the
 * free plan's daily limit (the old Worker's share is the owner's to know, not every line's); the
 * time is the owner's own clock. */
export function quotaLine(q: QuotaToday | null, tz: string): string | null {
  if (!q || q.pct < QUOTA_LEVELS.note) return null;
  const line = `Today's database use is at ${q.pct}% of the free plan's daily limit.`;
  return q.hold_until ? `${line} Backups and uploads wait until ${clock(q.hold_until, tz)}.` : line;
}

const n = (x: number) => x.toLocaleString('en-US');

/** The mind's briefing line (section 1), from 60%. */
export function quotaBriefLine(q: QuotaToday | null): string | null {
  if (!q || q.pct < QUOTA_LEVELS.note) return null;
  const hold = q.hold_until ? ' · heavy jobs wait for 00:00 UTC' : '';
  return `quota: ${q.pct}% of today's budget (read ${n(q.rows_read)} of ${n(DAY_BUDGET.rows_read)}; written ${n(q.rows_written)} of ${n(DAY_BUDGET.rows_written)}; the old Worker's share kept back)${hold}`;
}

/** GET /v1/ops/meter: each class's stored rows for the last `days` UTC days (today's raised to Core's
 * live numbers, as `today` is), and today's use. */
export function meterResponse(db: Db, days: number, now: number): MeterResponse {
  const today = merged(db, now, []);
  const items = [...today, ...daysFrom(db, dayBefore(utcDay(now), days - 1)).filter((r) => r.day !== utcDay(now))].map(
    (r) => ({ ...r, bulk_rows_written: 0 }),
  );
  return { items, today: summed(today, now) };
}
