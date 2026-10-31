// The watchdogs' half of the Core object (P4 stage D, areas/watchdogs): each 15-minute tick gathers
// the row meter (areas/meter: every object's day, kept in meter_days), runs the built checks and,
// when a trip wakes mind-reflex, fires its task after the commit; the reflex reads every
// watchdog's state and reports what it did. Today's use against the Free plan also gives the
// owner's one push from 80% and the hold the heavy work waits on. The sandbox runs none of it. A
// code layer of the one Core class.
import type { MeterResponse } from '../../../shared/contract/api';
import type {
  WatchdogDrillResponse,
  WatchdogHandledRequest,
  WatchdogItem,
  WatchdogName,
} from '../../../shared/contract/watchdogs.ts';
import { gather } from '../areas/meter/gather';
import { meterResponse, quota, quotaHold, quotaLine } from '../areas/meter/quota';
import { putDay } from '../areas/meter/store';
import { fire, fireConfig } from '../areas/mind/fire';
import * as mstore from '../areas/mind/store';
import type { PushContext } from '../areas/push/rules';
import { GATHER, type Gather } from '../areas/watchdogs/checks';
import * as watchdogs from '../areas/watchdogs/ops';
import type { Out } from '../lib/result';
import type { Caller } from './caller';
import { CoreEvals } from './core-evals';

export abstract class CoreWatchdogs extends CoreEvals {
  /** The tick's watchdog pass, the meter's first; returns the reflex wake it fired, if any. */
  protected async watchdogTick(now: number, fetchImpl: typeof fetch): Promise<string | null> {
    if (this.sandboxed) return null;
    // A meter that fails this tick leaves the last rows standing; the checks and the tick go on.
    await this.meterTick(now).catch(() => undefined);
    const cfg = fireConfig(this.env, 'reflex');
    const gathered: Partial<Record<WatchdogName, unknown>> = {};
    for (const [name, gather] of Object.entries(GATHER) as [WatchdogName, Gather][])
      if (watchdogs.built(name))
        try {
          gathered[name] = await gather(this.env, this.db);
        } catch {
          // Absent: the check decides what no answer means.
        }
    const ctx = {
      tz: this.tz(),
      dbBytes: this.db.size,
      nightConfigured: this.nightConfigured(),
      gathered,
      quota: quota(this.db, now),
    };
    const f = this.write((w) => watchdogs.watch(w, ctx, cfg !== null), now);
    if (f && cfg) {
      const r = await fire(cfg, fetchImpl);
      this.write((w) => mstore.recordFire(w.db, f.id, r.status, r.session_id, r.error));
    }
    return f?.id ?? null;
  }

  /** The meter's pass (DATA.md §3): the other objects' days, and Core's own row written whole, kept
   * in meter_days where they grew (five rows written a tick at most, none for a class that didn't). */
  private async meterTick(now: number): Promise<void> {
    const rows = await gather(this.env);
    this.meter.report(Date.now(), true);
    if (rows.length)
      this.ctx.storage.transactionSync(() => {
        for (const r of rows) putDay(this.db, r, now);
      });
  }

  /** GET /v1/ops/meter: the meter gathered now, then each class's days and today's use. */
  async meterDays(days: number, now = Date.now()): Promise<MeterResponse> {
    if (!this.sandboxed) await this.meterTick(now);
    return meterResponse(this.db, days, now);
  }

  /** While today is past 80% of the day's budget, when the heavy work may run again (00:00 UTC). */
  quotaHold(now = Date.now()): number | null {
    return quotaHold(this.db, now);
  }

  /** From 80%, the day's one quota push rides along with every delivery run: Auth's outbox keeps it
   * once by its id, and it waits only for quiet hours, as a sign-in notice does. */
  override pushContext(): PushContext {
    const ctx = super.pushContext();
    if (this.sandboxed) return ctx;
    const q = quota(this.db, ctx.now);
    const body = quotaLine(q, ctx.tz);
    return q.hold_until && body
      ? { ...ctx, quota: { id: `quota-${q.day}`, at: ctx.now, until: q.hold_until, body } }
      : ctx;
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
