// The briefing (MEMORY.md §9): built and truncated by the Worker, never by the model, in three
// layers. Every section starts with a `## <n>. <Name>` line (mind Finding 3), so the hook and `th
// brief --section` cut between whole sections.
// - The first 2,000 characters, sections 1–2 (brief-layer.ts): now, the voice and today's state;
//   the owner in their own words, their loose ends and the verb classes' positions. Nothing outside.
// - Then the day, the rest of the core: 3 waiting, 4 standing rules, 5 today so far, 6 yesterday,
//   7 the day (brief-day.ts: what was arranged and how it was met, predictions, the Briefing).
// - Then on demand: 8 says where everything else is (the full file's 9–15, recall, the skills).
// The core (1–8) stays ≤ 9,500 characters: 1, 2, 3, 4 and 8 always appear (3 cut oldest-first),
// then 6, 7 and 5 get what is left, in that order. The full briefing (1–15) stays ≤ 48,000 and
// carries fuller versions of 3–7, so a cut in the core always has more behind `th brief --section
// <n>`; each section has its own budget.
import type { LedgerEntry, Message, MindRole } from '../../../../shared/contract/api';
import type { DayNoteRow, OpenThreadRow } from '../memory/notes';
import { renderDayNote, renderDays, renderRules, renderThreads } from '../memory/profile';
import type { FactRow } from '../memory/store';
import { daySection, onDemandSection } from './brief-day';
import { LAYER_MAX, NO_MEMORY, nowSection, ownerSection, watchdogLine } from './brief-layer';
import { budgeted, clock, line } from './brief-text';
import { verbTable } from './brief-verbs';

export { NO_MEMORY, OUTSIDE_LINE, VOICE } from './brief-layer';
export { clock } from './brief-text';

export const CORE_MAX = 9_500;
export const FULL_MAX = 48_000;

export interface BriefInput {
  role: MindRole;
  /** The constitution's SHA-256 the session sent (`none` if its file was missing). */
  constitution: string;
  /** The laws line: the session's file against the owner's pin (areas/proposals/laws.ts). */
  laws: string;
  /** Decision cards waiting for the owner, oldest first. */
  decisions: { id: string; class: string; question: string; expires_at: number; show_from: number }[];
  /** The session read outside text, or its claim took over a taint (MEMORY.md §7): what it writes
   * is labelled `outside`, and section 1 says so, before anything else is read. Otherwise its
   * `outside` loose ends and day notes are kept back (MEMORY.md §6 M11f). */
  tainted: boolean;
  now: number;
  tz: string;
  day: string;
  wakeReason: string | null;
  wakesToday: number;
  prewarmsLeft: number;
  backoffUntil: number;
  /** When the owner's "go quiet" ends (0: off). */
  quietUntil: number;
  threadId: string | null;
  waiting: Message[];
  /** The conversations off the record among `waiting` (conversation/held.ts): marked, with a note. */
  offRecord?: string[];
  todayTail: Message[];
  todayEarlier: Message[];
  note: { body: string; created_at: number } | null;
  /** `count`: all of the day's messages (the night role's section 3), not only the tail's. */
  yesterday: { threadId: string | null; tail: Message[]; note: DayNoteRow | null; count?: number };
  ledger: LedgerEntry[];
  errorsOpen: number;
  /** The tripped watchdogs (OPERATIONS.md §8.2): one briefing line while any is. */
  watchdogs: { name: string; since: number; handled: string | null }[];
  /** The day's database use, only from 60% of a Free-plan daily limit (areas/meter/quota.ts). */
  quota?: string | null;
  rules: FactRow[];
  threads: OpenThreadRow[];
  /** The current facts, for section 2's lines in the owner's own words (profile.ts renderOwner). */
  facts?: FactRow[];
  /** The rendered profile (MEMORY.md §8, ≤ 6,000 characters). */
  profile: string;
  days: DayNoteRow[];
  /** One line about the night shift's run (P3 stage C), or null. */
  night: string | null;
  /** Section 13: `key: value` for each setting the mind reads (settings/catalog.ts mindSettingLines). */
  settings?: string[];
  /** The name the owner gave the mind (`mind.name`; empty: none), and their day's hours
   * (`mind.day_start`, `mind.night_start`) that section 1's "now" counts day or evening by. */
  name?: string;
  hours?: { day: string; night: string };
  /** Today's state for section 1 (brief-gather.ts): the weather; the owner's own calendar (today's
   * events still on, tomorrow's first, a failing link); what is due (reminders, scheduled verbs);
   * the song playing. A shared calendar's events (`outside`) are section 7's `calendarShared`. */
  weather?: string | null;
  calendar?: string[];
  due?: string[];
  playing?: string | null;
  /** The owner's taste from their listening history, one line of counts (areas/music/history-job.ts). */
  taste?: string | null;
  /** Section 1's day pulse (watches/brief.ts): the wake budget's line, then why a watch woke it. */
  pulse?: string[];
  /** Section 7, the day (brief-gather.ts): its arrangements, each with how the owner met it so far;
   * the open predictions about it; the Briefing's tiles; a shared calendar's lines. */
  arranged?: string[];
  predicted?: string[];
  tiles?: string[];
  calendarShared?: string[];
  /** Section 1's speech line, and section 7's What lands (brief-learn.ts): the table, what to say once, the odds. */
  speech?: string;
  lands?: string[];
}

