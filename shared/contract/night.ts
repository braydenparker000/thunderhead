// The night shift's steps (RUNTIME.md §12): one registry for the Worker, which records each step
// in `night_runs` and refuses a step it doesn't know; for `th night`, which prints them; and for
// the night section of mind/ROLES.md, which a test keeps in step with it. Each step has its
// order, its budget, what makes a rerun of it write nothing new, and whether it keeps a cursor
// (a step that works through its input in parts saves where it got to, so a refire resumes in
// the middle). A step that starts work in a later phase is marked done at once until then.
// Numbers never change meaning: a new step takes the next free number in its place, so the run's
// order is the list's (NIGHT_ORDER), and a finished run answers NIGHT_END, past every number.

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
  phase: 'P3' | 'P4' | 'P5' | 'P7';
  /** Run on Sundays only. */
  sunday?: true;
  /** Built in a later step of its phase: the text says what it waits on. Skipped (`later`) until then. */
  deferred?: string;
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
  // Arranging the page comes right after memory (2026-11-02): placed after health and the
  // books it began at minute 33 of the budgets, past the 30-minute target, and a run the hard stop
  // ended had cut it, so the Briefing and home got nothing (BRIEFING.md "Why the Briefing was
  // empty"). Here it begins by minute 15 and has the facts of step 4 to draw on.
  {
    step: 7,
    name: 'arrange tomorrow',
    budget_min: 4,
    idempotent: 'surfaces are put by app and slot',
    cursor: false,
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
  // Indexing: from P7, reading Study's waiting books (mind/jobs/study-ingest.mjs: at most 2 books,
  // 10 minutes; a book not finished goes on the next night). The P5 indexing jobs join it later.
  {
    step: 6,
    name: 'indexing (Study’s books)',
    budget_min: 10,
    idempotent: 'a book is claimed by one run at a time and goes on from its cursor; a page is put by its number',
    cursor: false,
    phase: 'P7',
  },
  {
    step: 8,
    name: 'built overnight',
    budget_min: 1,
    idempotent: 'items are put by id',
    cursor: false,
    phase: 'P4',
    deferred: "the Briefing page's Built overnight tile (P4 stage H)",
  },
  {
    step: 9,
    name: 'weekly evals (the injection suite)',
    budget_min: 15,
    idempotent: 'each fixture runs on a fresh sandbox; th eval end records one run',
    cursor: false,
    phase: 'P4',
    sunday: true,
  },
  // The report (BRIEFING.md "The report card", 2026-11-04): what the night did, as the Briefing's
  // first tile and the open day's first message. Before the songs, because reading songs' tags
  // taints the session and a tainted session's words may not reach the owner; what step 11 then
  // does joins the report's counts when the run is done, never as words.
  {
    step: 12,
    name: 'the report',
    budget_min: 1,
    idempotent: 'the same report again answers the stored one; a new one from the same session replaces it',
    cursor: false,
    phase: 'P4',
  },
  // What the mind knows of each song (RUNTIME.md §12.1, MUSIC.md §10.5): the next untagged songs'
  // notes, at most MUSIC_NOTE_LIMITS.night_songs a night, then a mix or two and Sunday's line. Its
  // number is the next free one; it runs last before the session note, after every step that
  // writes memory, since reading songs' tags taints the session like any outside text (the next
  // night's fired wake starts clean once this session has ended, RUNTIME.md §4.3).
  {
    step: 11,
    name: 'songs (notes, mixes)',
    budget_min: 6,
    idempotent: 'a note is put by its track, the same note again writes nothing, and the next page is always the next songs without one',
    cursor: false,
    phase: 'P5',
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
/** The steps run in the list's order, not their numbers' (12 and 11 run between 9 and 10). */
export const NIGHT_ORDER: readonly number[] = NIGHT_STEPS.map((s) => s.step);
/** `resume_from` once the run is done: past every step's number. */
export const NIGHT_END = Math.max(...NIGHT_ORDER) + 1;
/** A step's place in the run; past the end for NIGHT_END (or any number not a step). */
export const nightPos = (step: number): number => {
  const i = NIGHT_ORDER.indexOf(step);
  return i < 0 ? NIGHT_ORDER.length : i;
};
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
