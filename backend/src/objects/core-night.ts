// The night shift's half of the Core object (P3, areas/mind/night*.ts): the run record that
// `th night` moves through and the closed day's input that `th day` reads. Like the rest of Core,
// each RPC is a thin call into the area; the run's writes go through `run` (commit.ts), and so does
// the night's report (step 12, areas/briefing/report.ts). `Core`
// (core.ts) adds the day roll that fires the night shift.
import type { MindNightRequest, MindNightResponse } from '../../../shared/contract/api';
import type { GrowthResponse } from '../../../shared/contract/growth.ts';
import type { NightDayPart } from '../../../shared/contract/night.ts';
import type { NightReport, PutNightReportRequest } from '../../../shared/contract/night-report.ts';
import { putReport, recount } from '../areas/briefing/report';
import { currentDay } from '../areas/conversation/day';
import { fireConfig } from '../areas/mind/fire';
import { type GrowthInput, growth } from '../areas/mind/growth';
import { night } from '../areas/mind/night';
import { type DayPart, dayPart } from '../areas/mind/night-input';
import { attempt, type Out } from '../lib/result';
import type { Caller } from './caller';
import { CoreMemory } from './core-memory';

export abstract class CoreNight extends CoreMemory {
  night(c: Caller, r: MindNightRequest): Out<MindNightResponse> {
    const out = this.run((w) => night(w, c, r, currentDay(w.db, this.tz(), w.at)));
    // The watches met while it ran waited for its end (RUNTIME.md §3); the recall index catches up
    // on the day and the night's notes.
    if (out.ok && out.value.done) {
      // What the steps after the report did, and what the hard stop cut, join its counts.
      this.write((w) => recount(w, r.day));
      this.watchesAfterNight();
      this.queueRecall();
    }
    return out;
  }

  /** PUT /v1/briefing/report/:day (night step 12, areas/briefing/report.ts). */
  reportPut(c: Caller, day: string, r: PutNightReportRequest, hash: string): Out<NightReport> {
    const tz = this.tz();
    return this.run((w) => putReport(w, c, day, r, hash, { today: currentDay(w.db, tz, w.at), tz }));
  }

  /** PUT /v1/mind/growth/:day (night step 13, areas/mind/growth.ts): each tile and plan its own commit. */
  growth(c: Caller, day: string, x: GrowthInput): Out<GrowthResponse> {
    const tz = this.tz();
    return growth((fn) => this.run(fn), c, day, x, { today: (w) => currentDay(w.db, tz, w.at), tz });
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
