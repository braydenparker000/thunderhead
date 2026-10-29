// The watchdogs' half of the Core object (P4 stage D, areas/watchdogs): each 15-minute tick runs
// the built checks and, when a trip wakes mind-reflex, fires its task after the commit; the
// reflex reads every watchdog's state and reports what it did. The sandbox runs none of it. A code
// layer of the one Core class.
import type { WatchdogHandledRequest, WatchdogItem, WatchdogName } from '../../../shared/contract/watchdogs.ts';
import { fire, fireConfig } from '../areas/mind/fire';
import * as mstore from '../areas/mind/store';
import * as watchdogs from '../areas/watchdogs/ops';
import type { Out } from '../lib/result';
import type { Caller } from './caller';
import { CoreEvals } from './core-evals';

export abstract class CoreWatchdogs extends CoreEvals {
  /** The tick's watchdog pass; returns the reflex wake it fired, if any. */
  protected async watchdogTick(now: number, fetchImpl: typeof fetch): Promise<string | null> {
    if (this.sandboxed) return null;
    const cfg = fireConfig(this.env, 'reflex');
    const ctx = { tz: this.tz(), dbBytes: this.db.size, nightConfigured: this.nightConfigured() };
    const f = this.write((w) => watchdogs.watch(w, ctx, cfg !== null), now);
    if (f && cfg) {
      const r = await fire(cfg, fetchImpl);
      this.write((w) => mstore.recordFire(w.db, f.id, r.status, r.session_id, r.error));
    }
    return f?.id ?? null;
  }

  watchdogs(): WatchdogItem[] {
    return watchdogs.list(this.db);
  }

  watchdogHandled(c: Caller, name: WatchdogName, r: WatchdogHandledRequest): Out<WatchdogItem> {
    return this.run((w) => watchdogs.handled(w, c, name, r));
  }
}
