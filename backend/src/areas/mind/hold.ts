// When the plan says no (RUNTIME.md §9 F2/F4, §11): the time the chat's hour cap lets the next
// wake go, the words the chat gets for a message held until then, and the plan's
// limit hits the usage meter counts (Settings › The mind). Pure helpers and two settings rows; the
// wake path (wake.ts) decides when they apply.
import { DAY, HOUR } from '../../lib/time';
import type { Db } from '../../objects/base';
import { getSetting, putSetting } from '../settings/store';
import { clock, weekday } from './brief-text';

/** The wake reasons that are the owner's own: a message, or one handed out again. */
export const ownerReason = (reason: string) => reason === 'message' || reason === 'requeue';

/** When the chat's hour cap next lets a fire go, or null when one may go now: the `cap`-th newest
 * fire of the hour ages out of it an hour after it went. */
export function capFreeAt(db: Db, at: number, cap: number): number | null {
  const t = db
    .all<{ at: number }>("SELECT at FROM wakes WHERE task = 'chat' AND at >= ? ORDER BY at", at - HOUR)
    .map((r) => r.at);
  return t.length >= cap ? t[t.length - cap] + HOUR : null;
}

/** Why a message waits: the plan's limit with the reset time the platform gave (`reset`), without
 * one (`retry`: the Worker's own back-off end), or the chat's 20 fires an hour (`cap`). */
export type HeldWhy = 'reset' | 'retry' | 'cap';

/** The chat's line for a held message, with its time in the owner's zone (and the day, when not
 * within the next 20 hours). */
export function heldText(why: HeldWhy, until: number, now: number, tz: string): string {
  const when = until - now > 20 * HOUR ? `${weekday(until, tz)} ${clock(until, tz)}` : clock(until, tz);
  if (why === 'reset')
    return `The mind hit your plan's usage limit. Your message is saved; it answers it first when the limit resets at ${when}.`;
  if (why === 'retry')
    return `The mind isn't waking (likely your plan's usage limit or an outage). Your message is saved; it tries again at ${when} and answers it first.`;
  return `The mind is holding back to fit your plan's limits. Your message is saved; it answers it first at ${when}.`;
}

const HITS = 'mind.limit_hits';
const HITS_KEPT_MS = 8 * DAY;

/** The times the plan's limit refused the mind (a 429 on the fire, a rate or billing limit in a
 * turn), the last 8 days, at most 100. */
export function limitHits(db: Db): number[] {
  const v = getSetting(db, HITS);
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];
}

export function recordHit(db: Db, at: number): void {
  const kept = [...limitHits(db).filter((t) => t > at - HITS_KEPT_MS), at].slice(-100);
  putSetting(db, HITS, kept, 'worker', at);
}

/** The reset time a platform answer gave (`Retry-After`: seconds, or an HTTP date), or null. */
export function retryAt(header: string | null, now: number): number | null {
  if (!header) return null;
  const s = Number(header);
  const at = Number.isFinite(s) && s >= 0 ? now + s * 1000 : Date.parse(header);
  return Number.isFinite(at) && at > now && at <= now + 7 * DAY ? at : null;
}
