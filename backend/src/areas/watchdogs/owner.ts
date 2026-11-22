// What is wrong, in the owner's words (OPERATIONS.md §8.5, shared/contract/watch.ts): one plain
// line per open trip (the quota trips have their own line, areas/meter; a drill is nothing wrong),
// the mind unable to answer for 2 hours, the cron not seen for 45 minutes or a step that failed in
// its last run. The serious ones
// (watch.ts SERIOUS_WATCHDOGS, night.late three nights running, the mind unable to answer for a
// day) go as the day's one bundled push: it is offered only on the owner's day the condition
// became serious, so a condition that lasts pushes once. Pure in `db`; reads counts and states only.
import type { MindPresence } from '../../../../shared/contract/conversation.ts';
import {
  WATCH_LIMITS as L,
  type MindCause,
  type MindWatch,
  SERIOUS_WATCHDOGS,
} from '../../../../shared/contract/watch.ts';
import type { WatchdogName } from '../../../../shared/contract/watchdogs.ts';
import { DAY, HOUR, MINUTE, ownerDay, wallMinute, zonedMinute } from '../../lib/time';
import type { Db } from '../../objects/base';
import { dayNote } from '../memory/notes';
import { firstUnclaimedChat } from '../mind/latency';
import { nightDayOf, nightDone } from '../mind/night';
import { backoff } from '../mind/wake';
import { getSetting } from '../settings/store';
import { built } from './ops';
import * as store from './store';

const DRILL = 'a drill: tripped by hand, nothing is wrong';
const NOTHING = 'Nothing needed from you.';

/** Each watchdog's line (quota.*: the meter's own line says it). */
const LINES: Partial<Record<WatchdogName, string>> = {
  'errors.spike': `The server is failing more often than usual. ${NOTHING}`,
  'client.errors': `The site is hitting errors on your phone more than usual. ${NOTHING}`,
  'roll.stuck': `Yesterday hasn't been closed off, so today's pages may be behind. ${NOTHING}`,
  'night.late': `The night shift didn't finish last night. ${NOTHING}`,
  'jobs.stuck': `A background task is stuck. ${NOTHING}`,
  'db.size': 'Storage is getting full. Nothing is lost, but something will need deleting soon.',
  'backup.stale': `The weekly backup hasn't run for over 8 days. Your data is still here. ${NOTHING}`,
  'drill.failed': `The last backup check failed. Your data is still here. ${NOTHING}`,
  'drill.overdue': `The monthly backup check is overdue. ${NOTHING}`,
  'reply.late': `A message has waited over 30 minutes for a reply. It's kept. ${NOTHING}`,
  'events.export.late': `Yesterday's activity hasn't been archived yet. ${NOTHING}`,
};

/** Each serious condition's words in the push. */
const PUSH: Record<string, string> = {
  'backup.stale': "Backups haven't run for over 8 days.",
  'drill.failed': 'The last backup check failed.',
  'roll.stuck': "The day hasn't rolled over for 30 hours.",
  'errors.spike': 'The server is failing more than usual.',
  'db.size': 'Storage is getting full.',
  'jobs.stuck': 'A background task is stuck.',
  'night.late': "The night shift hasn't finished for 3 nights.",
  mind: "The mind hasn't been able to answer for a day.",
};

/** The cron's steps (areas/ops/cron.ts), in the owner's words. */
const STEPS: Record<string, string> = {
  auth: 'the sign-in tidy-up',
  tick: "the day's work",
  calendars: 'your calendar links',
  approvals: 'approved changes',
  pushes: 'pushes',
  photos: 'the Google Drive photos pass',
};

