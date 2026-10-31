// The reports' half of the Core object (areas/reports): the batches the phone sends about how the
// apps run (NEXT-BATCH.md part 1), one row each, kept 30 days by the daily prune. A code layer of
// the one Core class. A device sends at most 6 batches in any 5 minutes, counted here in memory
// (the count costs no row and starts over when the object does), so a phone stuck in a loop can't
// spend the free plan's daily writes; one more is refused with the seconds until it would fit.
import type { ReportCreated, ReportKind, ReportRequest } from '../../../shared/contract/reports.ts';
import * as reports from '../areas/reports/ops';
import type { ReportRow } from '../areas/reports/store';
import type { Out } from '../lib/result';
import type { Caller } from './caller';
import { CoreThreads } from './core-threads';

export abstract class CoreReports extends CoreThreads {
  /** Each device's recent batch times. */
  private readonly sent = new Map<string, number[]>();

  putReport(
    c: Caller,
    r: ReportRequest,
  ): Out<ReportCreated> | { ok: false; code: 'rate_limited'; retry_after: number } {
    if (c.who !== 'D' || !c.device_id) return { ok: false, code: 'forbidden' };
    const wait = reports.admit(this.sent, c.device_id, Date.now());
    if (wait) return { ok: false, code: 'rate_limited', retry_after: wait };
    const device = c.device_id;
    return this.run((w) => reports.put(w, device, r));
  }

  reports(
    kind: ReportKind | null,
    since: number,
    limit: number,
    after: [number, string] | null,
  ): { rows: ReportRow[]; more: boolean } {
    return reports.list(this.db, kind, since, limit, after);
  }
}
