// The row meter and the Free plan's daily quotas (DATA.md §3, §8.1; OPERATIONS.md §8): what the
// Worker keeps per UTC day, the levels that act on it, and what GET /v1/ops/meter answers.
import type { Ms } from './api.ts';

/** The Free plan's Durable Object rows per account and UTC day. Past either, every object request
 * on the account fails until 00:00 UTC. */
export const FREE_PLAN_DAY = { rows_read: 5_000_000, rows_written: 100_000 } as const;

/** What the old Worker (`jarvis-hub-api`, its Hub object, not in this repository) uses of the same
 * account's limits each day, which this Worker's meter cannot see: about 180,000 rows read and
 * 32,000 written (Cloudflare's analytics, 2026-10-25 to 2026-10-31). Kept back from our budget;
 * both drop to 0 once the old Worker retires (SETUP.md N5, M4). */
export const OLD_WORKER_RESERVE = { rows_read: 200_000, rows_written: 32_000 } as const;

/** What is left for this Worker's five objects each day: 4,800,000 rows read, 68,000 written. The
 * quota levels are percentages of this budget. */
export const DAY_BUDGET = {
  rows_read: FREE_PLAN_DAY.rows_read - OLD_WORKER_RESERVE.rows_read,
  rows_written: FREE_PLAN_DAY.rows_written - OLD_WORKER_RESERVE.rows_written,
} as const;

/** Percent of either side of the day's budget. `note`: the quota watchdogs trip and the Briefing and
 * the mind's briefing say so. `hold`: one push to the owner, and the heavy work (the backup and
 * drill, the bulk lane, the senses archive, the upload tools) waits for 00:00 UTC. */
export const QUOTA_LEVELS = { note: 60, hold: 80 } as const;

/** Rows at a level of the day's budget (`quota.rows_read` trips at 2,880,000, say). */
export const budgetAt = (pct: number, key: keyof typeof DAY_BUDGET) => Math.floor((DAY_BUDGET[key] * pct) / 100);

/** One object class's rows on one UTC day. */
export interface MeterItem {
  day: string;
  class: string;
  rows_written: number;
  rows_read: number;
  bulk_rows_written: number;
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
