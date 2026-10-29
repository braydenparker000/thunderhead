// Quiet hours (MENU-AND-SETTINGS.md §4.2, owner ruling: nothing that needs the owner before 06:30
// local). The window runs from `quiet.start` (default 22:00) to `quiet.end` (default 06:30, never
// earlier), both `HH:MM` in the owner's zone. A decision card made inside it is held until it
// ends; a "Not yet" brings a card back at the next end. Pushes and the voice line follow later.

import { dayBefore, ownerDay, wallMinute, zonedMinute } from '../../lib/time';
import type { Db } from '../../objects/base';
import { getSetting } from './store';

/** Minutes of the local day. */
export interface QuietWindow {
  start: number;
  end: number;
}

export const QUIET_DEFAULT: QuietWindow = { start: 22 * 60, end: 6 * 60 + 30 };
const EARLIEST_END = 6 * 60 + 30;

function minutes(v: unknown, fallback: number): number {
  const m = typeof v === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
}

export function quietWindow(db: Db): QuietWindow {
  return {
    start: minutes(getSetting(db, 'quiet.start'), QUIET_DEFAULT.start),
    end: Math.max(EARLIEST_END, minutes(getSetting(db, 'quiet.end'), QUIET_DEFAULT.end)),
  };
}

export function inQuiet(at: number, tz: string, q: QuietWindow): boolean {
  const m = wallMinute(at, tz);
  return q.start > q.end ? m >= q.start || m < q.end : m >= q.start && m < q.end;
}

/** The next instant after `at` that the local clock reads the window's end. */
export function nextQuietEnd(at: number, tz: string, q: QuietWindow): number {
  const day = ownerDay(at, tz);
  const today = zonedMinute(day, q.end, tz);
  return today > at ? today : zonedMinute(dayBefore(day, -1), q.end, tz);
}

/** When something made at `at` may first ask for the owner: then, or when its quiet hours end. */
export function heldUntil(at: number, tz: string, q: QuietWindow): number {
  return inQuiet(at, tz, q) ? nextQuietEnd(at, tz, q) : at;
}
