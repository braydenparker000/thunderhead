// Routines (MIND-PLAN §3.6, API.md §11.11 "Routines"): an arrangement the owner approves once. A
// routine is a plan (1–8 verbs, one why, one line on home) plus a condition, and it runs without a
// session under one standing approval. The mind may only propose one: a `routine.propose` card of
// class `routine` (always a card, whatever the steps' standing permissions), whose target line the
// Worker writes from the steps and the condition in words. The owner's yes (a tap or their own
// words) stores it `on`, with the permit as it stood then (the strictest step's position). Core's
// tick and alarm run it when its condition comes, as one plan with one ledger row and one undo; it
// wakes no session and speaks only through the plan's own line on home. Settings › The mind ›
// Routines lists each with its switch, its last run and Undo. Plain data, Node-importable.
import * as z from 'zod/mini';
import type { Id, Ms } from './api';
import type { PermitPosition } from './permits.ts';

/** The weekdays as senses.ts names them (WEEKDAYS there; not imported, since senses.ts imports the
 * proposals registry, which imports this file). */
export const ROUTINE_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof ROUTINE_DAYS)[number];

export const ROUTINE_LIMITS = {
  /** Routines kept at once, on or off: an approval past it fails (`too_many`). */
  max: 12,
  name: 40,
  min_steps: 1,
  max_steps: 8,
  /** Due routines one pass runs, each in its own commit; the alarm comes back for the rest. */
  per_pass: 10,
  /** An event routine fires only for an event this recent (a batch sent late fires nothing). */
  event_fresh_ms: 3_600_000,
  /** The short error Settings shows after a failed run, at most. */
  error: 80,
} as const;

const uuid = z.string().check(z.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
const hhmm = z.string().check(z.regex(/^([01]\d|2[0-3]):[0-5]\d$/));

/** When it runs: `at` a time on these weekdays (every day without `days`), `after` the first event
 * of a sense type in the owner's day (at most once a day), or `fact`: an observed routine fact's
 * usual time (the start of its band of hours, on its weekdays), read when it is approved. */
export const routineCondition = z.union([
  z.strictObject({ at: hhmm, days: z.optional(z.array(z.enum(ROUTINE_DAYS)).check(z.minLength(1), z.maxLength(7))) }),
  z.strictObject({ after: z.string().check(z.regex(/^[a-z]+(\.[a-z_]+)+$/), z.maxLength(40)) }),
  z.strictObject({ fact: uuid }),
]);
export type RoutineCondition = z.infer<typeof routineCondition>;

const step = z.strictObject({
  verb: z.string().check(z.regex(/^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/)),
  schema: z.number().check(z.int(), z.gte(1), z.lte(99)),
  args: z.record(z.string(), z.unknown()),
  device_id: z.optional(z.string().check(z.maxLength(40))),
});

/** The card's args: the routine whole, so the yes stores exactly what the owner read. */
export const routineArgs = z.strictObject({
  id: uuid,
  name: z.string().check(z.minLength(1), z.maxLength(ROUTINE_LIMITS.name)),
  why: z.string().check(z.minLength(8), z.maxLength(200)),
  what: z.string().check(z.minLength(1), z.maxLength(80)),
  steps: z.array(step).check(z.minLength(ROUTINE_LIMITS.min_steps), z.maxLength(ROUTINE_LIMITS.max_steps)),
  condition: routineCondition,
});
export type RoutineArgs = z.infer<typeof routineArgs>;

/** "Weekdays", "Every day", "Sat and Sun"… a set of weekdays in words. */
export function dayWords(days: readonly Weekday[] | undefined): string {
  const set = ROUTINE_DAYS.filter((d) => !days || days.includes(d));
  if (set.length === 7) return 'Every day';
  if (set.join() === 'mon,tue,wed,thu,fri') return 'Weekdays';
  if (set.join() === 'sat,sun') return 'Weekends';
  const names = set.map((d) => d.charAt(0).toUpperCase() + d.slice(1));
  return names.length === 1 ? `${names[0]}s` : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** A routine as GET /v1/routines answers it. `when`: its condition in words; `last_undone`: its
 * last run was taken back; `last_error`: why the last run stopped, until one runs. */
export interface Routine {
  id: Id;
  name: string;
  what: string;
  why: string;
  when: string;
  condition: RoutineCondition;
  steps: string[];
  on: boolean;
  permit: PermitPosition | null;
  proposal_id: Id;
  approved_at: Ms;
  next_at: Ms | null;
  last_run_at: Ms | null;
  last_ledger_id: Id | null;
  last_undone: boolean;
  last_error: string | null;
}
export interface RoutinesResponse {
  items: Routine[];
}
export interface RoutineSwitchRequest {
  on: boolean;
}
