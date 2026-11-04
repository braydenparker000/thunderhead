// What lands and the speech setting's half of the Core object (areas/insight/topics.ts,
// areas/mind/speech.ts, BEHAVIOR.md §3.6–3.7): the pass over the last 30 days of arrangements with
// the Senses object's rollups, which keeps each topic's counts and sends one passed over three times
// in a row to rest (run on the day roll, before the night's wake, and when What lands is read); the
// owner reopening a topic, and the mind saying once that it went quiet; the speech check for a push,
// which the Auth object queues; the odds against what happened (GET /v1/predictions/calibration). A
// code layer of the one Core class.
import type { SpeechWrite } from '../../../shared/contract/lands.ts';
import type { CalibrationResponse } from '../../../shared/contract/predictions.ts';
import { logicalDay } from '../areas/conversation/day';
import { METER_SENSES, type Rollup } from '../areas/insight/meter';
import * as topics from '../areas/insight/topics';
import { asked, speechGate } from '../areas/mind/speech';
import { calibration } from '../areas/predictions/ops';
import { attempt, type Out } from '../lib/result';
import { DAY } from '../lib/time';
import type { Caller } from './caller';
import { CorePredictions } from './core-predictions';
import { sensesObject } from './senses';

export abstract class CoreLands extends CorePredictions {
  /** The rollups the meter reads for the window (a day before its oldest arrangement, through today);
   * none when the Senses object can't answer (nothing then counts as kept or seen). */
  private async landsSenses(now: number): Promise<Rollup[]> {
    const tz = this.tz();
    return sensesObject(this.env)
      .rollupsFor(METER_SENSES, logicalDay(now - 31 * DAY, tz), logicalDay(now, tz))
      .catch(() => []);
  }

  /** GET /v1/insight/topics: the pass, now, and what it found. */
  async landsTopics(now = Date.now()) {
    const senses = this.sandboxed ? [] : await this.landsSenses(now);
    return this.write((w) => topics.pass(w, senses, this.tz()), now);
  }

  /** The day roll's pass (core.ts tick), before the night wakes. The sandbox has no senses. */
  protected async landsTick(now: number): Promise<void> {
    if (this.sandboxed) return;
    const senses = await this.landsSenses(now);
    this.write((w) => topics.pass(w, senses, this.tz()), now);
  }

  reopenTopic(c: Caller, key: string, byMessage: string | undefined) {
    return this.run((w) => topics.reopen(w, c, key, byMessage, this.tz()));
  }

  saidTopic(key: string) {
    return this.run((w) => topics.said(w, key));
  }

  /** Before the Auth object queues the mind's push: the speech setting's check (a read only). */
  speechCheck(c: Caller, write: SpeechWrite, askedBy: string | undefined): Out<null> {
    return attempt(() => {
      const now = Date.now();
      speechGate(this.db, c, write, asked(this.db, c, askedBy, now), now, this.tz());
      return null;
    });
  }

  calibration(now = Date.now()): CalibrationResponse {
    return calibration(this.db, now);
  }
}
