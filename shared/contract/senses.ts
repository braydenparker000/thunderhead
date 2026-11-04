// What the owner does, as events (API.md §11.14, DATA.md §6.1, MUSIC.md §10.1): the phone's sealed
// batches, the one list of what each app may send (SENSE_TYPES), and the agents' fixed questions
// about them. Never SQL from outside.
import type { Id, Ms } from './api';
import { PROPOSAL_CLASS_NAMES } from './proposals.ts';
import type { Ref, RefKind } from './refs';

export const SENSE_LIMITS = {
  batch_events: 500,
  batch_bytes: 256 * 1024,
  data_bytes: 2_048,
  /** An event's time: at most this far back, and this far ahead of the Worker's clock. */
  past_ms: 30 * 24 * 60 * 60 * 1000,
  future_ms: 5 * 60 * 1000,
  /** Events stay in SQLite this many days; the daily archive in the private bucket keeps them all. */
  hot_days: 90,
  /** Batch records (the dedupe) are kept this long. */
  batch_days: 30,
} as const;

/** `music.skip`, `home.open.v2`: an app, then one or more parts, optionally a version. */
export const SENSE_TYPE = /^[a-z]+(\.[a-z_]+)+(\.v\d+)?$/;

/** The kinds of value an event's `data` may hold: ids, numbers and times, never words. `id` is a key
 * or an id (`[A-Za-z0-9._:/-]`, ≤ 160), `ref` a ref of the shared grammar, `ids` up to 50 ids, `ms`
 * a duration or a position in ms (0 to 7 days), `int` a whole number ≥ 0, `num` a finite number,
 * `bool` true or false; an array of strings is the words it may be (an enum, never free text). Any
 * field may be left out or null. */
export type SenseField = 'id' | 'ref' | 'ids' | 'ms' | 'int' | 'num' | 'bool' | readonly string[];

/** Whose privacy switch an event falls under: `privacy.senses.<app>` (shared/contract/settings.ts).
 * Astra and My Media share `media`; the ring, the island, app opens and settings are `shell`; what
 * the mind says on home (lines, cards, chips, the Briefing's tiles) is `home`. */
export const SENSE_APPS = ['music', 'podcasts', 'guitar', 'study', 'media', 'shell', 'home'] as const;
export type SenseApp = (typeof SENSE_APPS)[number];

export interface SenseTypeSpec {
  /** The app whose switch holds it (`privacy.senses.<app>`). */
  readonly app: SenseApp;
  /** The kinds of ref it may carry (one of these); empty: none. A ref is never required. */
  readonly ref: readonly RefKind[];
  /** The only fields its `data` may have. */
  readonly data: Readonly<Record<string, SenseField>>;
  /** 1: its ref and data never reach an agent's answer (type and time only). The Worker stores the
   * higher of this and what the phone sent. */
  readonly sensitivity: 0 | 1;
  /** When the phone sends it. */
  readonly doc: string;
}

const t = (
  app: SenseApp,
  ref: readonly RefKind[],
  data: Record<string, SenseField>,
  doc: string,
  sensitivity: 0 | 1 = 0,
): SenseTypeSpec => ({ app, ref, data, sensitivity, doc });

/**
 * Every event type an app may send (API.md §11.14, CONTRACT.md "Senses"), with its fields. The
 * Worker refuses any other type (`bad_type`), any other field or a value of the wrong kind
 * (`bad_data`), a ref of another kind (`bad_ref`), and every event of an app whose switch is off
 * (`switched_off`); the phone sends none of those (th/senses/send.js). Titles, names and what the
 * owner typed never travel: the mind resolves an id when it needs to.
 */
