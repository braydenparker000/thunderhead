// The briefing's first layer (MEMORY.md §9): sections 1 and 2, the first 2,000 characters, which a
// session reads on every wake. Section 1 is now: the clock (the owner's day or evening), the wake,
// the laws and quiet; the mind's voice in three lines (BEHAVIOR.md §10) and the name the owner gave
// it; and today's state, each line its own: the weather, the owner's own calendar, what is due, the
// song playing. Section 2 is the owner: who they are in their
// own words, what they told the mind to do or stop ("You told me", their rules, newest first), their
// loose ends, and each verb class's position. Nothing `outside` is in it (MEMORY.md
// §6 M11): a shared calendar's events go to section 7 and a loose end written after outside text to
// section 8. Each part is its own small function, so a new line joins one list. Pure.

import { notedBy } from '../memory/notes';
import { renderOwner, renderThreads } from '../memory/profile';
import { provenanceOf } from '../memory/store';
import type { BriefInput } from './brief';
import { dayPart, nameLine } from './brief-day';
import { budgeted, clock, part, weekday } from './brief-text';
import { verbSummary } from './brief-verbs';

/** Sections 1 and 2 together, headings included: the first layer. */
export const LAYER_MAX = 2_000;
/** Section 1's body at most, so section 2 always has room inside the layer (1,300 until the day
 * pulse joined it: one fired watch is about 290 characters). */
export const NOW_MAX = 1_400;
/** Reflex handles breakage and reads no memory (RUNTIME.md §7.1): its briefing says so in place. */
export const NO_MEMORY = 'Not in the reflex briefing (reflex reads no memory).';
/** Section 1's line for a session that read outside text (MEMORY.md §6 M11, §7). */
export const OUTSIDE_LINE =
  "outside: what you write this session is labelled outside; it waits for the owner's keep in Settings › Memory before it shapes the profile";

/** The voice, read on every wake: BEHAVIOR.md §10 in three lines (a test holds the two the same). */
export const VOICE = [
  'Voice: calm and plain, few words; more only when asked. You see a great deal: say what you do not know, and what you are holding back.',
  'Honest to a fault: disagree plainly, once, with the reason, then let it go. Dry warmth; never sentimental, never flattering.',
  'Call yourself "I" and the owner "you". No exclamation marks, no emoji, no hedging: odds instead.',
] as const;

/** e.g. `watchdogs tripped: errors.spike since 14:05 (reported) · th reflex` */
export const watchdogLine = (ws: BriefInput['watchdogs'], tz: string) =>
  `watchdogs tripped: ${ws.map((w) => `${w.name} since ${clock(w.since, tz)}${w.handled ? ` (${w.handled})` : ''}`).join(', ')} · th reflex`;

/** "off", or "until 06:30" ("until Monday 06:30" over a day away): no nudges, cards or home lines show. */
const quietLine = (i: BriefInput) =>
  i.quietUntil <= i.now
    ? 'off'
    : `until ${i.quietUntil - i.now > 24 * 3_600_000 ? `${weekday(i.quietUntil, i.tz)} ` : ''}${clock(i.quietUntil, i.tz)} (the owner said go quiet: no nudges; cards and home lines wait)`;

/** The session's state: where and when, the wake, the laws and quiet; a tripped watchdog, the
 * outside label and the day's database use when there are any. At most 500 characters. */
function stateLines(i: BriefInput): string {
  const wakes = `wakes today ${i.wakesToday}`;
  const backoff = i.backoffUntil > i.now ? ` · usage backoff until ${clock(i.backoffUntil, i.tz)}` : '';
  return [
    `${weekday(i.now, i.tz)} ${clock(i.now, i.tz)} (${i.tz}), ${dayPart(i.now, i.tz, i.hours)} · day ${i.day} · role ${i.role}`,
    `wake: ${i.wakeReason ?? 'manual'} · ${wakes} · pre-warms left ${i.prewarmsLeft}${backoff}`,
    `${i.laws} · open decisions ${i.decisions.length} · quiet: ${quietLine(i)}`,
    ...(i.watchdogs.length ? [watchdogLine(i.watchdogs, i.tz)] : []),
    ...(i.tainted ? [OUTSIDE_LINE] : []),
    // After the taint line, so a long section 1 never cuts that one.
    ...(i.quota ? [i.quota] : []),
  ]
    .join('\n')
    .slice(0, 500);
}

