// The predictions' half of the Core object (P9, areas/predictions): the night shift's predictions,
// their resolution in each tick once their day is over, and the skill per category. A code layer
// of the one Core class.
import type { CategorySkill, Prediction, PutPredictionRequest } from '../../../shared/contract/predictions.ts';
import * as predictions from '../areas/predictions/ops';
import type { Out } from '../lib/result';
import type { Caller } from './caller';
import { CoreWork } from './core-work';

export abstract class CorePredictions extends CoreWork {
  putPrediction(c: Caller, id: string, r: PutPredictionRequest, hash: string): Out<Prediction> {
    if (this.sandboxed) return { ok: false, code: 'forbidden' };
    return this.run((w) => predictions.put(w, c, id, r, hash, this.tz()));
  }

  predictions(open: boolean, limit: number): Prediction[] {
    return predictions.list(this.db, open, limit);
  }

  predictionSkill(): CategorySkill[] {
    return predictions.skill(this.db);
  }

  /** The tick's pass: the predictions whose day is over. */
  protected predictionsTick(now: number, tz: string, open: string): void {
    if (this.sandboxed || !predictions.anyDue(this.db, open)) return;
    this.write((w) => predictions.resolve(w, open, tz), now);
  }
}
