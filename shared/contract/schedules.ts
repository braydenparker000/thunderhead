// Scheduled actions and plans (API.md §11.11, MIND-PLAN §3.4–3.5), as data: the limits the Worker
// enforces (backend/src/areas/verbs/schedule.ts, plan.ts), `th` checks before sending and
// CONTRACT.md lists. A verb or a plan queued with `fire_at` waits as a `scheduled` row under the
// permit checked when it was queued, and the Worker's alarm runs it at that time. A plan is 2–8
// verbs with one why, one undo and one line on home. Plain data; Node imports it without a build.
import type { PermitClass } from './permits.ts';

export const SCHEDULE_LIMITS = {
  /** Scheduled actions (verbs and plans) waiting at once; one more is 429 `too_many_scheduled`
   * (owner, 2026-11-03). */
  pending: 20,
  /** How far ahead `fire_at` may be, in days (owner, 2026-11-03). */
  days_ahead: 7,
} as const;

export const PLAN_LIMITS = {
  min_steps: 2,
  max_steps: 8,
  /** The plan's line on home ("Set up your evening."), at most this many characters. */
  what: 80,
} as const;

/** The action a plan is gated and carded as: its class and position are the strictest of its
 * steps' (an `ask` anywhere asks for the whole plan), its call is the steps (and `fire_at`). Not a
 * verb: it has no class of its own, so it is in neither VERBS nor MIND_ACTIONS. */
export const PLAN_ACTION = 'plan.run';

/** Classes whose actions never fire inside the owner's quiet hours: one due then fires at their end,
 * and the answer says `shifted` (a plan with such a step waits as a whole). */
export const QUIET_HELD: readonly PermitClass[] = ['music', 'podcasts'];

/** `fire_at` on the wire: an ISO time, owner-local (no offset: the owner's zone) or with its
 * offset or `Z`. */
export const FIRE_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/;
