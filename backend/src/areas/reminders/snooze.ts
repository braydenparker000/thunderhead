// The standing reminder rules (`reminder.snooze_rule`, shared/contract/verbs-shell.ts): daily
// windows, each named by what it is for ("never during practice"), in which no reminder rings.
// Kept in the Worker's settings (`reminders.snooze`, at most SNOOZE_RULES_MAX, newest first, as
// the Briefing's pins are) and read with the quiet hours: a reminder set or moved into a window
// rings at its end (ops.ts `fireAt`), and one due inside one lands in the thread without a push.
import { SNOOZE_RULES_MAX } from '../../../../shared/contract/verbs.ts';
import type { Db } from '../../objects/base';
import { heldUntil, inQuiet, type QuietWindow } from '../settings/quiet';
import { getSetting } from '../settings/store';

export const SNOOZE_KEY = 'reminders.snooze';
export interface SnoozeRule {
  during: string;
  from: string;
  to: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minute = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const isRule = (r: unknown): r is SnoozeRule => {
  const x = r as SnoozeRule | null;
  return !!x && typeof x.during === 'string' && HHMM.test(String(x.from)) && HHMM.test(String(x.to));
};

export function snoozeRules(db: Db): SnoozeRule[] {
  const v = getSetting(db, SNOOZE_KEY);
  return Array.isArray(v) ? v.filter(isRule) : [];
}

/** The rules with this one first, replacing one for the same `during`, at most SNOOZE_RULES_MAX. */
export const withRule = (rules: SnoozeRule[], r: SnoozeRule): SnoozeRule[] =>
  [r, ...rules.filter((x) => x.during !== r.during)].slice(0, SNOOZE_RULES_MAX);

/** The rules as windows of the local day (a window from a time to the same time is none). */
export const snoozeWindows = (db: Db): QuietWindow[] =>
  snoozeRules(db)
    .map((r) => ({ start: minute(r.from), end: minute(r.to) }))
    .filter((w) => w.start !== w.end);

/** The first time from `at` outside every window (a few passes, since windows may touch). */
export function pastAll(at: number, tz: string, windows: QuietWindow[]): number {
  let t = at;
  for (let i = 0; i < 4; i++) {
    const next = windows.reduce((m, w) => heldUntil(m, tz, w), t);
    if (next === t) break;
    t = next;
  }
  return t;
}

export const inAny = (at: number, tz: string, windows: QuietWindow[]) => windows.some((w) => inQuiet(at, tz, w));
