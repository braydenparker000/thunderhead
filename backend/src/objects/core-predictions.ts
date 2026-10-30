// The predictions' half of the Core object (P9, areas/predictions): the night shift's predictions,
// their resolution in each tick once their day is over, and the skill per category. A code layer
// of the one Core class.
import {
  type CategorySkill,
  PREDICTION_APPS,
  type Prediction,
  type PutPredictionRequest,
} from '../../../shared/contract/predictions.ts';
import { currentDay } from '../areas/conversation/day';
import { runs } from '../areas/evals/store';
import { meterRows } from '../areas/ledger/store';
import { mindFactsSince } from '../areas/memory/store';
import * as predictions from '../areas/predictions/ops';
import type { Sensed } from '../areas/predictions/resolvers';
import type { Out } from '../lib/result';
import { DAY, dayBefore } from '../lib/time';
import type { Caller } from './caller';
import { CoreWork } from './core-work';
import { sensesObject } from './senses';

const senseOf = (app: unknown) => PREDICTION_APPS[app as keyof typeof PREDICTION_APPS] ?? null;

export abstract class CorePredictions extends CoreWork {
  async putPrediction(c: Caller, id: string, r: PutPredictionRequest, hash: string): Promise<Out<Prediction>> {
    if (this.sandboxed) return { ok: false, code: 'forbidden' };
    const tz = this.tz();
    // An app's opening today, from the Senses object, before the write.
    const type = r.category === 'app.open' ? senseOf(r.args.app) : null;
    const open = currentDay(this.db, tz, Date.now());
    const opened = type ? (await sensesObject(this.env).typeDays(type, open, open)).days.some((d) => d.n > 0) : false;
    return this.run((w) => predictions.put(w, c, id, r, hash, tz, opened));
  }

  predictions(open: boolean, limit: number): Prediction[] {
    return predictions.list(this.db, open, limit);
  }

  predictionSkill(): CategorySkill[] {
    return predictions.skill(this.db);
  }

  /** The meter's rows of the last 28 days (GET /v1/insight; EVALS.md §9). */
  meterInput(now: number) {
    const { corrections, arrangements } = meterRows(this.db, now - 28 * DAY);
    return {
      tz: this.tz(),
      corrections,
      learned: mindFactsSince(this.db, now - 28 * DAY),
      arrangements,
      memory: runs(this.db, 'MP', 4).map((r) => ({ passed: r.passed, n: r.n, at: r.at })),
      skill: predictions.skill(this.db),
    };
  }

  /** The tick's pass: the predictions whose day is over; an app's from the Senses object first (one
   * still on an older release answers on a later tick). */
  protected async predictionsTick(now: number, tz: string, open: string): Promise<void> {
    if (this.sandboxed || !predictions.anyDue(this.db, open)) return;
    const sensed = new Map<string, Sensed>();
    for (const p of predictions.dueApps(this.db, open)) {
      const type = senseOf(p.app);
      if (!type) continue;
      try {
        sensed.set(p.id, await sensesObject(this.env).typeDays(type, dayBefore(p.day, 28), p.day));
      } catch {}
    }
    this.write((w) => predictions.resolve(w, open, tz, sensed), now);
  }
}
