// GET /v1/ops/diag's Core part (shared/contract/diag.ts): the jobs table without payloads, today's
// bulk lane, today's quota with the budget and the hold level in rows, and each class's rows today.
// Counts, states, times and codes only. Also the upload tools' `quota` (areas/music/upload-reads.ts):
// the same day in numbers. A code layer of the one Core class.
import type { DiagResponse } from '../../../shared/contract/diag.ts';
import { budgetAt, DAY_BUDGET, QUOTA_LEVELS } from '../../../shared/contract/meter.ts';
import { laneToday } from '../areas/jobs/lane';
import { diagJobs } from '../areas/jobs/store';
import { quota } from '../areas/meter/quota';
import type { DayRow } from '../areas/meter/store';
import { CoreIssues } from './core-issues';

/** Jobs shown at most: finished ones go 30 days after, so the table stays small. */
const JOBS_MAX = 200;

/** POST /v1/music/uploads/quota's answer: today's rows (UTC) against the budget and the hold level,
 * whether the heavy work is held and until when (ms, and seconds from now), and the bulk lane. */
export interface MuseQuota {
  day: string;
  rows_written: number;
  budget_rows_written: number;
  hold_at_rows_written: number;
  rows_read: number;
  budget_rows_read: number;
  hold_at_rows_read: number;
  held: boolean;
  hold_until: number | null;
  retry_after: number | null;
  lane: { rows: number; cap: number; open: boolean; resume_at: number };
}

export abstract class CoreDiag extends CoreIssues {
  /** The other objects' days are asked as GET /v1/ops/meter asks them (at most once a minute). */
  async diag(now = Date.now()): Promise<Pick<DiagResponse, 'jobs' | 'lane' | 'quota' | 'meter'>> {
    const m = await this.meterDays(1, now);
    const hold_at = {
      rows_read: budgetAt(QUOTA_LEVELS.hold, 'rows_read'),
      rows_written: budgetAt(QUOTA_LEVELS.hold, 'rows_written'),
    };
    return {
      jobs: diagJobs(this.db, JOBS_MAX),
      lane: laneToday(this.db, now),
      quota: { ...m.today, budget: { ...DAY_BUDGET }, hold_at },
      meter: m.items,
    };
  }

  /** The upload tools' `quota`, with Music's live day brought along as the hold's check brings it
   * (areas/meter/hold.ts): `held` is the answer that check gets (each isolate keeps it a minute). */
  museQuota(now = Date.now(), live: DayRow[] = []): MuseQuota {
    const q = quota(this.db, now, live);
    const until = q.hold_until !== null && now < q.hold_until ? q.hold_until : null;
    const { rows, cap, open, resume_at } = laneToday(this.db, now);
    return {
      day: q.day,
      rows_written: q.rows_written,
      budget_rows_written: DAY_BUDGET.rows_written,
      hold_at_rows_written: budgetAt(QUOTA_LEVELS.hold, 'rows_written'),
      rows_read: q.rows_read,
      budget_rows_read: DAY_BUDGET.rows_read,
      hold_at_rows_read: budgetAt(QUOTA_LEVELS.hold, 'rows_read'),
      held: until !== null,
      hold_until: until,
      retry_after: until === null ? null : Math.ceil((until - now) / 1000),
      lane: { rows, cap, open, resume_at },
    };
  }
}
