// The watchdogs' half of the Core object (P4 stage D, areas/watchdogs): each 15-minute tick runs
// the built checks and, when a trip wakes mind-reflex, fires its task after the commit; the
// reflex reads every watchdog's state and reports what it did. The sandbox runs none of it. A code
// layer of the one Core class.
import type {
  WatchdogDrillResponse,
  WatchdogHandledRequest,
  WatchdogItem,
  WatchdogName,
} from '../../../shared/contract/watchdogs.ts';
import { fire, fireConfig } from '../areas/mind/fire';
import * as mstore from '../areas/mind/store';
import { GATHER, type Gather } from '../areas/watchdogs/checks';
import * as watchdogs from '../areas/watchdogs/ops';
import type { Out } from '../lib/result';
import type { Caller } from './caller';
import { CoreEvals } from './core-evals';

export abstract class CoreWatchdogs extends CoreEvals {
  /** The tick's watchdog pass; returns the reflex wake it fired, if any. */
  protected async watchdogTick(now: number, fetchImpl: typeof fetch): Promise<string | null> {
    if (this.sandboxed) return null;
    const cfg = fireConfig(this.env, 'reflex');
    const gathered: Partial<Record<WatchdogName, unknown>> = {};
    for (const [name, gather] of Object.entries(GATHER) as [WatchdogName, Gather][])
      if (watchdogs.built(name))
        try {
          gathered[name] = await gather(this.env, this.db);
        } catch {
          // Absent: the check decides what no answer means.
        }
    const ctx = { tz: this.tz(), dbBytes: this.db.size, nightConfigured: this.nightConfigured(), gathered };
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

  /** A drill: trips the watchdog by hand and fires the reflex after the commit, when connected. */
  async watchdogDrill(
    c: Caller,
    name: WatchdogName,
    fetchImpl: typeof fetch = fetch,
  ): Promise<Out<WatchdogDrillResponse>> {
    const cfg = fireConfig(this.env, 'reflex');
    const out = this.run((w) => watchdogs.drill(w, c, name, cfg !== null));
    if (!out.ok) return out;
    const { item, wake } = out.value;
    if (!wake || !cfg) return { ok: true, value: { item, wake_id: null, fired: cfg ? 'limited' : 'not_connected' } };
    const r = await fire(cfg, fetchImpl);
    this.write((w) => mstore.recordFire(w.db, wake.id, r.status, r.session_id, r.error));
    return { ok: true, value: { item, wake_id: wake.id, fired: r.status === 200 ? 'fired' : 'failed' } };
  }
}
