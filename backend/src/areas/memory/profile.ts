// The deterministic renders of memory (MEMORY.md §8, §9): the profile, the standing rules, the
// open threads and the day-note lines of the briefing. No model writes them, so the same rows and
// clock give byte-identical text (snapshot-tested). Text is one line per item: a fact can never
// fake a `## <n>.` section marker. Provenance (MEMORY.md §6 M11): an `outside` fact is in no render
// (M11a; rules can't be outside, M11c); an `outside` loose end or day note is shown, marked
// `(outside)` right after its id or day, and loose ends list it after the rest. To a session that
// read no outside text (`keep`) it is kept back: its id, label and kind, never its words (M11f).
import {
  CONFIDENCE,
  decayed,
  FACT_KINDS,
  FACT_SOURCES,
  type FactKind,
  MEMORY_LIMITS,
  type Provenance,
} from '../../../../shared/contract/memory.ts';
import { KEPT_BACK } from './kept';
import { type DayNoteRow, notedBy, type OpenThreadRow } from './notes';
import { type FactRow, provenanceOf } from './store';

/** The profile's kind order; a kind this build does not know comes last. */
const ORDER: string[] = Object.keys(FACT_KINDS).filter((k) => k !== 'rule');
const rank = (kind: string) => {
  const i = ORDER.indexOf(kind);
  return i < 0 ? ORDER.length : i;
};
/** One formatter per zone and shape, made once: building an Intl.DateTimeFormat per line cost
 * the briefing tens of milliseconds of CPU (review of P3 stage A). */
const FORMATS = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string, withDay: boolean): Intl.DateTimeFormat {
  const key = `${withDay ? 'd' : 'm'}|${tz}`;
  let f = FORMATS.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      ...(withDay ? { day: '2-digit' } : {}),
    });
    FORMATS.set(key, f);
  }
  return f;
}
const month = (at: number, tz: string) => formatter(tz, false).format(at);
const date = (at: number, tz: string) => formatter(tz, true).format(at);
const one = (t: string) => t.replace(/\s+/g, ' ').trim();

/** The short id the renders show: the id's last 8 hex digits (its random part; a UUIDv7's first
 * 8 digits are its timestamp, the same for every fact of one batch). */
export const shortId = (id: string) => id.replace(/-/g, '').slice(-8);

export function factLine(f: FactRow, c: number, tz: string, withConfidence = true): string {
  const letter = Object.hasOwn(FACT_SOURCES, f.source) ? FACT_SOURCES[f.source].letter : '?';
  const since = month(f.valid_from ?? f.recorded_at, tz);
  const facts = withConfidence ? `${c.toFixed(1)}, ${letter}, since ${since}` : `since ${since}`;
  return `[f:${shortId(f.id)}] ${one(f.text)} (${facts})${f.may_raise === 1 ? '' : " · don't raise"}${f.sensitivity === 1 ? ' · private' : ''}`;
}

/** Fits lines under `max` characters, keeping the first ones, with the cut marker. */
function within(lines: string[], max: number, more: (n: number) => string): { text: string; kept: number } {
  const out: string[] = [];
  let used = 0;
  for (const l of lines) {
    if (used + l.length + 1 > max - 48) break;
    out.push(l);
    used += l.length + 1;
  }
  const cut = lines.length - out.length;
  return { text: cut ? `${out.join('\n')}\n${more(cut)}`.trim() : out.join('\n'), kept: out.length };
}

export interface Profile {
  text: string;
  /** The fact of each line, in line order (the cut marker has none). */
  fact_ids: string[];
  /** The lines that are private (sensitivity 1), so a screen blurs them by id, not by wording. */
  private_ids: string[];
}

/** MEMORY.md §8: current non-rule facts, decayed, below 0.25 dropped unless pinned; pinned first,
 * then by kind (state, goal, preference, routine, fact), by confidence and recency; per-kind caps;
 * ≤ 6,000 characters with `(+N more: th recall --kind facts)`. M11a: no `outside` fact, pinned or
 * not, until the owner keeps it. */
export function renderProfile(rows: FactRow[], now: number, tz: string): Profile {
  const live = rows
    .filter((f) => f.kind !== 'rule' && f.superseded_at === null && (f.valid_to === null || f.valid_to > now))
    .filter((f) => provenanceOf(f) !== 'outside')
    .map((f) => ({ f, c: decayed(f, now) }))
    .filter(({ f, c }) => f.pinned === 1 || c >= CONFIDENCE.profile)
    .sort(
      (a, b) =>
        b.f.pinned - a.f.pinned ||
        rank(a.f.kind) - rank(b.f.kind) ||
        b.c - a.c ||
        b.f.recorded_at - a.f.recorded_at ||
        (a.f.id < b.f.id ? -1 : a.f.id > b.f.id ? 1 : 0),
    );
  const per = new Map<string, number>();
  const chosen = live.filter(({ f }) => {
    if (f.pinned === 1) return true;
    const known = Object.hasOwn(FACT_KINDS, f.kind) ? FACT_KINDS[f.kind as FactKind].cap : 10;
    const n = per.get(f.kind) ?? 0;
    per.set(f.kind, n + 1);
    return n < (known ?? 0);
  });
  const lines = chosen.map(({ f, c }) => factLine(f, c, tz));
  const dropped = live.length - chosen.length;
  const { text, kept } = within(
    lines,
    MEMORY_LIMITS.profile_chars,
    (n) => `(+${n + dropped} more: th recall --kind facts)`,
  );
  const extra = kept === lines.length && dropped ? `\n(+${dropped} more: th recall --kind facts)` : '';
  const shown = chosen.slice(0, kept).map(({ f }) => f);
  return {
    text: (text + extra).trim() || 'Nothing known yet.',
    fact_ids: shown.map((f) => f.id),
    private_ids: shown.filter((f) => f.sensitivity === 1).map((f) => f.id),
  };
}

