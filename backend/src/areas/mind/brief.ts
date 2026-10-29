// The briefing (MEMORY.md §9): built and truncated by the Worker, never by the model. Every
// section starts with a `## <n>. <Name>` line (mind Finding 3), so the hook and `th brief
// --section` cut between whole sections. The core (1–7) stays ≤ 9,500 characters: sections 1, 2,
// 3 and 7 always appear (2 cut oldest-first), then 4, 6 and 5 get what is left, in that order.
// The full briefing (1–12) stays ≤ 48,000, each later section within its own budget.
import type { LedgerEntry, Message, MindRole } from '../../../../shared/contract/api';
import type { DayNoteRow, OpenThreadRow } from '../memory/notes';
import { renderDayNote, renderDays, renderRules, renderThreads } from '../memory/profile';
import type { FactRow } from '../memory/store';

export const CORE_MAX = 9_500;
export const FULL_MAX = 48_000;

export interface BriefInput {
  role: MindRole;
  /** The constitution's SHA-256 the session sent (`none` if its file was missing). */
  constitution: string;
  now: number;
  tz: string;
  day: string;
  wakeReason: string | null;
  wakesToday: number;
  prewarmsLeft: number;
  backoffUntil: number;
  threadId: string | null;
  waiting: Message[];
  todayTail: Message[];
  todayEarlier: Message[];
  note: { body: string; created_at: number } | null;
  yesterday: { threadId: string | null; tail: Message[]; note: DayNoteRow | null };
  ledger: LedgerEntry[];
  errorsOpen: number;
  rules: FactRow[];
  threads: OpenThreadRow[];
  /** The rendered profile (MEMORY.md §8, ≤ 6,000 characters). */
  profile: string;
  days: DayNoteRow[];
  /** One line about the night shift's run (P3 stage C), or null. */
  night: string | null;
}

const clock = (at: number, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(at);
const weekday = (at: number, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long' }).format(at);

function line(m: Message, tz: string, full = true): string {
  const who = m.author === 'owner' ? 'owner' : m.author;
  const body = full ? m.body : m.body.replace(/\s+/g, ' ').slice(0, 120);
  return `[${m.id}] ${clock(m.created_at, tz)} ${who}${m.kind === 'text' ? '' : ` (${m.kind})`}: ${body}`;
}

/** Fits `lines` under `budget` characters, keeping the newest (or oldest) and marking the cut. */
export function budgeted(lines: string[], budget: number, section: number, keep: 'newest' | 'oldest'): string {
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
  return cut ? `${body}\n(+${cut} more: th brief --section ${section})`.trim() : body;
}

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

export function buildBrief(i: BriefInput): { core: string; full: string } {
  const night = i.role === 'night';
  const now = [
    `${weekday(i.now, i.tz)} ${clock(i.now, i.tz)} (${i.tz}) · day ${i.day} · role ${i.role}`,
    `wake: ${i.wakeReason ?? 'manual'} · wakes today ${i.wakesToday} · pre-warms left ${i.prewarmsLeft}`,
    i.backoffUntil > i.now ? `usage backoff until ${clock(i.backoffUntil, i.tz)}` : 'no usage backoff',
    `laws: ${i.constitution === 'none' ? 'mind/CONSTITUTION.md missing' : `sha256 ${i.constitution.slice(0, 12)}`} (the pin arrives with proposals, P4) · open decisions 0 · quiet: off`,
  ].join('\n');
  const waiting = night
    ? `Yesterday's thread: ${i.yesterday.threadId ?? 'none'}, ${i.yesterday.tail.length} messages; run th day ${i.day}`
    : i.waiting.length
      ? budgeted(
          i.waiting.map((m) => line(m, i.tz)),
          2_800,
          2,
          'oldest',
        ).replace(/\(\+(\d+) more: th brief --section 2\)$/, `(+$1 more waiting: th history ${i.threadId ?? 'today'})`)
      : 'Nothing is waiting.';
  const body: Record<number, string> = {
    1: now.slice(0, 500),
    2: waiting.slice(0, 2_800),
    3: renderRules(i.rules, i.tz, 1_400),
    7: 'Full briefing: $TMPDIR/th/brief.md · Search: th recall "<q>"',
  };
  let left =
    CORE_MAX - 40 - [1, 2, 3, 7].reduce((n, s) => n + body[s].length + frame(s), 0) - frame(4) - frame(5) - frame(6);
  const take = (s: number, budget: number, make: (b: number) => string) => {
    const b = Math.max(0, Math.min(budget, left));
    body[s] = b >= 80 ? make(b) : `(no room in the core: th brief --section ${s})`;
    left -= body[s].length;
  };
  take(4, 1_600, (b) => renderThreads(i.threads, i.tz, b));
  take(6, 800, (b) =>
    i.yesterday.note
      ? renderDayNote(i.yesterday.note, b)
      : i.yesterday.tail.length
        ? budgeted(
            i.yesterday.tail.map((m) => line(m, i.tz, false)),
            b,
            6,
            'newest',
          )
        : 'No messages yesterday.',
  );
  const tail = [
    i.note ? `Latest session note (${clock(i.note.created_at, i.tz)}): ${i.note.body}` : 'No session note yet today.',
    ...i.todayTail.map((m) => line(m, i.tz)),
  ];
  take(5, 2_200, (b) => (night ? 'See section 2.' : budgeted(tail, b, 5, 'newest')));
  let core = [1, 2, 3, 4, 5, 6, 7].map((n) => render(n, body[n])).join('\n\n');
  // A safety net only: the budgets above keep the core under the cap.
  if (core.length > CORE_MAX) core = `${core.slice(0, core.lastIndexOf('\n', CORE_MAX - 40))}\n(+cut: th brief --full)`;
  const pending = i.ledger.map((l) => `${clock(l.at, i.tz)} ${l.actor} ${l.kind}: ${l.what}`);
  const later: [number, string][] = [
    [8, i.profile.slice(0, 6_000)],
    [9, renderDays(i.days, 1_400)],
    [10, pending.length ? budgeted(pending, 2_000, 10, 'newest') : 'Nothing in the last 24 h.'],
    [11, [`errors open ${i.errorsOpen}`, i.night ?? 'night shift: not connected yet'].join(' · ').slice(0, 1_200)],
    [
      12,
      budgeted(
        i.todayEarlier.map((m) => line(m, i.tz, false)),
        8_000,
        12,
        'newest',
      ) || 'Nothing earlier.',
    ],
  ];
  const full = `${core}\n\n${later.map(([n, b]) => render(n, b)).join('\n\n')}`.slice(0, FULL_MAX);
  return { core, full };
}
