// The briefing (MEMORY.md §9): built and truncated by the Worker, never by the model. Every
// section starts with a `## <n>. <Name>` line (mind Finding 3), so the hook and `th brief
// --section` cut between whole sections. The core (1–7) stays ≤ 9,500 characters: sections 1, 2,
// 3 and 7 always appear (2 cut oldest-first), then 4, 6 and 5 get what is left, in that order.
// The full briefing (1–12) stays ≤ 48,000 and carries fuller versions of 2–6, so a cut in the
// core always has more behind `th brief --section <n>`; each section has its own budget.
import type { LedgerEntry, Message, MindRole } from '../../../../shared/contract/api';
import type { DayNoteRow, OpenThreadRow } from '../memory/notes';
import { renderDayNote, renderDays, renderRules, renderThreads } from '../memory/profile';
import type { FactRow } from '../memory/store';

export const CORE_MAX = 9_500;
export const FULL_MAX = 48_000;
/** Reflex handles breakage and reads no memory (RUNTIME.md §7.1): its briefing says so in place. */
export const NO_MEMORY = 'Not in the reflex briefing (reflex reads no memory).';

export interface BriefInput {
  role: MindRole;
  /** The constitution's SHA-256 the session sent (`none` if its file was missing). */
  constitution: string;
  /** The laws line: the session's file against the owner's pin (areas/proposals/laws.ts). */
  laws: string;
  /** Decision cards waiting for the owner, oldest first. */
  decisions: { id: string; class: string; question: string; expires_at: number; show_from: number }[];
  /** The session is tainted (MEMORY.md §7): section 1 says so, before anything else is read. */
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
  todayTail: Message[];
  todayEarlier: Message[];
  note: { body: string; created_at: number } | null;
  /** `count`: all of the day's messages (the night role's section 2), not only the tail's. */
  yesterday: { threadId: string | null; tail: Message[]; note: DayNoteRow | null; count?: number };
  ledger: LedgerEntry[];
  errorsOpen: number;
  /** The tripped watchdogs (OPERATIONS.md §8.2): one briefing line while any is. */
  watchdogs: { name: string; since: number; handled: string | null }[];
  rules: FactRow[];
  threads: OpenThreadRow[];
  /** The rendered profile (MEMORY.md §8, ≤ 6,000 characters). */
  profile: string;
  days: DayNoteRow[];
  /** One line about the night shift's run (P3 stage C), or null. */
  night: string | null;
}

/** Formatters made once per zone (one per line cost the briefing tens of ms of CPU). */
const FORMATS = new Map<string, Intl.DateTimeFormat>();
function format(tz: string, kind: 'clock' | 'weekday'): Intl.DateTimeFormat {
  let f = FORMATS.get(`${kind}|${tz}`);
  if (!f) {
    const o: Intl.DateTimeFormatOptions =
      kind === 'clock' ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'long' };
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...o });
    FORMATS.set(`${kind}|${tz}`, f);
  }
  return f;
}
const clock = (at: number, tz: string) => format(tz, 'clock').format(at);
const weekday = (at: number, tz: string) => format(tz, 'weekday').format(at);

/** A message's files after its words: ref, type, a memo's length, name (quoted as JSON, so a name
 * can't close the bracket and pass for the mind's own text) and words (cut to 600 characters in
 * full, 120 otherwise; `th file <ref>` prints them whole). */
function files(m: Message, full: boolean): string {
  const cut = full ? 600 : 120;
  return (m.attachments ?? [])
    .map((a) => {
      const words = a.text ? a.text.replace(/\s+/g, ' ') : '';
      const chars = [...words];
      const said = words ? `: ${chars.length > cut ? `${chars.slice(0, cut).join('')}…` : words}` : '';
      return ` [${a.ref} ${a.type}${a.seconds ? ` ${Math.round(a.seconds)} s` : ''} ${JSON.stringify(a.name)}${said}]`;
    })
    .join('');
}

function line(m: Message, tz: string, full = true): string {
  const who = m.author === 'owner' ? 'owner' : m.author;
  const body = full ? m.body : m.body.replace(/\s+/g, ' ').slice(0, 120);
  return `[${m.id}] ${clock(m.created_at, tz)} ${who}${m.kind === 'text' ? '' : ` (${m.kind})`}: ${body}${files(m, full)}`;
}