/** The role-side note over section 3 when any waiting message is off the record: the Worker refuses
 * every memory write citing it anyway; this keeps the session from trying or writing it elsewhere. */
export const OFF_RECORD_NOTE = (ids: string[]) =>
  `Off the record (thread ${ids.join(', ')}): answer with --reply-to, so the answer stays in it. Remember nothing from it: no fact, rule, loose end, title or session note; this session now writes no memory at all (the Worker refuses: off_record).`;

/** The full briefing's budgets for sections 3–7: `th brief --section <n>` reads the full file, so
 * whatever the core cut is there (MEMORY.md §9), and its own cuts point past the briefing. */
const FULL_BUDGET: Record<number, number> = { 3: 7_000, 4: 4_500, 5: 4_000, 6: 2_500, 7: 2_200 };
/** The core's budgets for the sections that fill what is left (6, 7, then 5). */
const CORE_FILL: [number, number][] = [
  [6, 800],
  [7, 1_400],
  [5, 2_200],
];

const NAMES: Record<number, string> = {
  1: 'Now',
  2: 'The owner',
  3: 'Waiting',
  4: 'Standing rules',
  5: 'Today so far',
  6: 'Yesterday',
  7: 'The day',
  8: 'On demand',
  9: 'Profile',
  10: 'Open threads',
  11: 'Last 7 days',
  12: 'Pending',
  13: 'Your settings',
  14: 'Health',
  15: 'Today earlier',
};
const render = (n: number, body: string) => `## ${n}. ${NAMES[n]}\n${body}`;
/** What a section costs in the core beyond its body: its heading and the blank line before it. */
const frame = (n: number) => render(n, '').length + 2;

/** Section 13: what the owner chose in Settings for the mind, one `key: value` line each. The
 * standing permissions' lines say what each position asks of the mind (areas/mind/permit.ts). */
export const SETTINGS_LEGEND =
  "The owner's choices in Settings (The mind, Briefing); (default) where never changed. Standing permissions (mind.permit.*), enforced by the Worker: tell = do it and say so in your reply; quiet = do it, mention it only if asked; ask = a decision card first (the 403 proposal_required names it: th propose it, then the same call with --proposal <id>). Money, deleting the owner's data, keys and access, and reaching another person always ask.";
const settingsSection = (lines: string[]) =>
  budgeted([SETTINGS_LEGEND, ...lines], 3_000, 'oldest', (k) => `(+${k} more: th get /v1/settings)`);

/** Sections 3–7 (`deep`: the full file's version, whose cuts point past the briefing). */
function middle(i: BriefInput) {
  const night = i.role === 'night';
  const reflex = i.role === 'reflex';
  const offRecord = i.offRecord ?? [];
  const waiting = [
    ...(offRecord.length ? [OFF_RECORD_NOTE(offRecord)] : []),
    ...i.waiting.map((m) => line(m, i.tz, true, offRecord)),
  ];
  const tail = [
    reflex
      ? `Session notes: ${NO_MEMORY}`
      : i.note
        ? `Latest session note (${clock(i.note.created_at, i.tz)}): ${i.note.body}`
        : 'No session note yet today.',
    ...i.todayTail.map((m) => line(m, i.tz)),
  ];
  const yesterday = i.yesterday.tail.map((m) => line(m, i.tz, false));
  /** Where the rest of a section is: in the core, its full version; in the full file, beyond. */
  const deeper: Record<number, (k: number) => string> = {
    3: (k) => `(+${k} more waiting: th history ${i.threadId ?? 'today'})`,
    4: (k) => `(+${k} more: th get /v1/memory/facts kind=rule)`,
    5: (k) => `(+${k} more: th history today)`,
    6: (k) =>
      i.yesterday.note
        ? `(+${k} more: th get /v1/memory/day-notes)`
        : `(+${k} more: th history ${i.yesterday.threadId})`,
  };
  return (n: number, b: number, deep: boolean): string => {
    const more = deep ? deeper[n] : (k: number) => `(+${k} more${n === 3 ? ' waiting' : ''}: th brief --section ${n})`;
    if (n === 3) {
      if (night)
        return `Yesterday's thread: ${i.yesterday.threadId ?? 'none'}, ${i.yesterday.count ?? i.yesterday.tail.length} messages; run th day ${i.day}`;
      return waiting.length ? budgeted(waiting, b, 'oldest', more) : 'Nothing is waiting.';
    }
    if (n === 4) return reflex ? NO_MEMORY : renderRules(i.rules, i.tz, b, more);
    if (n === 5) return night ? 'See section 3.' : budgeted(tail, b, 'newest', more);
    if (n === 7) return daySection(i, b);
    if (i.yesterday.note) return renderDayNote(i.yesterday.note, b, more, !i.tainted);
    return yesterday.length ? budgeted(yesterday, b, 'newest', more) : 'No messages yesterday.';
  };
}

