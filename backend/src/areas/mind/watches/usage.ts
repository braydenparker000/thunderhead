// The usage meter (MIND-PLAN §5.4, GET /v1/mind/usage, Settings › The mind): today and the 7 days
// before it, in the owner's logical days, from the Worker's own records only: the wakes by cause
// (a retry is the same wake), the minutes each role was awake (the sessions' claims and ends), the
// night shift's run, and the watches fired or refused. Counts only. A session that never said it
// ended counts to its role's limit: the chat's idle cutoff after the owner's last message (120
// min), the night's hard stop (60), the reflex's run (10). Reads by time index, about 8 days of rows.
import type { MindRole } from '../../../../../shared/contract/api';
import {
  type UsageDay,
  type UsageResponse,
  WAKE_CAUSES,
  type WakeCause,
} from '../../../../../shared/contract/watches.ts';
import { dayBefore, MINUTE, zonedInstant } from '../../../lib/time';
import type { Db } from '../../../objects/base';
import { DAY_STARTS_HOUR, logicalDay } from '../../conversation/day';
import { wakeBudget } from './pulse';
import * as store from './store';

const DAYS = 8;
const LIMIT_MIN: Record<MindRole, number> = { chat: 120, night: 60, reflex: 10 };

/** Why a wake fired, as the meter counts it (shared/contract/watches.ts WAKE_CAUSES). The night's
 * claim by its 06:07 schedule shows as `manual` (RUNTIME.md §12), so a manual night is `schedule`. */
export function causeOf(task: string, reason: string): WakeCause {
  if (task === 'reflex') return 'watchdog';
  if (task === 'night') return reason === 'roll' ? 'roll' : 'schedule';
  return reason === 'watch' ? 'watch' : 'owner';
}

const empty = (day: string): UsageDay => ({
  day,
  wakes: Object.fromEntries(WAKE_CAUSES.map((c) => [c, 0])) as Record<WakeCause, number>,
  minutes: { chat: 0, night: 0, reflex: 0 },
  night_min: 0,
  watches: { fired: 0, refused: 0 },
});

const minutes = (from: number, to: number) => Math.max(0, Math.round((to - from) / MINUTE));

export function usage(db: Db, now: number, tz: string): UsageResponse {
  const today = logicalDay(now, tz);
  const days = Array.from({ length: DAYS }, (_, i) => empty(dayBefore(today, i)));
  const byDay = new Map(days.map((d) => [d.day, d]));
  const from = zonedInstant(days[DAYS - 1].day, DAY_STARTS_HOUR, tz);
  const of = (at: number) => byDay.get(logicalDay(at, tz));
  for (const w of db.all<{ at: number; task: string; reason: string }>(
    'SELECT at, task, reason FROM wakes WHERE at >= ? AND retry_of IS NULL',
    from,
  )) {
    const d = of(w.at);
    if (d) d.wakes[causeOf(w.task, w.reason)]++;
  }
  for (const s of db.all<{ role: MindRole; claimed_at: number; ended_at: number | null; last_owner_at: number | null }>(
    'SELECT role, claimed_at, ended_at, last_owner_at FROM mind_sessions WHERE claimed_at >= ? AND wake_id IS NOT NULL',
    from,
  )) {
    const d = of(s.claimed_at);
    if (!d || !(s.role in LIMIT_MIN)) continue;
    const base = s.role === 'chat' ? Math.max(s.claimed_at, s.last_owner_at ?? 0) : s.claimed_at;
    d.minutes[s.role] += minutes(s.claimed_at, Math.min(s.ended_at ?? now, base + LIMIT_MIN[s.role] * MINUTE, now));
  }
  for (const r of db.all<{ started_at: number; done_at: number | null }>(
    'SELECT started_at, done_at FROM night_runs WHERE day >= ?',
    dayBefore(days[DAYS - 1].day),
  )) {
    const d = of(r.started_at);
    if (d)
      d.night_min += minutes(r.started_at, Math.min(r.done_at ?? now, r.started_at + LIMIT_MIN.night * MINUTE, now));
  }
  for (const w of store.settledSince(db, from, 2_000)) {
    const d = of(w.settled_at ?? 0);
    if (d && w.state === 'fired') d.watches.fired++;
    else if (d && w.state === 'over_budget') d.watches.refused++;
  }
  return { today: days[0], days: days.slice(1), budget: wakeBudget(db), live: store.countWaiting(db) };
}
