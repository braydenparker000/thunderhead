// What a met watch wakes (RUNTIME.md §3 "Watches", §11): the tick and the alarm's pass turns due
// `at` watches into met ones, lets the waiting ones lapse, and releases the queue. A live chat
// session hears a met watch as a `th wait` event (no new wake); otherwise one chat wake carries
// every met watch, through the owner's chat wake path (wake.ts `maybeWake`, reason `watch`), within
// the owner's wake budget (`mind.wake_budget` watch wakes in the logical day; 0 = watches off) and
// under the chat's own ceiling (20 an hour there, 40 fires in 24 hours here). Past the budget the
// watches are refused (`over_budget`) and the mind sees the count in its briefing. While the night
// shift runs, the queue waits until it ends; quiet hours change nothing here (the session says
// nothing that notifies, by the existing rules), but the wake's reason marks them. A claim takes
// what waits: the watches a wake fired, and the queue (no wake spent) when the night is not running.
import { settingSpec, validSetting } from '../../../../../shared/contract/settings.ts';
import { WATCH_LIMITS } from '../../../../../shared/contract/watches.ts';
import { DAY, HOUR, MINUTE, zonedInstant } from '../../../lib/time';
import type { Db } from '../../../objects/base';
import type { Writer } from '../../../objects/commit';
import { DAY_STARTS_HOUR, logicalDay } from '../../conversation/day';
import { inQuiet, quietUntil, quietWindow } from '../../settings/quiet';
import { getSetting } from '../../settings/store';
import * as mstore from '../store';
import { LEASE_MS, maybeWake, type ToFire } from '../wake';
import * as store from './store';

export const QUEUED_MS = WATCH_LIMITS.queued_hours * HOUR;
/** The chat's fires in any 24 hours (RUNTIME.md §1): no watch wakes the mind past them. */
export const WAKES_A_DAY = 40;
/** The night's hard stop (decisions 2026-11-03: target 30 min, stop at 60): a night session open
 * longer has crashed, and a night wake fired this recently is still starting its session. */
const NIGHT_MS = 60 * MINUTE;
const NIGHT_STARTING_MS = 15 * MINUTE;

/** The owner's wake budget (Settings › The mind), the catalogue's default while unset. */
export function wakeBudget(db: Db): number {
  const spec = settingSpec('mind.wake_budget');
  if (!spec) return 0;
  const v = getSetting(db, spec.key);
  return validSetting(spec, v) ? (v as number) : (spec.default as number);
}

/** When the owner's logical day began (04:00 local, conversation/day.ts). */
export const dayStart = (at: number, tz: string) => zonedInstant(logicalDay(at, tz), DAY_STARTS_HOUR, tz);

/** Whether the night shift is running: a night session open within its hard stop, or a night wake
 * fired in the last 15 minutes whose session has not claimed yet. Two index reads. */
export function nightRunning(db: Db, now: number): boolean {
  return (
    db.one(
      "SELECT 1 AS x FROM mind_sessions WHERE role = 'night' AND ended_at IS NULL AND claimed_at >= ? LIMIT 1",
      now - NIGHT_MS,
    ) !== null ||
    db.one(
      "SELECT 1 AS x FROM wakes WHERE status IN ('fired', 'unclaimed') AND at >= ? AND task = 'night' LIMIT 1",
      now - NIGHT_STARTING_MS,
    ) !== null
  );
}

const changed = (w: Writer, id: string) => w.change('watch', `watch:${id}`);

/** The budget's state now: what it allows, the watch wakes in the logical day, the refusals. */
export function budgetNow(db: Db, now: number, tz: string): { budget: number; used: number; refused: number } {
  const since = dayStart(now, tz);
  return { budget: wakeBudget(db), used: store.watchWakes(db, since), refused: store.refusedSince(db, since) };
}

/** The tick's and the alarm's pass: lapse what waited too long, meet the due `at` watches, release
 * the queue. Returns the wake to fire after the commit, if any. */
export function pass(w: Writer, configured: boolean, tz: string): ToFire | null {
  const { db, at } = w;
  for (const r of store.waiting(db))
    if (
      (r.state === 'live' && r.until < at && r.kind !== 'at') ||
      (r.state === 'queued' && (r.met_at ?? at) < at - QUEUED_MS)
    ) {
      store.settle(db, r.id, 'expired', at);
      changed(w, r.id);
    }
  for (const r of store.dueAt(db, at)) {
    store.met(db, r.id, at, null);
    changed(w, r.id);
  }
  return release(w, configured, tz);
}

/** The queue, released: to the live session, into one new chat wake, refused past the budget or the
 * ceiling, or left waiting (the night runs, a fire is already on its way, a backoff, the hour's cap). */
export function release(w: Writer, configured: boolean, tz: string): ToFire | null {
  const { db, at } = w;
  const queued = store.waiting(db).filter((r) => r.state === 'queued');
  if (!queued.length || nightRunning(db, at)) return null;
  const settleAll = (state: 'fired' | 'over_budget', extra: Parameters<typeof store.settle>[4] = {}) => {
    for (const r of queued) {
      store.settle(db, r.id, state, at, extra);
      changed(w, r.id);
    }
  };
  const { budget, used } = budgetNow(db, at, tz);
  if (budget === 0) {
    settleAll('over_budget');
    return null;
  }
  // A live session hears them in its `th wait` (ops.ts `take`): no wake, nothing off the budget.
  const lease = mstore.lease(db, 'chat');
  if (lease && at - lease.renewed_at < LEASE_MS) {
    settleAll('fired', { by: 'event', to_session: lease.session_id });
    return null;
  }
  if (used >= budget || mstore.fireCount(db, 'chat', at - DAY) >= WAKES_A_DAY) {
    settleAll('over_budget');
    return null;
  }
  const f = maybeWake(w, 'watch', configured);
  if (!f) return null;
  const first = queued[0];
  const quiet = inQuiet(at, tz, quietWindow(db)) || quietUntil(db, at) > at;
  store.setReason(db, f.id, { watch: first.id, kind: first.kind, note: first.note, ...(quiet ? { quiet: true } : {}) });
  settleAll('fired', { by: 'wake', wake_id: f.id });
  return f;
}

/** A chat claim takes what waits for it (RUNTIME.md §4.3): the watches fired into a wake nobody took
 * yet, and the queue while the night is not running (the owner's wake carries them: no wake spent,
 * unless the owner turned watches off). */
export function onClaim(w: Writer, sessionId: string, wakeId: string): void {
  const { db, at } = w;
  for (const r of store.unclaimedFired(db, at - QUEUED_MS)) store.handTo(db, r.id, sessionId);
  const queued = store.waiting(db).filter((r) => r.state === 'queued');
  if (!queued.length || nightRunning(db, at)) return;
  const off = wakeBudget(db) === 0;
  for (const r of queued) {
    store.settle(
      db,
      r.id,
      off ? 'over_budget' : 'fired',
      at,
      off ? {} : { by: 'wake', wake_id: wakeId, to_session: sessionId },
    );
    changed(w, r.id);
  }
}
