// Reminders the owner sets (HOME.md §6.2 "Remind me", BEHAVIOR.md §3.4, IDEAS.md §4.3): the
// owner's own words at the owner's own time, delivered once as a line in today's conversation and a
// push. Never inside quiet hours (a time there moves to their end); not counted against the push
// budget; no natural-pause wait.
import type { Id, Ms } from './api.ts';

export const REMINDER_LIMITS = {
  /** The reminder's words, in characters. */
  text: 200,
  /** Reminders set and not yet delivered, at once. */
  open: 50,
  /** How far ahead one may be set, in days. */
  days_ahead: 400,
} as const;

/** `set` waits for its time; `done` was delivered; `cancelled` was taken back before it was. */
export type ReminderState = 'set' | 'done' | 'cancelled';

export interface Reminder {
  id: Id;
  text: string;
  /** The time asked for. */
  at: Ms;
  /** When it is delivered: `at`, or the end of quiet hours when `at` falls inside them. */
  fire_at: Ms;
  state: ReminderState;
  /** `owner_device`: set from the phone; `mind`: set by the chat mind when the owner asked in words. */
  origin: 'owner_device' | 'mind';
  created_at: Ms;
  fired_at: Ms | null;
  /** The conversation line it became, once delivered. */
  message_id: Id | null;
}

export interface PutReminderRequest {
  text: string;
  at: Ms;
  /** mind:chat only, and required there: the owner's message that asked for it. */
  source_message_id?: Id;
}

export interface ReminderResponse {
  reminder: Reminder;
}

export interface RemindersResponse {
  /** Set reminders, soonest first, then those delivered or cancelled in the last 24 hours. */
  items: Reminder[];
}