/** The core: the first layer whole, then 3, 4 and 8, then 6, 7 and 5 in what is left; with the
 * bodies, which the full file shares for 1, 2 and 8. */
function buildCore(i: BriefInput, make: ReturnType<typeof middle>): { core: string; body: Record<number, string> } {
  const body: Record<number, string> = { 1: nowSection(i) };
  body[2] = ownerSection(i, LAYER_MAX - render(1, body[1]).length - frame(2) - 2);
  body[3] = make(3, 2_800, false).slice(0, 2_800);
  body[4] = make(4, 1_400, false);
  body[8] = onDemandSection(i);
  let left =
    CORE_MAX -
    40 -
    [1, 2, 3, 4, 8].reduce((n, s) => n + body[s].length + frame(s), 0) -
    CORE_FILL.reduce((n, [s]) => n + frame(s), 0);
  for (const [n, budget] of CORE_FILL) {
    const b = Math.max(0, Math.min(budget, left));
    body[n] = b >= 80 ? make(n, b, false) : `(no room in the core: th brief --section ${n})`;
    left -= body[n].length;
  }
  const core = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => render(n, body[n])).join('\n\n');
  // A safety net only: the budgets above keep the core under the cap.
  const cut = core.length > CORE_MAX;
  return {
    core: cut ? `${core.slice(0, core.lastIndexOf('\n', CORE_MAX - 40))}\n(+cut: th brief --full)` : core,
    body,
  };
}

/** Sections 9–15, the full file's own: the profile, every loose end, the last week, what is
 * pending, the owner's settings with every verb, health, and today's earlier messages. */
function fullOnly(i: BriefInput): [number, string][] {
  const reflex = i.role === 'reflex';
  // A card's question can quote a fact, and reflex reads no memory: it sees that cards wait, not what they ask.
  const pending = [
    ...i.decisions.map(
      (d) =>
        `decision ${d.id} waiting (${d.class})${reflex ? '' : `: ${d.question}`}${d.show_from > i.now ? ` · held until ${clock(d.show_from, i.tz)}` : ''}`,
    ),
    ...i.ledger.map((l) => `${clock(l.at, i.tz)} ${l.actor} ${l.kind}: ${l.what}`),
  ];
  const threads = reflex
    ? NO_MEMORY
    : renderThreads(i.threads, i.tz, 3_000, (k) => `(+${k} more: th thread list)`, !i.tainted);
  const health = [
    `errors open ${i.errorsOpen}`,
    i.watchdogs.length ? watchdogLine(i.watchdogs, i.tz) : 'watchdogs: none tripped',
    i.night ?? 'night shift: not connected yet',
  ].join(' · ');
  const earlier = i.todayEarlier.map((m) => line(m, i.tz, false));
  return [
    [9, reflex ? NO_MEMORY : i.profile.slice(0, 6_000)],
    [10, threads],
    [11, reflex ? NO_MEMORY : renderDays(i.days, 1_400, !i.tainted)],
    [
      12,
      pending.length
        ? budgeted(pending, 2_000, 'newest', (k) => `(+${k} more: th ledger)`)
        : 'Nothing in the last 24 h.',
    ],
    [13, `${settingsSection(i.settings ?? [])}\n${verbTable(i.settings ?? [])}`],
    [14, health.slice(0, 1_200)],
    [15, budgeted(earlier, 6_000, 'newest', (k) => `(+${k} more: th history today)`) || 'Nothing earlier.'],
  ];
}

export function buildBrief(i: BriefInput): { core: string; full: string } {
  const make = middle(i);
  const { core, body } = buildCore(i, make);
  // The first layer and the pointers are the same in both; 3–7 are their fuller versions.
  const sections: [number, string][] = [
    [1, body[1]],
    [2, body[2]],
    ...[3, 4, 5, 6, 7].map((n): [number, string] => [n, make(n, FULL_BUDGET[n], true)]),
    [8, body[8]],
    ...fullOnly(i),
  ];
  const full = sections
    .map(([n, b]) => render(n, b))
    .join('\n\n')
    .slice(0, FULL_MAX);
  return { core, full };
}
