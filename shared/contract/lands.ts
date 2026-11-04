// What lands, and the speech budget (BEHAVIOR.md §3.6, §3.7; EVALS.md §9). The Worker counts what the
// owner did with each topic the mind placed (kept, undone, ignored, unseen), per topic and per place,
// over the last 30 days; a topic ignored or undone three times in a row with no kept between rests
// for 30 days (422 `topic_quiet`). Counts only, never a score to push the owner with (law 16). The
// speech setting (`mind.speech`) is "as needed" by default: no daily caps; quiet and silent are the
// two positions the Worker holds the mind to (422 `speech_budget`). Plain data, Node-importable.
import type { Id, Ms } from './api';

export const LANDS = {
  /** The window the counts cover. */
  window_days: 30,
  /** Ignored or undone this many times in a row, no kept between: the topic rests. */
  streak: 3,
  /** How long it rests. */
  quiet_days: 30,
  /** The brief's table, at most, worst first. */
  brief_rows: 8,
} as const;

/** Where an arrangement was placed: `home` (its lines), `briefing` (its tiles), or an app's own surface. */
export type LandsPlace = string;

/** One topic's counts in the window (GET /v1/insight/topics). */
export interface TopicLands {
  topic_key: string;
  /** Where it was placed in the window, most recent first. */
  places: LandsPlace[];
  kept: number;
  undone: number;
  ignored: number;
  /** Home lines that never came on screen: not counted against it, and they do not break a streak. */
  unseen: number;
  /** Placed in the last 48 hours, not decided yet. */
  waiting: number;
  /** Ignored or undone in a row since the last kept (or since it last reopened). */
  streak: number;
  /** While it rests: when it reopens, and that owner-local day; else null. */
  quiet_until: Ms | null;
  reopens: string | null;
  /** Whether the mind has said it went quiet (it says so once). */
  said: boolean;
}

export interface TopicsResponse {
  window_days: number;
  /** Worst first: resting topics, then the longest streak, then the most turned down. */
  items: TopicLands[];
}

/** POST /v1/surfaces/topics/:key/reopen: a tap on a device (no body), or the owner's own words,
 * which mind:chat records (`by_message`) and the Worker checks as it checks a card's. */
export interface ReopenTopicRequest {
  by_message?: Id;
}
export interface ReopenTopicResponse {
  topic_key: string;
  ledger_id: Id;
}

/** `mind.speech`: as needed (the default: the voice ladder, nudge_repeat and what lands govern),
 * quiet (at most 1 home line change and 1 card a day; a push only for what the owner asked for),
 * silent (no unprompted speech at all). Reminders ring in every position. */
export const SPEECH_POSITIONS = ['as_needed', 'quiet', 'silent'] as const;
export type SpeechPosition = (typeof SPEECH_POSITIONS)[number];
/** What `quiet` allows a day (the owner's day). */
export const SPEECH_QUIET = { lines: 1, cards: 1 } as const;
/** The writes the speech budget holds: a home line, a Briefing tile (silent only), a card, a push. */
export type SpeechWrite = 'line' | 'tile' | 'card' | 'push';
/** A write that cites the owner's own words asking for it (`asked_by`, a message from a device in
 * the last 48 hours) is a reply, not unprompted speech: no position holds it back. */
export const ASKED_HOURS = 48;

/** What a restrictive position has spent today, in a 422 `speech_budget`'s details and the brief. */
export interface SpeechSpent {
  speech: SpeechPosition;
  lines: number;
  cards: number;
}
