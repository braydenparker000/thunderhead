// The night shift's half of the Core object (P3, areas/mind/night*.ts): the run record that
// `th night` moves through and the closed day's input that `th day` reads. Like the rest of Core,
// each RPC is a thin call into the area; the run's writes go through `run` (commit.ts). `Core`
// (core.ts) adds the day roll that fires the night shift.
import type { MindNightRequest, MindNightResponse } from '../../../shared/contract/api';
import type { NightDayPart } from '../../../shared/contract/night.ts';
import { currentDay } from '../areas/conversation/day';
import { fireConfig } from '../areas/mind/fire';
import { night } from '../areas/mind/night';
import { type DayPart, dayPart } from '../areas/mind/night-input';
import { attempt, type Out } from '../lib/result';
import type { Caller } from './caller';
import { CoreMemory } from './core-memory';

export abstract class CoreNight extends CoreMemory {
  night(c: Caller, r: MindNightRequest): Out<MindNightResponse> {
    return this.run((w) => night(w, c, r, currentDay(w.db, this.tz(), w.at)));
  }

  nightDay(q: { day: string; part: NightDayPart; after: (number | string)[] | null; limit: number }): Out<DayPart> {
    const now = Date.now();
    const tz = this.tz();
    return attempt(() => dayPart(this.db, q, tz, now, currentDay(this.db, tz, now)));
  }

  /** The mind-night task is connected (ROUTINE_NIGHT_URL and _TOKEN set, SETUP.md L1). */
  protected nightConfigured(): boolean {
    return !this.sandboxed && fireConfig(this.env, 'night') !== null;
  }
}