/** Section 3: every current rule, pinned first, oldest first (rules never decay). None is
 * `outside` (M11c refuses one); a row that somehow were would be left out like the profile's. */
export function renderRules(
  rows: FactRow[],
  tz: string,
  budget: number,
  more = (n: number) => `(+${n} more: th brief --section 3)`,
): string {
  const rules = rows
    .filter((f) => f.kind === 'rule' && f.superseded_at === null && provenanceOf(f) !== 'outside')
    .sort((a, b) => b.pinned - a.pinned || a.recorded_at - b.recorded_at || (a.id < b.id ? -1 : 1));
  if (!rules.length) return 'No standing rules yet.';
  return within(
    rules.map((f) => factLine(f, f.confidence, tz, false)),
    budget,
    more,
  ).text;
}

/** What marks a loose end or a day note that a session which read outside text wrote. */
export const OUTSIDE_MARK = ' (outside)';
/** The same, with its words kept back from a session that read no outside text (M11f). */
export const KEPT_MARK = ` ${KEPT_BACK}`;
const mark = (r: { provenance?: Provenance | null }) => (notedBy(r) === 'outside' ? OUTSIDE_MARK : '');
const kept = (r: { provenance?: Provenance | null }, keep: boolean) => keep && notedBy(r) === 'outside';
/** Where a session reads what was kept back (and is labelled outside from then on). */
const READ_IT = (path: string) =>
  `${KEPT_BACK.slice(1, -1)}: th get ${path} outside=1 reads it; you write outside after`;

/** Section 4: mind-owned first, then the owner's; due soonest first, then the oldest; the
 * `outside` ones after all the rest, marked. Full ids, because `th thread done <id>` needs them. */
export function renderThreads(
  rows: OpenThreadRow[],
  tz: string,
  budget: number,
  more = (n: number) => `(+${n} more: th brief --section 4)`,
  keep = false,
): string {
  const open = rows
    .filter((t) => t.status === 'open')
    .sort(
      (a, b) =>
        (notedBy(a) === 'outside' ? 1 : 0) - (notedBy(b) === 'outside' ? 1 : 0) ||
        (a.owner === 'mind' ? 0 : 1) - (b.owner === 'mind' ? 0 : 1) ||
        (a.due_at ?? Number.MAX_SAFE_INTEGER) - (b.due_at ?? Number.MAX_SAFE_INTEGER) ||
        a.opened_at - b.opened_at,
    );
  if (!open.length) return 'No open threads.';
  const lines = open.map(
    (t) =>
      `[${t.id}]${kept(t, keep) ? `${KEPT_MARK} a loose end` : `${mark(t)} ${one(t.text)}`} (${t.owner}${t.due_at ? `, due ${date(t.due_at, tz)}` : ''}, since ${date(t.opened_at, tz)})`,
  );
  if (open.some((t) => kept(t, keep))) lines.push(READ_IT('/v1/memory/open-threads'));
  return within(lines, budget, more).text;
}

/** Section 6 when the night shift wrote yesterday's note. */
export function renderDayNote(
  n: DayNoteRow,
  budget: number,
  more = (k: number) => `(+${k} more: th brief --section 6)`,
  keep = false,
): string {
  if (kept(n, keep))
    return `Day note ${n.day}${KEPT_MARK} (importance ${n.importance}, v${n.version})\n${READ_IT(`/v1/memory/day-notes from=${n.day} to=${n.day}`)}`;
  let decisions: string[] = [];
  try {
    const v = JSON.parse(n.decisions_json ?? '[]');
    if (Array.isArray(v)) decisions = v.filter((d): d is string => typeof d === 'string');
  } catch {
    // unreadable decisions show as none
  }
  const lines = [`Day note ${n.day}${mark(n)} (importance ${n.importance}, v${n.version}): ${one(n.summary)}`];
  for (const d of decisions) lines.push(`- decided: ${one(d)}`);
  return within(lines, budget, more).text;
}

/** Section 9: one line per day note, newest first. */
export function renderDays(rows: DayNoteRow[], budget: number, keep = false): string {
  if (!rows.length) return 'No day notes yet.';
  return within(
    rows.map((n) => {
      if (kept(n, keep)) return `${n.day}${KEPT_MARK} (${n.importance})`;
      const s = one(n.summary);
      return `${n.day}${mark(n)} (${n.importance}): ${s.length > 160 ? `${s.slice(0, 159)}…` : s}`;
    }),
    budget,
    (k) => `(+${k} more: th get /v1/memory/day-notes)`,
  ).text;
}
