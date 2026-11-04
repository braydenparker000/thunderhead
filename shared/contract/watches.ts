// Watches, the day pulse (MIND-PLAN §5.2, RUNTIME.md §3): a condition the mind stores that, met
// once, fires a short chat-role wake with its reason, within the owner's wake budget
// (`mind.wake_budget`, Settings › The mind); and the usage meter that shows how often it woke
// (GET /v1/mind/usage). A watch fires once and is done: a repeating one is a routine (later). Plain
// data; Node imports it without a build.
import * as z from 'zod/mini';
import type { Day, Id, Ms } from './api.ts';
import type { MindRole } from './conversation.ts';
import { SENSE_TYPES } from './senses.ts';
import { UUID7, type VerbSpec } from './verb-spec.ts';

export const WATCH_KINDS = ['at', 'event', 'change'] as const;
export type WatchKind = (typeof WATCH_KINDS)[number];

export const WATCH_LIMITS = {
  /** Watches waiting at once (live, or met and queued). */
  live: 20,
  /** An `at` watch is at most this far ahead; an event or change watch lapses unmet after it. */
  ahead_days: 7,
  why_min: 8,
  why_max: 200,
  /** What the wake carries back to the mind, beside the why. */
  note: 140,
  ref: 200,
  /** A met watch that could not wake the mind yet (the night run, a usage backoff, the hour's cap)
   * waits this long, then lapses. */
  queued_hours: 12,
} as const;

/** The Worker's own events a watch may name beside the senses (SENSE_TYPES). */
export const WORKER_EVENTS = {
  'reminder.fired': 'A reminder rings (ref: reminder:<id>).',
} as const;
export const WATCH_EVENTS = [...Object.keys(SENSE_TYPES), ...Object.keys(WORKER_EVENTS)] as [string, ...string[]];

/** The change kinds a watch may name (feed.ts CHANGE_KINDS), each met when its thing settles, not
 * on every change. */
export const WATCH_CHANGES = {
  work: 'A work order ends: done, failed, rejected, expired or cancelled (ref: work:<id>).',
  verb: "A verb's result comes back, done or failed (ref: verb:<id>); never a watch verb's own.",
  proposal: 'A decision card is answered or lapses (ref: proposal:<id>).',
  prediction: 'A prediction resolves (ref: prediction:<id>).',
} as const;
export type WatchChange = keyof typeof WATCH_CHANGES;

/** `live` waits; `queued` was met and waits to wake the mind; `fired` woke it (`by: wake`) or went
 * to its live session as a `th wait` event (`by: event`); `over_budget` was met past the owner's
 * wake budget and refused; `cancelled` by `watch.cancel`; `expired` never met in time. */
export const WATCH_STATES = ['live', 'queued', 'fired', 'over_budget', 'cancelled', 'expired'] as const;
export type WatchState = (typeof WATCH_STATES)[number];

/** Why the mind woke, as the Worker counts it on the meter: the owner (a message, the typing
 * pre-warm, a requeue, a session opened by hand), a watch, the day roll's night, the night's 06:07
 * schedule, a watchdog. */
export const WAKE_CAUSES = ['owner', 'watch', 'roll', 'schedule', 'watchdog'] as const;
export type WakeCause = (typeof WAKE_CAUSES)[number];

export interface Watch {
  id: Id;
  kind: WatchKind;
  /** `at`: when it fires. */
  at: Ms | null;
  /** `event`: a sense type or a Worker event; `change`: a change kind. */
  type: string | null;
  ref: string | null;
  /** The mind's own words; null when they are kept back (set after outside text, read by a clean
   * session: MEMORY.md §6 M11). */
  why: string | null;
  note: string | null;
  provenance: 'owner' | 'outside';
  state: WatchState;
  created_at: Ms;
  /** When it lapses unmet. */
  until: Ms;
  met_at: Ms | null;
  /** When it fired, was refused, cancelled or lapsed. */
  settled_at: Ms | null;
  by: 'wake' | 'event' | null;
  wake_id: Id | null;
}

