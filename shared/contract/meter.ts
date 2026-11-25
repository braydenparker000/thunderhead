// The row meter and the Free plan's daily quotas (DATA.md §3, §8.1; OPERATIONS.md §8): what the
// Worker keeps per UTC day, the levels that act on it, and what GET /v1/ops/meter answers.
import type { Ms } from './api.ts';

/** The Free plan's Durable Object rows per account and UTC day. Past either, every object request
 * on the account fails until 00:00 UTC. */
export const FREE_PLAN_DAY = { rows_read: 5_000_000, rows_written: 100_000 } as const;

/** The day's budget for this Worker's five objects: the whole Free plan, 5,000,000 rows read and
 * 100,000 written. The quota levels are percentages of it. Until 2026-11-25 the old Worker's share
 * (300,000 read, 10,000 written) was kept back from it; the owner deleted the old Worker that day. */
export const DAY_BUDGET = FREE_PLAN_DAY;

/** Percent of either side of the day's budget. `note`: the quota watchdogs trip and the Briefing and
 * the mind's briefing say so. `hold`: one push to the owner, and the heavy work (the backup and
 * drill, the bulk lane, the senses archive, the upload tools) waits for 00:00 UTC. The hold was 80
 * until 2026-11-25 (the owner's word: 85, so the upload tools have more of the day). */
export const QUOTA_LEVELS = { note: 60, hold: 85 } as const;

/** Rows at a level of the day's budget (`quota.rows_read` trips at 3,000,000, say). */
export const budgetAt = (pct: number, key: keyof typeof DAY_BUDGET) => Math.floor((DAY_BUDGET[key] * pct) / 100);

/** One object class's rows on one UTC day. */
export interface MeterItem {
  day: string;
  class: string;
  rows_written: number;
  rows_read: number;
  /** Today's `core` row: the bulk lane's rows today (counted in Core, whichever object they went to).
   * Other classes, and past days (the lane keeps only today's count), are 0. */
  bulk_rows_written: number;
}

/** Today's bulk lane (DATA.md §8.3), in deep health's `meter_today` (`bulk_rows_written` is its rows,
 * every object's): the UTC day, rows written under it, and the day's cap. Null from a Core before it. */
export interface BulkLane {
  day: string;
  rows: number;
  cap: number;
}

/** Today's use across the five objects (UTC day) against the day's budget, as the watchdogs, the
 * Briefing and `th health` see it. */
export interface QuotaToday {
  day: string;
  rows_read: number;
  rows_written: number;
  /** Percent of each side of the day's budget (DAY_BUDGET), rounded down; `pct` is the higher. */
  read_pct: number;
  written_pct: number;
  pct: number;
  /** From the hold level on: 00:00 UTC, when the heavy work runs again; otherwise null. */
  hold_until: Ms | null;
}

/** GET /v1/ops/meter: each class's stored rows for the days asked (newest first), and today's use. */
export interface MeterResponse {
  items: MeterItem[];
  today: QuotaToday;
}
