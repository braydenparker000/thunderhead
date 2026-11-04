// The meter (P9; EVALS.md §9 and M-8, M-16): pure counts from the rows Core and the Senses object give.
// An arrangement (a surface the mind placed) is undone when the owner took it back within 48 hours;
// else, once 48 hours have passed, kept when they acted on it on its day or the next (tapped its tile,
// or opened the app it names, `ref: app:<id>`: the app's page, the shell bringing it to the front, or
// a reply's chip to it, or took up an app's arrangement, `arrangement.tap`), ignored when they
// dismissed it or did nothing, and, for a home line or an app's arrangement, unseen when it never
// came on screen (`line.seen`, `arrangement.seen`): a line nobody saw was not turned down. One placed in
// the last 48 hours waits. Never a score to push the owner with (law 16).
import { type InsightResponse, PREDICTION_APPS } from '../../../../shared/contract/predictions.ts';
import { DAY, dayBefore, HOUR } from '../../lib/time';
import { logicalDay } from '../conversation/day';

export const WEEKS = 4;
export const DECIDED_AFTER = 48 * HOUR;
/** The sense types the meter reads: a tile's tap, each app's opening (its page, the shell's, a
 * reply's chip), and whether a home line was seen or dismissed. */
export const METER_SENSES = [
  'briefing.tile',
  ...Object.values(PREDICTION_APPS),
  'app.open',
  'reply.open_chip',
  'line.seen',
  'line.dismiss',
  'arrangement.seen',
  'arrangement.tap',
  'arrangement.dismiss',
];

export interface Arrangement {
  id: string;
  at: number;
  ref: string | null;
  undone_at: number | null;
  /** A line on home (`home/line.<n>`) or an app's arrangement slot, which the phone reports seen. */
  line?: number | boolean;
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

/** The rollups that counted something, as one set to look up. */
export const seenSet = (senses: Rollup[]) =>
  new Set(senses.filter((r) => r.n > 0).map((r) => `${r.day}|${r.type}|${r.ref}`));

/** How the owner has met one arrangement so far, by the meter's rule: undone (taken back within 48
 * hours), kept (its tile tapped, or the app it names opened, on its day or the next), ignored
 * (dismissed), unseen (a home line never on screen), or nothing yet. The meter decides only once 48
 * hours have passed (nothing yet then counts as ignored); the mind's briefing reads it as it stands. */
export function metSoFar(
  a: Arrangement,
  seen: Set<string>,
  tz: string,
): 'undone' | 'kept' | 'ignored' | 'unseen' | null {
  if (a.undone_at !== null && a.undone_at - a.at <= DECIDED_AFTER) return 'undone';
  const day = logicalDay(a.at, tz);
  const days = [day, dayBefore(day, -1)];
  const on = (type: string, ref: string) => days.some((d) => seen.has(`${d}|${type}|${ref}`));
  const own = `ledger:${a.id}`;
  const app = a.ref?.startsWith('app:') ? PREDICTION_APPS[a.ref.slice(4) as keyof typeof PREDICTION_APPS] : null;
  const opened = !!a.ref && (on('app.open', a.ref) || on('reply.open_chip', a.ref) || (!!app && on(app, '')));
  // A tap on it is kept; a dismissal outweighs the app opened anyway; a home line never shown is
  // not counted against it.
  if (on('briefing.tile', own) || on('arrangement.tap', own)) return 'kept';
  if (on('line.dismiss', own) || on('arrangement.dismiss', own)) return 'ignored';
  if (opened) return 'kept';
  if (a.line && !on('line.seen', own) && !on('arrangement.seen', own)) return 'unseen';
  return null;
}

/** M-16. */
export function arrangements(
  rows: Arrangement[],
  senses: Rollup[],
  now: number,
  tz: string,
): InsightResponse['arrangements'] {
  const seen = seenSet(senses);
  const out = { kept: 0, undone: 0, ignored: 0, waiting: 0, unseen: 0 };
  for (const a of rows) {
    const met = metSoFar(a, seen, tz);
    if (met === 'undone') out.undone++;
    else if (now - a.at < DECIDED_AFTER) out.waiting++;
    else out[met ?? 'ignored']++;
  }
  return out;
}
