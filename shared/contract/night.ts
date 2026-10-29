// The night shift's steps (RUNTIME.md §12): one registry for the Worker, which records each step
// in `night_runs` and refuses a step it doesn't know; for `th night`, which prints them; and for
// the night section of mind/ROLES.md, which a test keeps in step with it. Each step has its
// order, its budget, what makes a rerun of it write nothing new, and whether it keeps a cursor
// (a step that works through its input in parts saves where it got to, so a refire resumes in
// the middle). A step that starts work in a later phase is marked done at once until then.
// Numbers never change meaning: a new step takes the next free number in its place.

export interface NightStep {
  step: number;
  name: string;
  /** Minutes. The whole run: target 30, hard stop 45 (Sunday 60), `NIGHT_BUDGET_MIN`. */
  budget_min: number;
  /** Why running the step twice changes nothing. */
  idempotent: string;
  /** The step saves a cursor (`th night step <n> cursor <c>`) and resumes from it. */
  cursor: boolean;
  /** The phase in which the step starts doing work. */
  phase: 'P3' | 'P4' | 'P5';
  /** Run on Sundays only. */
  sunday?: true;
}

export const NIGHT_STEPS: readonly NightStep[] = [
  { step: 1, name: 'read the day', budget_min: 1, idempotent: 'reads only', cursor: false, phase: 'P3' },
  {
    step: 2,
    name: 'day note and thread titles',
    budget_min: 5,
    idempotent: 'the same note again keeps version 1; titles are set, not added',
    cursor: false,
    phase: 'P3',
  },
  {
    step: 3,
    name: 'loose ends',
    budget_min: 3,
    idempotent: 'a loose end is put by its id; closing a closed one is a no-op',
    cursor: false,
    phase: 'P3',
  },
  {
    step: 4,
    name: 'facts',
    budget_min: 6,
    idempotent: 'each part is one batch with its own id (`th facts --night --part <k>`); sent again, it is already applied',
    cursor: true,
    phase: 'P3',
  },
  {
    step: 5,
    name: 'health and agreed fixes',
    budget_min: 8,
    idempotent: 'reads, then one branch per agreed loose end',
    cursor: false,
    phase: 'P3',
  },
  { step: 6, name: 'indexing jobs', budget_min: 1, idempotent: 'jobs are keyed by their input', cursor: false, phase: 'P5' },
  {
    step: 7,
    name: 'arrange tomorrow',
    budget_min: 4,
    idempotent: 'surfaces are put by app and slot',
    cursor: false,
    phase: 'P3',
  },
  { step: 8, name: 'built overnight', budget_min: 1, idempotent: 'items are put by id', cursor: false, phase: 'P4' },
  {
    step: 9,
    name: 'weekly review and evals',
    budget_min: 15,
    idempotent: 'one eval run a week',
    cursor: false,
    phase: 'P4',
    sunday: true,
  },
  {
    step: 10,
    name: 'session note and done',
    budget_min: 2,
    idempotent: 'the run is marked done once',
    cursor: false,
    phase: 'P3',
  },
];

export const NIGHT_LAST_STEP = NIGHT_STEPS[NIGHT_STEPS.length - 1].step;
export const NIGHT_BUDGET_MIN = { target: 30, hard: 45, sunday_hard: 60 } as const;
/** A cursor is opaque to the Worker: at most this many characters. */
export const NIGHT_CURSOR_MAX = 200;
/** The night's input, `GET /v1/mind/day/:day?part=…`: the counts, then pages of at most
 * `NIGHT_PAGE_MAX` rows, oldest first. */
export const NIGHT_DAY_PARTS = ['stats', 'messages', 'ledger', 'notes'] as const;
export type NightDayPart = (typeof NIGHT_DAY_PARTS)[number];
export const NIGHT_PAGE_MAX = 200;
/** How far back a night may still work on a day it missed (`th night start --day <day>`). */
export const NIGHT_BACKFILL_DAYS = 7;
