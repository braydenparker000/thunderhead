// The usage meter (MIND-PLAN §5.4, GET /v1/mind/usage, Settings › The mind): today and the 7 days
// before it, in the owner's logical days, from the Worker's own records only: the wakes by cause
// (a retry is the same wake), the minutes each role was awake (the sessions' claims and ends), the
// night shift's run, the watches fired or refused, and how fast cold wakes were answered (the
// median seconds from the fire to the claim and from the claim to the first reply, B5). Counts
// only. A session that never said it ended counts to its role's limit: the chat's idle cutoff
// after the owner's last message (its setting's 120 min; a busy day's longer cutoff is not
// known here), the night's hard stop (60), the reflex's run (10). Reads by time index, about 8
// days of rows.
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
  latency: { replies: 0, claim_s: null, reply_s: null },
});

const minutes = (from: number, to: number) => Math.max(0, Math.round((to - from) / MINUTE));
const seconds = (from: number, to: number) => Math.max(0, Math.round((to - from) / 1000));

/** The middle value (the mean of the two middle ones for an even count), or null for none. */
export function median(ns: number[]): number | null {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** A cold wake: a chat wake a message fired (or a requeue of one), not a pre-warm or a watch. */
const cold = (w: { task: string; reason: string }) =>
  w.task === 'chat' && (w.reason === 'message' || w.reason === 'requeue');

export function usage(db: Db, now: number, tz: string): UsageResponse {
  const today = logicalDay(now, tz);
  const days = Array.from({ length: DAYS }, (_, i) => empty(dayBefore(today, i)));
  const byDay = new Map(days.map((d) => [d.day, d]));
  const from = zonedInstant(days[DAYS - 1].day, DAY_STARTS_HOUR, tz);
  const of = (at: number) => byDay.get(logicalDay(at, tz));
  const claims = new Map<string, number[]>();
  const replies = new Map<string, number[]>();
  for (const w of db.all<{
    at: number;
    task: string;
    reason: string;
    retry_of: string | null;
    fired_at: number | null;
    claimed_at: number | null;
    first_reply_at: number | null;
  }>('SELECT at, task, reason, retry_of, fired_at, claimed_at, first_reply_at FROM wakes WHERE at >= ?', from)) {
    const d = of(w.at);
    if (!d) continue;
    // A retry is the same wake to the count, but the one that got the claim to the latency.
    if (w.retry_of === null) d.wakes[causeOf(w.task, w.reason)]++;
    if (cold(w) && w.fired_at !== null && w.claimed_at !== null && w.first_reply_at !== null) {
      d.latency.replies++;
      claims.set(d.day, [...(claims.get(d.day) ?? []), seconds(w.fired_at, w.claimed_at)]);
      replies.set(d.day, [...(replies.get(d.day) ?? []), seconds(w.claimed_at, w.first_reply_at)]);
    }
  }
  for (const d of days) {
    d.latency.claim_s = median(claims.get(d.day) ?? []);
    d.latency.reply_s = median(replies.get(d.day) ?? []);
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
