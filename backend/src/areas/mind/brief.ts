// The briefing (MEMORY.md §9): built and truncated by the Worker, never by the model. Every
// section starts with a `## <n>. <Name>` line (mind Finding 3), so the hook and `th brief
// --section` cut between whole sections. The core (1–7) stays ≤ 9,500 characters, the full
// briefing (1–12) ≤ 48,000. Sections a later phase fills (rules, open threads, profile, last 7
// days) say so instead of disappearing, so the shape is stable across phases.
import type { LedgerEntry, Message, MindRole } from '../../../../shared/contract/api';

export const CORE_MAX = 9_500;
export const FULL_MAX = 48_000;

export interface BriefInput {
  role: MindRole;
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
  yesterday: { threadId: string | null; tail: Message[] };
  ledger: LedgerEntry[];
  errorsOpen: number;
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
function budgeted(lines: string[], budget: number, section: number, keep: 'newest' | 'oldest'): string {
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
  return cut ? `${body}\n(+${cut} more: th brief --section ${section})` : body;
}

export function buildBrief(i: BriefInput): { core: string; full: string } {
  const night = i.role === 'night';
  const now = [
    `${weekday(i.now, i.tz)} ${clock(i.now, i.tz)} (${i.tz}) · day ${i.day} · role ${i.role}`,
    `wake: ${i.wakeReason ?? 'manual'} · wakes today ${i.wakesToday} · pre-warms left ${i.prewarmsLeft}`,
    i.backoffUntil > i.now ? `usage backoff until ${clock(i.backoffUntil, i.tz)}` : 'no usage backoff',
    'laws: pinned · open decisions 0 · quiet: off',
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
  const tail = [
    i.note ? `Latest session note (${clock(i.note.created_at, i.tz)}): ${i.note.body}` : 'No session note yet today.',
    ...i.todayTail.map((m) => line(m, i.tz)),
  ];
  const yesterday = i.yesterday.tail.length
    ? budgeted(
        i.yesterday.tail.map((m) => line(m, i.tz, false)),
        800,
        6,
        'newest',
      )
    : 'No messages yesterday.';
  const sections: [number, string, string, number][] = [
    [1, 'Now', now, 500],
    [2, 'Waiting', waiting, 2_800],
    [3, 'Standing rules', 'None yet (rules arrive with memory, P3).', 1_400],
    [4, 'Open threads', 'None yet (open threads arrive with memory, P3).', 1_600],
    [5, 'Today so far', night ? 'See section 2.' : budgeted(tail, 2_200, 5, 'newest'), 2_200],
    [6, 'Yesterday', yesterday, 800],
    [7, 'Pointer', 'Full briefing: $TMPDIR/th/brief.md · Search: th recall "<q>"', 200],
  ];
  const later: [number, string, string][] = [
    [8, 'Profile', 'None yet (the profile arrives with memory, P3).'],
    [9, 'Last 7 days', 'None yet (day notes arrive with the night shift, P3).'],
    [
      10,
      'Pending',
      i.ledger.length
        ? i.ledger.map((l) => `${clock(l.at, i.tz)} ${l.actor} ${l.kind}: ${l.what}`).join('\n')
        : 'Nothing in the last 24 h.',
    ],
    [11, 'Health', `errors open ${i.errorsOpen}`],
    [12, 'Today earlier', i.todayEarlier.map((m) => line(m, i.tz, false)).join('\n') || 'Nothing earlier.'],
  ];
  const render = (n: number, name: string, body: string) => `## ${n}. ${name}\n${body}`;
  let core = sections.map(([n, name, body, budget]) => render(n, name, body.slice(0, budget))).join('\n\n');
  if (core.length > CORE_MAX) core = `${core.slice(0, core.lastIndexOf('\n', CORE_MAX - 40))}\n(+cut: th brief --full)`;
  const full = `${core}\n\n${later.map(([n, name, body]) => render(n, name, body)).join('\n\n')}`.slice(0, FULL_MAX);
  return { core, full };
}