/** Fits `lines` under `budget` characters, keeping the newest (or oldest) and marking the cut. */
export function budgeted(
  lines: string[],
  budget: number,
  keep: 'newest' | 'oldest',
  more: (n: number) => string,
): string {
  const out: string[] = [];
  let used = 0;
  const ordered = keep === 'newest' ? [...lines].reverse() : lines;
  for (const l of ordered) {
    if (used + l.length + 1 > budget - 60) break;
    out.push(l);
    used += l.length + 1;
  }
  const cut = lines.length - out.length;
  const body = (keep === 'newest' ? out.reverse() : out).join('\n');
  return cut ? `${body}\n${more(cut)}`.trim() : body;
}

/** The full briefing's budgets for sections 2–6: `th brief --section <n>` reads the full file, so
 * whatever the core cut is there (MEMORY.md §9), and its own cuts point past the briefing. */
const FULL_BUDGET: Record<number, number> = { 2: 8_000, 3: 5_000, 4: 3_000, 5: 5_000, 6: 2_500 };

const NAMES: Record<number, string> = {
  1: 'Now',
  2: 'Waiting',
  3: 'Standing rules',
  4: 'Open threads',
  5: 'Today so far',
  6: 'Yesterday',
  7: 'Pointer',
  8: 'Profile',
  9: 'Last 7 days',
  10: 'Pending',
  11: 'Health',
  12: 'Today earlier',
};
const render = (n: number, body: string) => `## ${n}. ${NAMES[n]}\n${body}`;
/** What a section costs in the core beyond its body: its heading and the blank line before it. */
const frame = (n: number) => render(n, '').length + 2;

/** e.g. `watchdogs tripped: errors.spike since 14:05 (reported) · th reflex` */
const watchdogLine = (ws: BriefInput['watchdogs'], tz: string) =>
  `watchdogs tripped: ${ws.map((w) => `${w.name} since ${clock(w.since, tz)}${w.handled ? ` (${w.handled})` : ''}`).join(', ')} · th reflex`;

/** "off", or "until 06:30" ("until Monday 06:30" over a day away): no nudges, cards or home lines show. */
const quietLine = (i: BriefInput) =>
  i.quietUntil <= i.now
    ? 'off'
    : `until ${i.quietUntil - i.now > 24 * 3_600_000 ? `${weekday(i.quietUntil, i.tz)} ` : ''}${clock(i.quietUntil, i.tz)} (the owner said go quiet: no nudges; cards and home lines wait)`;