/** GET /v1/mind/watches: the waiting ones first, then the last day's others (≤ 50). */
export interface WatchesResponse {
  items: Watch[];
  live: number;
  budget: number;
  /** Watch wakes in the owner's logical day, and watches refused over the budget. */
  used: number;
  refused: number;
}

export interface UsageDay {
  day: Day;
  wakes: Record<WakeCause, number>;
  /** Minutes awake by role, from the sessions' claims and ends. */
  minutes: Record<MindRole, number>;
  /** The night shift's run that day (it works on the day before): started to done. */
  night_min: number;
  watches: { fired: number; refused: number };
  /** Cold wakes answered that day (chat wakes a message fired whose session replied): how many,
   * and the median seconds from the fire to the claim and from the claim to the first reply. */
  latency: { replies: number; claim_s: number | null; reply_s: number | null };
}

/** GET /v1/mind/usage: the meter on Settings › The mind. Counts only. */
export interface UsageResponse {
  today: UsageDay;
  /** The 7 days before today, newest first. */
  days: UsageDay[];
  budget: number;
  live: number;
}

const why = z.string().check(z.minLength(WATCH_LIMITS.why_min), z.maxLength(WATCH_LIMITS.why_max));
const note = z.optional(z.string().check(z.minLength(1), z.maxLength(WATCH_LIMITS.note)));
const ref = z.optional(
  z.string().check(z.maxLength(WATCH_LIMITS.ref), z.regex(/^[a-z][a-z0-9]{1,15}:[A-Za-z0-9._:/-]{1,160}(#[A-Za-z0-9._:-]{1,64})?$/)),
);
const set = z.object({ watch_id: z.string(), state: z.enum(WATCH_STATES), until: z.number() });

/** `watch.set` and `watch.cancel`: the mind's own bookkeeping, so no class gates them (each fired
 * wake counts against the owner's wake budget instead); run by the Worker
 * (backend/src/areas/mind/watches/verbs.ts). */
export const WATCH_VERBS = {
  'watch.set': {
    app: 'shell',
    class: 'reversible',
    permit: null,
    side: 'worker',
    queueable: true,
    undo: 'stored',
    versions: {
      1: {
        // `at` (ms) with kind `at`; `type` (and an optional `ref`) with `event` (WATCH_EVENTS) or
        // `change` (WATCH_CHANGES): the Worker checks which goes with which (areas/mind/watches/ops.ts).
        args: z.strictObject({
          kind: z.enum(WATCH_KINDS),
          at: z.optional(z.number().check(z.int(), z.gte(0))),
          type: z.optional(z.enum([...WATCH_EVENTS, ...Object.keys(WATCH_CHANGES)] as [string, ...string[]])),
          ref,
          why,
          note,
        }),
        result: set,
      },
    },
    what: 'wake me once when a time, an event or a change comes',
    doc: 'Sets a watch: `at` (a time, at most 7 days ahead), `event` (a sense type or `reminder.fired`, optionally its ref) or `change` (`work`, `verb`, `proposal` or `prediction`, met when it settles; optionally its ref). Met once, it wakes the chat with its why and note (a live session hears it in `th wait`), within the wake budget; at most 20 wait at once. From a claimed session that was handed nothing off the record. Its undo cancels it.',
  },
  'watch.cancel': {
    app: 'shell',
    class: 'reversible',
    permit: null,
    side: 'worker',
    queueable: true,
    undo: 'stored',
    versions: {
      1: {
        args: z.strictObject({ id: z.string().check(z.regex(UUID7)) }),
        result: set,
      },
    },
    what: 'cancel a watch that has not fired',
    doc: 'Cancels a live or queued watch. Its undo sets it waiting again while its time has not passed and fewer than 20 wait.',
  },
} as const satisfies Record<string, VerbSpec>;
