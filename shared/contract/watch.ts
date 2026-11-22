// What is wrong, told to the owner in the site (OPERATIONS.md §8.5): the Worker's own heartbeat
// (the 15-minute cron), the mind's state in plain words, the lines the Briefing shows for every
// open trip, the bundled push for the serious ones, and the outside watcher's word that the site
// isn't loading. Plain data with erasable types only.
import type { Ms } from './api.ts';

export const WATCH_LIMITS = {
  /** The cron runs every 15 minutes: one not seen for this long is itself a line. */
  cron_stale_min: 45,
  /** The mind unable to start or answer for this long: one line at the chat and on the Briefing. */
  mind_line_h: 2,
  /** ... and for this long: a serious condition (the day's bundled push). */
  mind_push_h: 24,
  /** night.late this many nights running: a serious condition. */
  night_late_nights: 3,
} as const;

/** The watchdogs whose trip is serious: part of the day's one bundled push. */
export const SERIOUS_WATCHDOGS = [
  'backup.stale',
  'drill.failed',
  'roll.stuck',
  'errors.spike',
  'db.size',
  'jobs.stuck',
] as const;

/** Why the mind can't answer: the plan's limit, its routine not set up, or it couldn't be started. */
export type MindCause = 'limit' | 'setup' | 'start';

export interface MindWatch {
  /** The presence light's state (`mind.status`), `asleep` when there is none. */
  state: string;
  /** While it can't answer: since when (its first unanswered wake after it last answered). */
  since: Ms | null;
  cause: MindCause | null;
  /** The plan's limit: when the mind may be woken again. */
  until: Ms | null;
  /** The owner's line, from 2 hours on; null otherwise. */
  line: string | null;
}

/** Deep health's `watch` (GET /v1/ops/health/deep): the heartbeat and what the owner is told. */
export interface OwnerWatch {
  /** The cron's last run and the steps that failed in it (null before its first record). */
  cron: { at: Ms; failed: string[] } | null;
  /** The last day roll (the open day's start). */
  roll_at: Ms | null;
  mind: MindWatch;
  /** A push can reach a phone now: the VAPID key is set and a signed-in phone subscribed. */
  push: boolean;
  /** Schema steps an object hasn't applied, `<object>:<version>`. */
  missing: string[];
  /** The Briefing's lines under "Not working right", one per open condition. */
  lines: string[];
}

/** POST /v1/ops/site (the CI key only): the outside watcher's word on the site. */
export interface SiteRequest {
  state: 'down' | 'up';
}
export interface SiteResponse {
  /** The push this word queued (once when it goes down, once when it is back), or null. */
  pushed: 'down' | 'up' | null;
}

export const SITE_WORDS = {
  down: "The site isn't loading. Your data is safe.",
  up: 'The site is loading again.',
} as const;
