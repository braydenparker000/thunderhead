// When a push may go (BEHAVIOR.md §3.4; owner ruling: nothing before 06:30). A nudge from the mind
// is refused in quiet hours, past 2 a day (the owner's day), within 2 h of another, and on a topic
// pushed in the last 14 days; once queued it waits for a natural pause (no phone showing
// Thunderhead in the last 60 s, no message from the owner in the last 5 minutes) until its
// deadline, then is dropped. While the owner has said "go quiet" (BEHAVIOR.md §8) no nudge is taken
// or sent. Sign-in notices wait only for quiet hours to end; the owner's own test goes at once. A
// reminder the owner set goes at its time: outside the 2 a day and the 2 h gap, with no natural
// pause and through "go quiet", but never inside quiet hours. Pure: the context comes from Core,
// the rows from Auth.
import type { ErrorCode } from '../../../../shared/contract/errors';
import { DAY, HOUR, MINUTE, ownerDay, zonedMinute } from '../../lib/time';
import { inQuiet, type QuietWindow } from '../settings/quiet';

export const PER_DAY = 2;
export const GAP_MS = 2 * HOUR;
export const REPEAT_MS = 14 * DAY;
export const OWNER_PAUSE_MS = 5 * MINUTE;
export const DEFAULT_DEADLINE_MS = 3 * HOUR;

export interface PushContext {
  now: number;
  tz: string;
  quiet: QuietWindow;
  /** When the owner's "go quiet" ends (0: off). */
  quiet_until: number;
  /** A phone showed Thunderhead in the last 60 s. */
  looking: boolean;
  /** When the owner last wrote, or null. */
  owner_at: number | null;
  /** The reminders Core delivered whose push the outbox should hold (by the id of the line each
   * became; the same one offered again is already there). Absent from a Core before reminders. */
  reminders?: ReminderPush[];
}

/** A delivered reminder's push: when it was delivered and until when it may still go. */
export interface ReminderPush {
  id: string;
  at: number;
  until: number;
}

/** The nudges counted against today: sent or still waiting, not dropped. */
export interface NudgeHistory {
  today: number;
  /** The newest nudge sent or waiting, or null. */
  last_at: number | null;
  /** A nudge on the same topic in the last 14 days. */
  repeat: boolean;
}

/** The start of the owner's day around `now`. */
export const dayStart = (ctx: PushContext) => zonedMinute(ownerDay(ctx.now, ctx.tz), 0, ctx.tz);

/** Why a new nudge is refused now, or null. */
export function refusal(ctx: PushContext, h: NudgeHistory): ErrorCode | null {
  if (ctx.quiet_until > ctx.now) return 'quiet';
  if (inQuiet(ctx.now, ctx.tz, ctx.quiet)) return 'quiet_hours';
  if (h.today >= PER_DAY) return 'push_budget';
  if (h.last_at !== null && ctx.now - h.last_at < GAP_MS) return 'push_gap';
  if (h.repeat) return 'nudge_repeat';
  return null;
}

/** Whether a waiting push may go out now. */
export function mayGo(kind: string, ctx: PushContext): boolean {
  if (kind === 'test') return true;
  if (inQuiet(ctx.now, ctx.tz, ctx.quiet)) return false;
  if (kind !== 'nudge') return true;
  return (
    ctx.quiet_until <= ctx.now && !ctx.looking && (ctx.owner_at === null || ctx.now - ctx.owner_at >= OWNER_PAUSE_MS)
  );
}
