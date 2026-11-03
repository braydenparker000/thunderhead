// The briefing's later core sections (MEMORY.md §9): 7, the day (what the mind arranged on it and how
// the owner met each so far, the predictions about it, the Briefing's tiles one line each, a shared
// calendar's events), and 8, on demand (where everything else is: the full file's sections, recall,
// any route, the skills, the subagents; and the loose ends written after outside text, which the
// first layer leaves out). Each part has its own budget and keeps the oldest. Pure.
import { SKILLS } from '../../../../shared/contract/skills.ts';
import { notedBy } from '../memory/notes';
import { renderThreads } from '../memory/profile';
import type { BriefInput } from './brief';
import { part } from './brief-text';
import { DELEGATE } from './brief-verbs';

/** Section 7's parts at most, each with where the rest is. */
export const DAY_BUDGET = { arranged: 420, predicted: 260, tiles: 340, shared: 260 } as const;

/** Section 7 within `budget` (its parts' own budgets first). */
export function daySection(i: BriefInput, budget: number): string {
  if (i.role === 'reflex') return "Not for the reflex: the owner's day is not its business.";
  const lines = [
    ...head(
      `Arranged on ${i.day}, each as the owner met it so far (kept, undone, ignored, unseen, no answer yet):`,
      part(i.arranged, DAY_BUDGET.arranged, 'th ledger --kind arrangement'),
    ),
    ...head(`Predicted for ${i.day}:`, part(i.predicted, DAY_BUDGET.predicted, 'th predict list --open')),
    ...head('The Briefing shows:', part(i.tiles, DAY_BUDGET.tiles, 'what the night placed: th surface ls')),
    ...head('Shared calendars:', part(i.calendarShared, DAY_BUDGET.shared, 'th get /v1/briefing/calendar days=2')),
  ];
  const text = lines.length
    ? lines.join('\n')
    : `Nothing arranged or predicted for ${i.day}, and no tiles on the Briefing.`;
  return text.length <= budget
    ? text
    : `${text.slice(0, text.lastIndexOf('\n', budget - 40))}\n(+more: th brief --section 7)`;
}
const head = (title: string, body: string[]) => (body.length ? [title, ...body] : []);

/** The skills line: what a session reads before it acts in an app or an area (mind/skills/). */
export const SKILLS_LINE = `Skills, read one before you act in its app or area: th skill <name> (${SKILLS.join(', ')}).`;

/** Section 8: where the rest is, then the loose ends written after outside text (marked, or kept
 * back from a clean session: MEMORY.md §6 M11f), then whom to delegate to (last). */
export function onDemandSection(i: BriefInput): string {
  const outside = i.role === 'reflex' ? [] : i.threads.filter((t) => notedBy(t) === 'outside');
  return [
    'Full briefing: $TMPDIR/th/brief.md · th brief --section <n>: 9 profile, 10 every loose end, 11 last 7 days, 12 pending, 13 your settings and every verb, 14 health, 15 today earlier',
    'Search: th recall "<q>" (each hit with its provenance) · any route: th get <path> (th help lists them) · Your settings: th brief --section 13',
    ...(i.role === 'reflex' ? [] : [SKILLS_LINE]),
    ...(outside.length
      ? [
          'Loose ends written after outside text:',
          renderThreads(outside, i.tz, 600, (k) => `(+${k} more: th brief --section 10)`, !i.tainted),
        ]
      : []),
    DELEGATE[i.role],
  ].join('\n');
}
