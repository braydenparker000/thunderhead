// The owner's growth in Guitar and Study (MIND-PLAN §9; VISION: success is the owner's growth): the
// senses' two fixed questions about a week (senses.ts `guitar_week`, `study_week`; `th guitar week`,
// `th study week`), and night step 13, the weekly one, which makes of them the Briefing's `practice`
// and `study` tiles, one sentence each from counts, and tomorrow's section and the next passage
// through guitar.set_plan and study.mark_next (`th growth`, PUT /v1/mind/growth/:day). Under
// `min_sessions` that week it says and plans nothing. Law 4 (notice, remind once, let go): the note
// is the one place the mind talks about progress, and it names what grew, never what didn't.

export const GROWTH = {
  /** The week: this many logical days, ending on the night's day. */
  days: 7,
  /** Tempo gained is against the best clean tempo of this many days before the week. */
  before_days: 28,
  /** Guitar sessions, or reading stints that moved a page, a week before anything is said or planned. */
  min_sessions: 3,
  /** A section is clean at full tempo from this speed (percent of the score's tempo). */
  full_pct: 100,
  /** Songs or books an answer lists at most, and sections a song. */
  items: 10,
  sections: 8,
  /** Sections tomorrow's plan names at most (guitar.set_plan takes up to 4). */
  plan_sections: 2,
  /** The next passage: a day's pace this week, at least 1 page and at most this many. */
  passage_max: 30,
} as const;

/** Words the growth note never uses (law 4: no scold, no streak, no comparison downward). */
export const GROWTH_NEVER = [
  'only',
  'just',
  'missed',
  'behind',
  'should',
  'streak',
  "haven't",
  'skipped',
  'fell',
  'slower',
  'less',
  'down',
  'again',
] as const;

/** A section of a song in the week: the ladder's key (bar indexes, as guitar.set_plan takes it) and
 * its printed bars, its best clean tempo this week, the best of the 28 days before, the BPM a new
 * best this week gained over that (0 without one), and whether it was clean at full tempo. */
export interface GuitarSection {
  key: string;
  bars: string;
  best_bpm: number | null;
  before_bpm: number | null;
  gained: number;
  cleared: boolean;
  clean: number;
}

/** A song in the week (`tab:<id>`). `outside`: its id holds a title's words (a GProTab key), so it
 * is outside text: use it as an id only, never quote it. */
export interface GuitarSong {
  ref: string;
  outside: boolean;
  sessions: number;
  minutes: number;
  sections: GuitarSection[];
}

/** `guitar_week` (`{ to }`): the 7 logical days that end on `to`, from `guitar.session`,
 * `guitar.pass` and `guitar.bpm`. */
export interface GuitarWeek {
  from: string;
  to: string;
  sessions: number;
  minutes: number;
  days: number;
  /** Sections clean at full tempo this week, and sections with a new best. */
  cleared: number;
  gained: number;
  songs: GuitarSong[];
}

/** A book in the week (`book:<id>`): stints that moved a page, pages, minutes, days read. */
export interface StudyBook {
  ref: string;
  reads: number;
  pages: number;
  minutes: number;
  days: number;
}

/** `study_week` (`{ to }`): the 7 logical days that end on `to`, from `study.read`; `books`: how many
 * moved. Ids only: a book's title is the owner's library's (`th get /v1/library/books`). */
export interface StudyWeek {
  from: string;
  to: string;
  reads: number;
  pages: number;
  minutes: number;
  days: number;
  books: number;
  items: StudyBook[];
}

/** One book's place for the next passage (the Library object): where the owner left off (the PDF
 * page, null when never opened), its pages, the printed labels of the pages near it, and the
 * highlights made in it since the week began. */
export interface StudyPlace {
  id: string;
  page: number | null;
  pdf_pages: number | null;
  labels: Record<string, string | null>;
  highlights: number;
}

/** What the step did for one app: the week's sessions, the tile's and the plan's ledger rows (null:
 * not placed), and why not: `quiet` (under `min_sessions`), `no_section` (no clean pass to plan from),
 * `no_place` (the book was never opened), `book_end`, or the Worker's code for a refusal
 * (`nudge_repeat`, `speech_budget`, …). A rerun that would change nothing writes nothing. */
export interface GrowthPart {
  sessions: number;
  tile: string | null;
  plan: string | null;
  reason: string | null;
}

/** PUT /v1/mind/growth/:day */
export interface GrowthResponse {
  day: string;
  from: string;
  guitar: GrowthPart;
  study: GrowthPart;
  rows_read: number;
}
