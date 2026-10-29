// The deterministic renders of memory (MEMORY.md §8, §9): the profile, the standing rules, the
// open threads and the day-note lines of the briefing. No model writes them, so the same rows and
// clock give byte-identical text (snapshot-tested). Text is one line per item: a fact can never
// fake a `## <n>.` section marker.
import {
  CONFIDENCE,
  decayed,
  FACT_KINDS,
  FACT_SOURCES,
  type FactKind,
  MEMORY_LIMITS,
} from '../../../../shared/contract/memory.ts';
import type { DayNoteRow, OpenThreadRow } from './notes';
import type { FactRow } from './store';

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
  fact_ids: string[];
}

/** MEMORY.md §8: current non-rule facts, decayed, below 0.25 dropped unless pinned; pinned first,
 * then by kind (state, goal, preference, routine, fact), by confidence and recency; per-kind caps;
 * ≤ 6,000 characters with `(+N more: th recall --kind facts)`. */
export function renderProfile(rows: FactRow[], now: number, tz: string): Profile {
  const live = rows
    .filter((f) => f.kind !== 'rule' && f.superseded_at === null && (f.valid_to === null || f.valid_to > now))
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
  return { text: (text + extra).trim() || 'Nothing known yet.', fact_ids: chosen.slice(0, kept).map(({ f }) => f.id) };
}

/** Section 3: every current rule, pinned first, oldest first (rules never decay). */
export function renderRules(
  rows: FactRow[],
  tz: string,
  budget: number,
  more = (n: number) => `(+${n} more: th brief --section 3)`,
): string {
  const rules = rows
    .filter((f) => f.kind === 'rule' && f.superseded_at === null)
    .sort((a, b) => b.pinned - a.pinned || a.recorded_at - b.recorded_at || (a.id < b.id ? -1 : 1));
  if (!rules.length) return 'No standing rules yet.';
  return within(
    rules.map((f) => factLine(f, f.confidence, tz, false)),
    budget,
    more,
  ).text;
}

/** Section 4: mind-owned first, then the owner's; due soonest first, then the oldest. Full ids,
 * because `th thread done <id>` needs them. */
export function renderThreads(
  rows: OpenThreadRow[],
  tz: string,
  budget: number,
  more = (n: number) => `(+${n} more: th brief --section 4)`,
): string {
  const open = rows
    .filter((t) => t.status === 'open')
    .sort(
      (a, b) =>
        (a.owner === 'mind' ? 0 : 1) - (b.owner === 'mind' ? 0 : 1) ||
        (a.due_at ?? Number.MAX_SAFE_INTEGER) - (b.due_at ?? Number.MAX_SAFE_INTEGER) ||
        a.opened_at - b.opened_at,
    );
  if (!open.length) return 'No open threads.';
  return within(
    open.map(
      (t) =>
        `[${t.id}] ${one(t.text)} (${t.owner}${t.due_at ? `, due ${date(t.due_at, tz)}` : ''}, since ${date(t.opened_at, tz)})`,
    ),
    budget,
    more,
  ).text;
}

/** Section 6 when the night shift wrote yesterday's note. */
export function renderDayNote(
  n: DayNoteRow,
  budget: number,
  more = (k: number) => `(+${k} more: th brief --section 6)`,
): string {
  let decisions: string[] = [];
  try {
    const v = JSON.parse(n.decisions_json ?? '[]');
    if (Array.isArray(v)) decisions = v.filter((d): d is string => typeof d === 'string');
  } catch {
    // unreadable decisions show as none
  }
  const lines = [`Day note ${n.day} (importance ${n.importance}, v${n.version}): ${one(n.summary)}`];
  for (const d of decisions) lines.push(`- decided: ${one(d)}`);
  return within(lines, budget, more).text;
}

/** Section 9: one line per day note, newest first. */
export function renderDays(rows: DayNoteRow[], budget: number): string {
  if (!rows.length) return 'No day notes yet.';
  return within(
    rows.map((n) => {
      const s = one(n.summary);
      return `${n.day} (${n.importance}): ${s.length > 160 ? `${s.slice(0, 159)}…` : s}`;
    }),
    budget,
    (k) => `(+${k} more: th get /v1/memory/day-notes)`,
  ).text;
}
