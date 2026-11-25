// GET /v1/ops/diag's Core part (shared/contract/diag.ts): the jobs table without payloads, today's
// bulk lane, today's quota with the budget and the hold level in rows, and each class's rows today.
// Counts, states, times and codes only. A code layer of the one Core class.
import type { DiagResponse } from '../../../shared/contract/diag.ts';
import { budgetAt, DAY_BUDGET, QUOTA_LEVELS } from '../../../shared/contract/meter.ts';
import { laneToday } from '../areas/jobs/lane';
import { diagJobs } from '../areas/jobs/store';
import { CoreIssues } from './core-issues';

/** Jobs shown at most: finished ones go 30 days after, so the table stays small. */
const JOBS_MAX = 200;

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
}
