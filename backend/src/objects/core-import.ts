// The import's half of the Core object (P3 stage D, areas/import): starting a run of one dataset
// and reading where it stands. The work itself is a chunked job (areas/jobs), which Core's alarm
// runs a step at a time. A code layer of the one Core class, like core-memory.ts and
// core-night.ts: no Durable Object class of its own.
import type { ImportStatus } from '../../../shared/contract/api';
import { type StartImport, start } from '../areas/import/ops';
import * as store from '../areas/import/store';
import { LANE_ROWS_PER_DAY, laneRows, nextLaneDay, useLane } from '../areas/jobs/runner';
import type { Out } from '../lib/result';
import type { Caller } from './caller';
import { CoreNight } from './core-night';

export abstract class CoreImport extends CoreNight {
  importStart(c: Caller, r: StartImport): Out<{ import_id: string }> {
    const out = this.run((w) => start(w, c, r));
    this.schedule();
    return out;
  }

  importStatus(id: string): ImportStatus | null {
    const r = store.importRow(this.db, id);
    return r ? store.toStatus(r) : null;
  }

  /** The bulk lane for a writer in another object (DATA.md §8.3): whether rows may be written today,
   * and when the lane opens again if not. */
  bulkLane(now = Date.now()): { open: boolean; resume_at: number } {
    return { open: laneRows(this.db, now) < LANE_ROWS_PER_DAY, resume_at: nextLaneDay(now) };
  }

  /** Counts rows another object wrote under the bulk lane. */
  useBulkLane(rows: number, now = Date.now()): void {
    if (rows > 0) this.write((w) => useLane(w, rows, now), now);
  }
}
