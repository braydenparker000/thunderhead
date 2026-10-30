// The meter (P9; EVALS.md §9 and M-8, M-16): pure counts from the rows Core and the Senses object give.
// An arrangement (a surface the mind placed) is undone when the owner took it back within 48 hours, kept
// when they acted on it on its day or the next (tapped it, or opened the app it names, `ref: app:<id>`),
// else ignored; one placed in the last 48 hours waits. Never a score to push the owner with (law 16).
import { type InsightResponse, PREDICTION_APPS } from '../../../../shared/contract/predictions.ts';
import { DAY, dayBefore, HOUR } from '../../lib/time';
import { logicalDay } from '../conversation/day';

export const WEEKS = 4;
export const DECIDED_AFTER = 48 * HOUR;
/** The sense types the meter reads: a tile's tap and each app's opening. */
export const METER_SENSES = ['briefing.tile', ...Object.values(PREDICTION_APPS)];

export interface Arrangement {
  id: string;
  at: number;
  ref: string | null;
  undone_at: number | null;
}
export interface Rollup {
  day: string;
  type: string;
  ref: string;
  n: number;
}

/** M-8 by week, oldest first. */
export function corrections(fixed: number[], learned: number[], now: number): InsightResponse['corrections'] {
  const week = (at: number) => WEEKS - 1 - Math.floor((now - at) / (7 * DAY));
  const out = Array.from({ length: WEEKS }, () => ({ fixed: 0, learned: 0 }));
  for (const at of fixed) if (week(at) >= 0) out[week(at)].fixed++;
  for (const at of learned) if (week(at) >= 0) out[week(at)].learned++;
  return out;
}

/** M-16. */
export function arrangements(
  rows: Arrangement[],
  senses: Rollup[],
  now: number,
  tz: string,
): InsightResponse['arrangements'] {
  const seen = new Set(senses.filter((r) => r.n > 0).map((r) => `${r.day}|${r.type}|${r.ref}`));
  const out = { kept: 0, undone: 0, ignored: 0, waiting: 0 };
  for (const a of rows) {
    if (a.undone_at !== null && a.undone_at - a.at <= DECIDED_AFTER) out.undone++;
    else if (now - a.at < DECIDED_AFTER) out.waiting++;
    else {
      const day = logicalDay(a.at, tz);
      const app = a.ref?.startsWith('app:') ? PREDICTION_APPS[a.ref.slice(4) as keyof typeof PREDICTION_APPS] : null;
      const acted = [day, dayBefore(day, -1)].some(
        (d) => seen.has(`${d}|briefing.tile|ledger:${a.id}`) || (app && seen.has(`${d}|${app}|`)),
      );
      if (acted) out.kept++;
      else out.ignored++;
    }
  }
  return out;
}