export const SENSE_TYPES = {
  // Music (MUSIC.md §10.1; th/music/dj.js, th/music/ratings.js); `player.open` is its page opening.
  'player.open': t('music', [], {}, "Music's page opens."),
  'music.play': t(
    'music',
    ['music'],
    { context_ref: 'ref', source: ['list', 'search', 'mix', 'dj', 'shuffle', 'queue', 'verb'], offline: 'bool' },
    'A song starts sounding.',
  ),
  'music.skip': t(
    'music',
    ['music'],
    { at_ms: 'ms', duration_ms: 'ms', by: ['next', 'previous', 'pick', 'notification', 'swipe'], next_ref: 'ref' },
    'A song that sounded is left before its last 3 s.',
  ),
  'music.finish': t('music', ['music'], { listened_ms: 'ms' }, 'A song plays to its end.'),
  // `from` is whatever the library held before, so any number (the new rating is checked whole).
  'music.rate': t('music', ['music'], { rating: 'int', from: 'num' }, 'A rating set in Music (0–5; from: the one before).'),
  // Podcasts (th/podcasts/progress.js): `podcast:<show id>/<episode id>`, or `podcast:<show id>` for a
  // show; the show's id is the 16-hex hash of its feed address, as the Worker's follows name it.
  'podcasts.open': t('podcasts', [], {}, "Podcasts' page opens."),
  'podcast.play': t('podcasts', ['podcast'], { at_ms: 'ms' }, 'An episode starts sounding (at_ms: where in it).'),
  'podcast.finish': t('podcasts', ['podcast'], { listened_ms: 'ms' }, 'An episode plays to its end.'),
  'podcast.skip': t(
    'podcasts',
    ['podcast'],
    { at_ms: 'ms', duration_ms: 'ms' },
    'Another episode starts while this one was not finished.',
  ),
  'podcast.follow': t('podcasts', ['podcast'], {}, 'A show followed.'),
  'podcast.unfollow': t('podcasts', ['podcast'], {}, 'A show unfollowed.'),
  // Guitar (th/guitar/practice.js): `tab:<piece>`, with `#b<from>-<to>` for a section.
  'guitar.open': t('guitar', ['tab'], {}, "Guitar's page opens."),
  'guitar.piece_opened': t('guitar', ['tab'], {}, 'A piece opens in the reader.'),
  'guitar.pass': t(
    'guitar',
    ['tab'],
    { bpm: 'int', speed_pct: 'num', clean: 'bool', by: ['owner', 'ears'] },
    'A loop pass marked Clean or Not yet.',
  ),
  'guitar.bpm': t('guitar', ['tab'], { bpm: 'int' }, 'A new best clean tempo for a section.'),
  'guitar.session': t(
    'guitar',
    ['tab'],
    { seconds: 'int', played_seconds: 'int', sections: 'ids', bpm: 'int' },
    'The reader closes after practice (sections: the section keys marked; bpm: the best clean tempo reached).',
  ),
  // Study (apps/study): `book:<id>`.
  'study.open': t('study', ['book'], {}, "Study's page opens."),
  'study.read': t('study', ['book'], { pages: 'int', ms: 'ms' }, 'Reading in a book, on leaving it or hiding the page.'),
  'study.search': t('study', [], { hits: 'int' }, 'A search shows its results (the count only, never the words).'),
  'study.highlight': t('study', ['book'], {}, 'A highlight made in a book (nothing on the phone makes one yet).', 1),
  // Astra and My Media (th/senses/watch.js, from each app's own progress): `astra:<type>:<id>` (an
  // episode adds `:<season>:<episode>`) or `media:<drive file id>`.
  'astra.open': t('media', [], {}, "Astra's page opens."),
  'mymedia.open': t('media', [], {}, "My Media's page opens."),
  'media.watch': t('media', ['astra', 'media'], { ms: 'ms' }, 'Time watched of a title since the last report.'),
  'media.finish': t('media', ['astra', 'media'], {}, 'A title watched to its end.'),
  'media.drop': t('media', ['astra', 'media'], { at_ms: 'ms' }, 'A title not finished taken off Continue Watching.'),
  // The shell (th/senses/shell.js): `app:<id>`, `setting:<key>`.
  'app.open': t('shell', ['app'], {}, 'Music or Podcasts comes to the front inside home.'),
  'app.close': t('shell', ['app'], { ms: 'ms' }, 'Music or Podcasts goes back into the island (ms: how long it was in front).'),
  'ring.choice': t('shell', ['app'], {}, 'An app picked on the ring.'),
  'island.tap': t('shell', ['app'], { to: ['details', 'app', 'control'] }, 'The island tapped: its details, its app, or a control.'),
  'briefing.open': t('shell', [], {}, 'The Briefing comes into view.'),
  'settings.change': t('shell', ['setting'], {}, 'A setting changed: its key only, never its value.'),
  // Home (th/senses/shell.js, th/decide/card.js, th/briefing/page.js): whether what the mind says lands.
  'briefing.tile': t('home', ['ledger'], {}, "A night tile tapped (its ref: the tile's ledger row)."),
  'line.seen': t('home', ['ledger'], {}, "A home line on screen (its ref: the line's ledger row)."),
  'line.dismiss': t('home', ['ledger'], {}, 'A home line dismissed (nothing on the phone sends it yet).'),
  // An app's arrangement (surfaces.ts ARRANGEMENT_SLOTS), from the app that draws it: on screen, its
  // tap (the owner took it up: kept), its dismissal (ignored). Its ref: the arrangement's ledger row.
  'arrangement.seen': t('home', ['ledger'], {}, "An app's arrangement on screen."),
  'arrangement.tap': t('home', ['ledger'], {}, "An app's arrangement taken up (played, opened, started)."),
  'arrangement.dismiss': t('home', ['ledger'], {}, "An app's arrangement dismissed."),
  'card.decide': t('home', ['proposal'], { class: PROPOSAL_CLASS_NAMES }, 'A decision card answered Yes or No (its class only).', 1),
  'reply.open_chip': t('home', ['app'], {}, "A reply's Open chip tapped (its ref: the app it opens)."),
} as const satisfies Record<string, SenseTypeSpec>;
export type SenseTypeName = keyof typeof SENSE_TYPES;

/** A type's spec, or null for one no app may send. */
export const senseType = (type: string): SenseTypeSpec | null =>
  Object.hasOwn(SENSE_TYPES, type) ? SENSE_TYPES[type as SenseTypeName] : null;

/** The privacy switch of an app's senses (a Worker setting, on by default). */
export const senseSwitch = (app: SenseApp): `privacy.senses.${SenseApp}` => `privacy.senses.${app}`;