export function buildBrief(i: BriefInput): { core: string; full: string } {
  const night = i.role === 'night';
  const reflex = i.role === 'reflex';
  const now = [
    `${weekday(i.now, i.tz)} ${clock(i.now, i.tz)} (${i.tz}) · day ${i.day} · role ${i.role}`,
    `wake: ${i.wakeReason ?? 'manual'} · wakes today ${i.wakesToday} · pre-warms left ${i.prewarmsLeft}`,
    i.backoffUntil > i.now ? `usage backoff until ${clock(i.backoffUntil, i.tz)}` : 'no usage backoff',
    `${i.laws} · open decisions ${i.decisions.length} · quiet: ${quietLine(i)}`,
    ...(i.watchdogs.length ? [watchdogLine(i.watchdogs, i.tz)] : []),
    ...(i.tainted
      ? [
          'taint: this session is tainted (it, or one of its role in the last 24 hours, read outside content); memory writes are refused',
        ]
      : []),
  ].join('\n');
  const waiting = i.waiting.map((m) => line(m, i.tz));
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
    2: (k) => `(+${k} more waiting: th history ${i.threadId ?? 'today'})`,
    3: (k) => `(+${k} more: th get /v1/memory/facts kind=rule)`,
    4: (k) => `(+${k} more: th thread list)`,
    5: (k) => `(+${k} more: th history today)`,
    6: (k) =>
      i.yesterday.note
        ? `(+${k} more: th get /v1/memory/day-notes)`
        : `(+${k} more: th history ${i.yesterday.threadId})`,
  };
  /** Section n's body within `b` characters (`deep`: the full file's version). */
  const make = (n: number, b: number, deep: boolean): string => {
    const more = deep ? deeper[n] : (k: number) => `(+${k} more${n === 2 ? ' waiting' : ''}: th brief --section ${n})`;
    if (n === 2) {
      if (night)
        return `Yesterday's thread: ${i.yesterday.threadId ?? 'none'}, ${i.yesterday.count ?? i.yesterday.tail.length} messages; run th day ${i.day}`;
      return waiting.length ? budgeted(waiting, b, 'oldest', more) : 'Nothing is waiting.';
    }
    if (n === 3) return reflex ? NO_MEMORY : renderRules(i.rules, i.tz, b, more);
    if (n === 4) return reflex ? NO_MEMORY : renderThreads(i.threads, i.tz, b, more);
    if (n === 5) return night ? 'See section 2.' : budgeted(tail, b, 'newest', more);
    if (i.yesterday.note) return renderDayNote(i.yesterday.note, b, more);
    return yesterday.length ? budgeted(yesterday, b, 'newest', more) : 'No messages yesterday.';
  };
  const body: Record<number, string> = {
    1: now.slice(0, 500),
    2: make(2, 2_800, false).slice(0, 2_800),
    3: make(3, 1_400, false),
    7: 'Full briefing: $TMPDIR/th/brief.md · Search: th recall "<q>"',
  };
  let left =
    CORE_MAX - 40 - [1, 2, 3, 7].reduce((n, s) => n + body[s].length + frame(s), 0) - frame(4) - frame(5) - frame(6);
  for (const [n, budget] of [
    [4, 1_600],
    [6, 800],
    [5, 2_200],
  ]) {
    const b = Math.max(0, Math.min(budget, left));
    body[n] = b >= 80 ? make(n, b, false) : `(no room in the core: th brief --section ${n})`;
    left -= body[n].length;
  }
  let core = [1, 2, 3, 4, 5, 6, 7].map((n) => render(n, body[n])).join('\n\n');
  // A safety net only: the budgets above keep the core under the cap.
  if (core.length > CORE_MAX) core = `${core.slice(0, core.lastIndexOf('\n', CORE_MAX - 40))}\n(+cut: th brief --full)`;
  // A card's question can quote a fact, and reflex reads no memory: it sees that cards wait, not what they ask.
  const pending = [
    ...i.decisions.map(
      (d) =>
        `decision ${d.id} waiting (${d.class})${reflex ? '' : `: ${d.question}`}${d.show_from > i.now ? ` · held until ${clock(d.show_from, i.tz)}` : ''}`,
    ),
    ...i.ledger.map((l) => `${clock(l.at, i.tz)} ${l.actor} ${l.kind}: ${l.what}`),
  ];
  const sections: [number, string][] = [
    [1, body[1]],
    ...[2, 3, 4, 5, 6].map((n): [number, string] => [n, make(n, FULL_BUDGET[n], true)]),
    [7, body[7]],
    [8, reflex ? NO_MEMORY : i.profile.slice(0, 6_000)],
    [9, reflex ? NO_MEMORY : renderDays(i.days, 1_400)],
    [
      10,
      pending.length
        ? budgeted(pending, 2_000, 'newest', (k) => `(+${k} more: th ledger)`)
        : 'Nothing in the last 24 h.',
    ],
    [
      11,
      [
        `errors open ${i.errorsOpen}`,
        i.watchdogs.length ? watchdogLine(i.watchdogs, i.tz) : 'watchdogs: none tripped',
        i.night ?? 'night shift: not connected yet',
      ]
        .join(' · ')
        .slice(0, 1_200),
    ],
    [
      12,
      budgeted(
        i.todayEarlier.map((m) => line(m, i.tz, false)),
        8_000,
        'newest',
        (k) => `(+${k} more: th history today)`,
      ) || 'Nothing earlier.',
    ],
  ];
  const full = sections
    .map(([n, b]) => render(n, b))
    .join('\n\n')
    .slice(0, FULL_MAX);
  return { core, full };
}
