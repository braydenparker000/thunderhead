// The logical day (DATA.md §2.2, MEMORY.md §11): it ends at 04:00 owner-local, and the roll waits
// for 60 quiet minutes, so a late conversation stays on its day. `day.current` (a Core setting)
// names the open day; messages always go to its daily thread.

import { HOUR, MINUTE, ownerDay } from '../../lib/time';
import type { Db } from '../../objects/base';
import * as settings from '../settings/store';

export const DAY_STARTS_HOUR = 4;
export const ROLL_QUIET_MS = 60 * MINUTE;

/** The logical day of an instant: the local date of `at − 4 h`. */
export function logicalDay(at: number, tz: string): string {
  return ownerDay(at - DAY_STARTS_HOUR * HOUR, tz);
}

/** The owner's zone: the private setting, else the public fallback var. */
export function ownerTz(db: Db, fallback: string): string {
  const tz = settings.getSetting(db, 'owner.tz');
  return typeof tz === 'string' && tz ? tz : fallback || 'UTC';
}

/** The open day. Before the first ever message it is today's logical day. */
export function currentDay(db: Db, tz: string, now: number): string {
  const d = settings.getSetting(db, 'day.current');
  return typeof d === 'string' ? d : logicalDay(now, tz);
}

/** Whether the open day should roll now: a later logical day has begun and the conversation has
 * been quiet (both sides) for 60 minutes. */
export function rollDue(current: string, now: number, tz: string, lastMessageAt: number | null): string | null {
  const today = logicalDay(now, tz);
  if (today <= current) return null;
  if (lastMessageAt !== null && now - lastMessageAt < ROLL_QUIET_MS) return null;
  return today;
}

/** A provisional title: the first words of the first owner message, ≤ 40 characters, cut at a
 * word boundary (MEMORY.md §11.3). */
export function provisionalTitle(text: string | null): string | null {
  if (!text) return null;
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length <= 40) return one || null;
  const cut = one.slice(0, 41);
  const at = cut.lastIndexOf(' ');
  return `${(at > 12 ? cut.slice(0, at) : one.slice(0, 40)).replace(/[\s,;:.–-]+$/, '')}…`;
}