/** Today's parts in order, each at most its own budget, together at most what section 1 has left:
 * the day pulse (the wake budget's line, then the watches that woke this session), the weather, the
 * owner's own calendar, what is due (reminders, scheduled verbs), the song playing. */
export const TODAY_BUDGET = { pulse: 420, weather: 160, calendar: 280, due: 240, playing: 160, taste: 200 } as const;

/** Today's state within `room`, owner's own only; a part with no room left says where it is. Reflex
 * gets none: the owner's day is not its business. */
function todayLines(i: BriefInput, room: number): string[] {
  if (i.role === 'reflex') return [];
  const parts: [string[] | undefined, number, string][] = [
    [i.pulse, TODAY_BUDGET.pulse, 'th watch list'],
    [i.weather ? [`weather: ${i.weather}`] : [], TODAY_BUDGET.weather, 'the Briefing'],
    [i.calendar, TODAY_BUDGET.calendar, 'th get /v1/briefing/calendar days=2'],
    [i.due, TODAY_BUDGET.due, 'th remind list'],
    [i.playing ? [i.playing] : [], TODAY_BUDGET.playing, 'th music now'],
    [i.taste ? [i.taste] : [], TODAY_BUDGET.taste, 'th music taste'],
  ];
  const out: string[] = [];
  for (const [lines, cap, more] of parts) {
    const b = Math.min(cap, room);
    if (!lines?.length) continue;
    // One short line fits whole; a list keeps its oldest lines and says where the rest are.
    const text = lines.length === 1 && lines[0].length <= b ? lines[0] : (part(lines, Math.max(b, 61), more)[0] ?? '');
    if (text.length + 1 > room) break;
    out.push(text);
    room -= text.length + 1;
  }
  return out;
}

/** Section 1, ≤ NOW_MAX characters: the state and how the mind may speak today (brief-learn.ts),
 * the voice, then today's state in what is left. */
export function nowSection(i: BriefInput): string {
  const name = nameLine(i.name);
  const head = [stateLines(i), ...(i.speech ? [i.speech.slice(0, 240)] : []), ...VOICE, ...(name ? [name] : [])].join(
    '\n',
  );
  return [head, ...todayLines(i, NOW_MAX - head.length - 1)].join('\n');
}

/** Section 2's "You told me" at most, heading included: the owner's rules, newest first, so a
 * correction they gave is in the first 2,000 on every wake (mind/skills/voice.md). */
export const TOLD_MAX = 400;
export const TOLD_HEAD = 'You told me (newest first; keep each for good):';

/** The rules as section 2's block, or none while there are none. Rules are never outside (M4). */
export function toldMe(rules: BriefInput['rules']): string[] {
  const own = rules
    .filter((f) => f.kind === 'rule' && f.superseded_at === null && provenanceOf(f) !== 'outside')
    .sort((a, b) => b.recorded_at - a.recorded_at || (a.id < b.id ? 1 : -1));
  if (!own.length) return [];
  const lines = own.map((f) => `- ${f.text.replace(/\s+/g, ' ').slice(0, 160)}`);
  const more = (k: number) => `(+${k} more: th brief --section 4)`;
  return [TOLD_HEAD, budgeted(lines, TOLD_MAX - TOLD_HEAD.length - 1, 'oldest', more)];
}

/** Section 2 within `budget`: the owner's own words (the profile's top `owner` lines), what they
 * told you (their rules, newest first), their loose ends (none written after outside text), the
 * verb classes' positions. Cuts point at the full sections (4, 9, 10, 13). Reflex reads no memory
 * and queues no verb. */
export function ownerSection(i: BriefInput, budget: number): string {
  if (i.role === 'reflex') return NO_MEMORY;
  const verbs = verbSummary(i.settings ?? []);
  const told = toldMe(i.rules);
  const room = budget - verbs.length - 60 - told.reduce((n, l) => n + l.length + 1, 0);
  const own = i.threads.filter((t) => notedBy(t) !== 'outside');
  const threads = renderThreads(
    own,
    i.tz,
    Math.min(500, Math.floor(room * 0.4)),
    (k) => `(+${k} more: th brief --section 10)`,
  );
  const facts = renderOwner(
    i.facts ?? [],
    i.now,
    Math.min(900, room - threads.length),
    (k) => `(+${k} more: th brief --section 9)`,
  );
  return ['In their own words:', facts, ...told, 'Loose ends:', threads, verbs].join('\n');
}
