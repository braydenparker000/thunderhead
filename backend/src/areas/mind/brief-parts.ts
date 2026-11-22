// The briefing in parts (MEMORY.md §9): what a session gets at its start without a command. Claude
// Code caps a hook command's plain stdout at 10,000 characters, each command on its own, so the
// SessionStart hook runs once per part and each part stays ≤ 9,400 characters (BRIEF_PARTS):
// - part 1: now; waiting (each message with up to 3 memories that match it); the owner (section 2
//   with the profile folded in, ≤ 6,000); standing rules (every "You told me", newest first, ≤ 2,000).
// - part 2: today's conversation so far, the messages themselves (each ≤ 1,200 characters, oldest
//   dropped first to fit), then today so far (the latest session note).
// - part 3: loose ends; yesterday and the last 7 days; settings and verbs; health; the day; on demand.
// A part that overflows drops whole sections from its end and says so with the cut marker. What a
// session may see is decided where each section is made (brief.ts, brief-layer.ts, brief-day.ts),
// the same as in `core` and `full`. Each section is its own small function. Pure.
import { BRIEF_PARTS } from '../../../../shared/contract/mind-brief';
import { provenanceOf } from '../memory/store';
import { type BriefInput, fullOnly, middle, OFF_RECORD_NOTE } from './brief';
import { daySection, onDemandSection } from './brief-day';
import { NO_MEMORY, nowSection, ownerSection, TOLD_HEAD } from './brief-layer';
import { recallLine } from './brief-recall';
import { budgeted, clock, line } from './brief-text';

export const PART_CUT = '(+cut: th brief --full)';
const PROFILE_MAX = 6_000;
const RULES_MAX = 2_000;
const WAITING_MAX = 3_000;
const MESSAGE_MAX = 1_200;

type Section = [heading: string, body: string];
const section = ([h, b]: Section) => `## ${h}\n${b}`;

/** Sections joined; when over the cap, whole sections dropped from the end and the marker added. */
export function fitPart(sections: Section[], cap: number = BRIEF_PARTS.chars): string {
  const all = sections.map(section);
  const whole = all.join('\n\n');
  if (whole.length <= cap) return whole;
  const budget = cap - PART_CUT.length - 2;
  let kept = '';
  for (const s of all) {
    const next = kept ? `${kept}\n\n${s}` : s;
    if (next.length > budget) break;
    kept = next;
  }
  if (!kept) kept = all[0].slice(0, all[0].lastIndexOf('\n', budget));
  return `${kept}\n${PART_CUT}`;
}

// --- part 1 ------------------------------------------------------------------------------------

const nowPart = (i: BriefInput): Section => ['1. Now', nowSection(i)];

/** Each waiting message whole, its memories under it; off the record marked, with the note. */
function waitingPart(i: BriefInput, make: ReturnType<typeof middle>): Section {
  if (i.role !== 'chat') return ['3. Waiting', make(3, WAITING_MAX, false)];
  const off = i.offRecord ?? [];
  const items = i.waiting.map((m) =>
    [line(m, i.tz, true, off), ...(i.recall?.[m.id] ?? []).map(recallLine)].join('\n'),
  );
  const lines = [...(off.length ? [OFF_RECORD_NOTE(off)] : []), ...items];
  const more = (k: number) => `(+${k} more waiting: th brief --section 3)`;
  return ['3. Waiting', lines.length ? budgeted(lines, WAITING_MAX, 'oldest', more) : 'Nothing is waiting.'];
}

/** Section 2 as the core has it, then the profile in what is left of 6,000. */
function ownerPart(i: BriefInput): Section {
  if (i.role === 'reflex') return ['2. The owner', NO_MEMORY];
  const own = ownerSection(i, 2_000);
  const room = PROFILE_MAX - own.length - 10;
  const at = i.profile.lastIndexOf('\n', room);
  const profile = i.profile.length > room ? i.profile.slice(0, at > 0 ? at : Math.max(0, room)) : i.profile;
  return ['2. The owner', profile.trim() ? `${own}\nProfile:\n${profile}` : own];
}