export interface SenseEvent {
  id: Id;
  at: Ms;
  type: string;
  ref?: Ref | null;
  data?: Record<string, unknown>;
  sensitivity?: 0 | 1;
}

export type SenseRejectReason =
  | 'bad_type'
  | 'bad_time'
  | 'too_large'
  | 'bad_ref'
  | 'bad_id'
  | 'bad_data'
  | 'switched_off';

/** PUT /v1/senses/batches/:batch_id */
export interface SenseBatchRequest {
  events: SenseEvent[];
}
export interface SenseBatchResponse {
  accepted: number;
  rejected: { i: number; reason: SenseRejectReason }[];
}

/** POST /v1/senses/query: one of these, with its parameters. */
export const SENSE_QUERIES = {
  /** Events a day by type: `{ from: Day, to: Day, type?: string }` → `{ day, type, n, sum_ms }[]`. */
  counts_by_day: 'counts_by_day',
  /** The most frequent refs of a type over the last `days` (≤ 90): `{ type, days, limit? }` → `{ ref, n, sum_ms }[]`. */
  top_refs: 'top_refs',
  /** One day's events in order (≤ 500 a page): `{ day, after_seq?, type_prefix? }` → events. */
  sequence: 'sequence',
  /** The newest event of a type: `{ type }` → one event or none. */
  last_event: 'last_event',
  /** One day's counts by type, never content (the night's `th day`): `{ day }` → `{ type, n, sum_ms }[]`. */
  day_summary: 'day_summary',
  /** When the owner does things, as observed habits (`th day`; ROUTINES): `{ type? | app?, to?: Day }`
   * → `Routine[]`, counts and hours only. */
  routines: 'routines',
  /** A week of Guitar (growth.ts): `{ to: Day }` → one `GuitarWeek`, counts and ids only. */
  guitar_week: 'guitar_week',
  /** A week of Study (growth.ts): `{ to: Day }` → one `StudyWeek`, counts and ids only. */
  study_week: 'study_week',
} as const;
export type SenseQueryName = keyof typeof SENSE_QUERIES;

export interface SenseQueryResponse {
  rows: unknown[];
  rows_read: number;
}

/** One day's events in `th day` (RUNTIME.md §12 step 1): counts by type, never content. */
export interface EventsSummary {
  day: string;
  total: number;
  by_type: { type: string; n: number; sum_ms: number }[];
}

/**
 * The `routines` query's rule (MEMORY.md §4, rule M5): over the `days` logical days that end on `to`,
 * each event of a type falls in a cell, the weekday of its logical day (it turns at 04:00) and the
 * hour of the owner's clock. For a band of 1 to `max_hours` hours, a weekday takes part when its
 * cells in the band hold events in at least `day_weeks` different weeks; the band is a routine when
 * the days taking part hold at least `min_n` events in at least `min_weeks` different weeks. The
 * densest bands that don't overlap are kept, at most `per_type` a type and `rows` in all.
 */
export const ROUTINES = {
  days: 28,
  min_n: 10,
  min_weeks: 3,
  day_weeks: 2,
  max_hours: 3,
  per_type: 3,
  rows: 20,
} as const;

/** Weekdays as a routine names them, Monday first. */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** One routine: from `hour_from`:00 to `hour_to`:00 (exclusive) on these weekdays, `n` events in
 * `weeks` different weeks. `ref` names it as evidence for an `observed` fact of kind `habit` (rule
 * M5): `rollup:routines/<type>/<days>/<from>-<to>/<to day>`, which the Senses object can count again
 * (`routineRef`) while the window's events are kept (90 days). */
export interface Routine {
  type: string;
  weekdays: Weekday[];
  hour_from: number;
  hour_to: number;
  n: number;
  weeks: number;
  ref: string;
}

/** The ref of a routine, the evidence a habit fact cites. */
export const routineRef = (r: Omit<Routine, 'ref'>, to: string): string =>
  `rollup:routines/${r.type}/${r.weekdays.join('.')}/${r.hour_from}-${r.hour_to}/${to}`;

const ROUTINE_REF = /^rollup:routines\/([a-z]+(?:\.[a-z_]+)+(?:\.v\d+)?)\/([a-z.]+)\/(\d{1,2})-(\d{1,2})\/(\d{4}-\d{2}-\d{2})$/;

/** A routine's ref read back, or null for anything else. */
export function parseRoutineRef(
  ref: string,
): { type: string; weekdays: Weekday[]; hour_from: number; hour_to: number; to: string } | null {
  const m = ROUTINE_REF.exec(ref);
  if (!m) return null;
  const weekdays = m[2].split('.') as Weekday[];
  if (!weekdays.every((d) => (WEEKDAYS as readonly string[]).includes(d))) return null;
  const hour_from = Number(m[3]);
  const hour_to = Number(m[4]);
  if (hour_to <= hour_from || hour_to > 24 || hour_to - hour_from > ROUTINES.max_hours) return null;
  return { type: m[1], weekdays, hour_from, hour_to, to: m[5] };
}
