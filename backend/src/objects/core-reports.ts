// The reports' half of the Core object (areas/reports): the batches the phone sends about how the
// apps run (NEXT-BATCH.md part 1), one row each, kept 30 days by the daily prune. A code layer of
// the one Core class. A device sends at most 6 batches in any 5 minutes, counted here in memory
// (the count costs no row and starts over when the object does), so a phone stuck in a loop can't
// spend the free plan's daily writes.
import type { Report, ReportCreated, ReportKind, ReportRequest } from '../../../shared/contract/reports.ts';
import * as reports from '../areas/reports/ops';
import type { Out } from '../lib/result';
import type { Caller } from './caller';
import { CoreThreads } from './core-threads';

export abstract class CoreReports extends CoreThreads {
  /** Each device's recent batch times. */
  private readonly sent = new Map<string, number[]>();

  putReport(c: Caller, r: ReportRequest): Out<ReportCreated> {
    if (c.who !== 'D' || !c.device_id) return { ok: false, code: 'forbidden' };
    if (!reports.admit(this.sent, c.device_id, Date.now())) return { ok: false, code: 'rate_limited' };
    const device = c.device_id;
    return this.run((w) => reports.put(w, device, r));
  }

  reports(kind: ReportKind | null, since: number, limit: number, after: [number, string] | null): Report[] {
    return reports.list(this.db, kind, since, limit, after);
  }
}