/** Every rule the owner gave ("You told me"), newest first; none written after outside text. */
function rulesPart(i: BriefInput): Section {
  if (i.role === 'reflex') return ['4. Standing rules', NO_MEMORY];
  const own = i.rules
    .filter((f) => f.kind === 'rule' && f.superseded_at === null && provenanceOf(f) !== 'outside')
    .sort((a, b) => b.recorded_at - a.recorded_at || (a.id < b.id ? 1 : -1))
    .map((f) => `- ${f.text.replace(/\s+/g, ' ')}`);
  const more = (k: number) => `(+${k} more: th get /v1/memory/facts kind=rule)`;
  const body = own.length
    ? `${TOLD_HEAD}\n${budgeted(own, RULES_MAX - TOLD_HEAD.length, 'oldest', more)}`
    : 'None yet.';
  return ['4. Standing rules', body];
}

// --- part 2 ------------------------------------------------------------------------------------

/** The latest session note: the messages themselves are the section before. */
function todaySoFarPart(i: BriefInput): Section {
  const note =
    i.role === 'reflex'
      ? `Session notes: ${NO_MEMORY}`
      : i.note
        ? `Latest session note (${clock(i.note.created_at, i.tz)}): ${i.note.body}`
        : 'No session note yet today.';
  return ['5. Today so far', note];
}

/** Today's messages in order, owner's and the mind's, each ≤ 1,200 characters, oldest dropped. */
function conversationPart(i: BriefInput, budget: number): Section {
  if (i.role === 'night') return ["Today's conversation", `The night works on ${i.day}: th day ${i.day}`];
  const lines = [...i.todayEarlier, ...i.todayTail].map((m) => {
    const l = line(m, i.tz, true);
    return l.length > MESSAGE_MAX ? `${l.slice(0, MESSAGE_MAX - 1)}…` : l;
  });
  const more = (k: number) => `(+${k} earlier: th history today)`;
  return ["Today's conversation", lines.length ? budgeted(lines, budget, 'newest', more) : 'No messages yet today.'];
}

// --- part 3 ------------------------------------------------------------------------------------

const looseEndsPart = (full: Map<number, string>): Section => ['10. Open threads', full.get(10) ?? ''];
const yesterdayPart = (make: ReturnType<typeof middle>): Section => ['6. Yesterday', make(6, 2_500, true)];
const weekPart = (full: Map<number, string>): Section => ['11. Last 7 days', full.get(11) ?? ''];
const settingsPart = (full: Map<number, string>): Section => ['13. Your settings', full.get(13) ?? ''];
const healthPart = (full: Map<number, string>): Section => ['14. Health', full.get(14) ?? ''];
const dayPart = (i: BriefInput): Section => ['7. The day', daySection(i, 2_200)];
const onDemandPart = (i: BriefInput): Section => ['8. On demand', onDemandSection(i)];

/** The `## <name>` section of mind/ROLES.md this session reads instead of its role's own; none. */
export const roleSectionFor = (_i: BriefInput): string | undefined => undefined;

/** The three parts, in order. */
export function briefParts(i: BriefInput): string[] {
  const make = middle(i);
  const full = new Map(fullOnly(i));
  const one = fitPart([nowPart(i), waitingPart(i, make), ownerPart(i), rulesPart(i)]);
  const soFar = todaySoFarPart(i);
  const room = BRIEF_PARTS.chars - section(soFar).length - 60;
  const two = fitPart([conversationPart(i, room), soFar]);
  const three = fitPart([
    looseEndsPart(full),
    yesterdayPart(make),
    weekPart(full),
    settingsPart(full),
    healthPart(full),
    dayPart(i),
    onDemandPart(i),
  ]);
  return [one, two, three];
}
