// The fixed resolvers (P9, EVALS.md M-18): SQL over what the owner did, never the mind's word. Each
// says whether a prediction came true on its logical day (04:00 to 04:00 local), and on how many of
// the days before it did, for the base rate, through the conversation's and the proposals' stores.
import type { PredictionCategory } from '../../../../shared/contract/predictions.ts';
import { DAY, dayBefore, zonedMinute } from '../../lib/time';
import type { Db } from '../../objects/base';
import { DAY_STARTS_HOUR, logicalDay } from '../conversation/day';
import { firstDay, ownerDays } from '../conversation/stats';
import * as proposals from '../proposals/store';

export type Args = Record<string, string | number>;
interface DayChat {
  day: string;
  n: number;
  first: number | null;
}
export interface Resolver {
  /** The arguments as stored, or the issue with them. */
  args(a: Record<string, unknown>): Args | string;
  /** Whether it came true on `day` (a closed day). */
  outcome(db: Db, day: string, a: Args, tz: string): 0 | 1;
  /** On how many of the days `from`…`to` (exclusive) it came true, of how many counted. */
  history(db: Db, from: string, to: string, a: Args, tz: string): { k: number; n: number };
}

const start = (day: string, tz: string) => zonedMinute(day, DAY_STARTS_HOUR * 60, tz);
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const daysBetween = (from: string, to: string) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / DAY));

/** Days counted: from the first daily thread there is (none before Thunderhead began). */
function counted(db: Db, from: string, to: string): number {
  const first = firstDay(db);
  return first ? daysBetween(first > from ? first : from, to) : 0;
}

function chat(hit: (d: DayChat, a: Args, tz: string) => boolean, args: Resolver['args']): Resolver {
  return {
    args,
    outcome: (db, day, a, tz) =>
      hit(ownerDays(db, day, dayBefore(day, -1))[0] ?? { day, n: 0, first: null }, a, tz) ? 1 : 0,
    history: (db, from, to, a, tz) => ({
      k: ownerDays(db, from, to).filter((d) => hit(d, a, tz)).length,
      n: counted(db, from, to),
    }),
  };
}

const none = (a: Record<string, unknown>) => (Object.keys(a).length ? 'no arguments' : {});

export const RESOLVERS: Record<PredictionCategory, Resolver> = {
  'chat.any': chat((d) => d.n > 0, none),
  'chat.count': chat(
    (d, a) => d.n >= Number(a.n),
    (a) =>
      Object.keys(a).length === 1 && Number.isInteger(a.n) && (a.n as number) >= 2 && (a.n as number) <= 50
        ? { n: a.n as number }
        : '{ n }, 2 to 50',
  ),
  'chat.before': chat(
    (d, a, tz) => d.first !== null && d.first < zonedMinute(d.day, minutes(String(a.time)), tz),
    (a) =>
      Object.keys(a).length === 1 && typeof a.time === 'string' && /^(0[5-9]|1\d|2[0-3]):[0-5]\d$/.test(a.time)
        ? { time: a.time }
        : '{ time }, HH:MM from 05:00 to 23:59',
  ),
  'decision.answered': {
    args: (a) =>
      Object.keys(a).length === 1 && typeof a.id === 'string' && /^[0-9a-f-]{36}$/.test(a.id)
        ? { id: a.id }
        : '{ id } of a waiting card',
    outcome: (db, day, a, tz) => {
      const p = proposals.answered(db, String(a.id));
      return p?.decided_at != null && p.decided_at < start(dayBefore(day, -1), tz) ? 1 : 0;
    },
    // The cards that showed in those days, answered by the owner before their day ended.
    history: (db, from, to, _a, tz) => {
      const rows = proposals.shownBetween(db, start(from, tz), start(to, tz));
      const k = rows.filter(
        (r) => r.answered_at !== null && r.answered_at < start(dayBefore(logicalDay(r.show_from, tz), -1), tz),
      ).length;
      return { k, n: rows.length };
    },
  },
};