export const hhmm = (at: number, tz: string) => {
  const m = wallMinute(at, tz);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const weekday = (at: number, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(at);
/** "14:05" today, "Mon 14:05" before. */
const when = (at: number, now: number, tz: string) =>
  ownerDay(at, tz) === ownerDay(now, tz) ? hhmm(at, tz) : `${weekday(at, tz)} ${hhmm(at, tz)}`;

const DOWN = new Set(['failed', 'limited', 'unconfigured']);

/** The mind's state: while its presence says it can't answer, since its first wake nobody claimed
 * after it last answered (or since the presence said so), and why. */
export function mindWatch(db: Db, now: number, tz: string): MindWatch {
  const p = getSetting(db, 'mind.status') as MindPresence | undefined;
  const state = p?.state ?? 'asleep';
  if (!DOWN.has(state)) return { state, since: null, cause: null, until: null, line: null };
  const first = firstUnclaimedChat(db, now - 8 * DAY);
  const since = first ?? p?.since ?? null;
  const cause: MindCause = state === 'limited' ? 'limit' : state === 'unconfigured' ? 'setup' : 'start';
  const b = backoff(db).until;
  const until = cause === 'limit' && b > now ? b : null;
  const why =
    cause === 'limit'
      ? `it reached the plan's limit${until ? ` until ${hhmm(until, tz)}` : ''}`
      : cause === 'setup'
        ? "its routine isn't set up"
        : "it couldn't be started";
  const line =
    since !== null && now - since >= L.mind_line_h * HOUR
      ? `The mind hasn't answered since ${when(since, now, tz)}: ${why}. Music, reminders and the rest still work, and your messages are kept.`
      : null;
  return { state, since, cause, until, line };
}

/** The cron's last run, as it recorded it (ops.cron). */
export function cronBeat(db: Db): { at: number; failed: string[] } | null {
  const v = getSetting(db, 'ops.cron') as { at?: unknown; failed?: unknown } | undefined;
  return v && typeof v.at === 'number'
    ? { at: v.at, failed: Array.isArray(v.failed) ? (v.failed as string[]) : [] }
    : null;
}

/** Nights running, up to `L.night_late_nights`, with no day note and no finished run. */
export function lateNights(db: Db): number {
  const d = store.dayStartedAt(db);
  if (!d) return 0;
  let night = nightDayOf(d.day);
  let n = 0;
  while (n < L.night_late_nights && !dayNote(db, night) && !nightDone(db, night)) {
    n++;
    night = nightDayOf(night);
  }
  return n;
}

export interface Alarms {
  lines: string[];
  /** The serious conditions and when each became serious. */
  serious: { key: string; at: number }[];
}

/** Every open condition's line, and the serious ones. */
export function alarms(db: Db, now: number, tz: string): Alarms {
  const lines: string[] = [];
  const serious: Alarms['serious'] = [];
  for (const r of store.tripped(db)) {
    if (r.detail === DRILL || !built(r.name)) continue;
    const line = LINES[r.name];
    if (line) lines.push(line);
    const at = r.since ?? now;
    if ((SERIOUS_WATCHDOGS as readonly string[]).includes(r.name)) serious.push({ key: r.name, at });
    else if (r.name === 'night.late' && lateNights(db) >= L.night_late_nights) serious.push({ key: r.name, at });
  }
  const mind = mindWatch(db, now, tz);
  if (mind.line) lines.push(mind.line);
  if (mind.since !== null && now - mind.since >= L.mind_push_h * HOUR)
    serious.push({ key: 'mind', at: mind.since + L.mind_push_h * HOUR });
  const cron = cronBeat(db);
  if (cron && now - cron.at > L.cron_stale_min * MINUTE)
    lines.push(
      `The 15-minute background check hasn't run since ${when(cron.at, now, tz)}, so reminders and pushes may be late. ${NOTHING}`,
    );
  else if (cron?.failed.length) {
    const words = cron.failed.map((f) => STEPS[f] ?? f);
    const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0];
    lines.push(`The last background check couldn't finish ${list}. It tries again every 15 minutes.`);
  }
  return { lines, serious };
}

/** The day's bundled push, when a serious condition became serious on the owner's day (once a day:
 * its id names the day), held by quiet hours and delivered at their end. */
export function alarmPush(
  db: Db,
  now: number,
  tz: string,
): { id: string; at: number; until: number; body: string } | null {
  const day = ownerDay(now, tz);
  const start = zonedMinute(day, 0, tz);
  const { serious } = alarms(db, now, tz);
  if (!serious.some((s) => s.at >= start && s.at <= now)) return null;
  const words = serious.map((s) => PUSH[s.key]).filter(Boolean);
  const body =
    words.length === 1
      ? `${words[0]} More on the Briefing.`
      : `${words.length} things aren't working right. More on the Briefing.`;
  return { id: `alarm-${day}`, at: now, until: now + DAY, body };
}
