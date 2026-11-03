// The briefing's first layer (MEMORY.md §9): sections 1 and 2, the first 2,000 characters, which a
// session reads on every wake. Section 1 is now: the clock, the wake, the laws and quiet; the mind's
// voice in three lines (BEHAVIOR.md §10); and today's state, each line its own: the weather, the
// owner's own calendar, what is due, the song playing. Section 2 is the owner: who they are in their
// own words, their loose ends, and each verb class's position. Nothing `outside` is in it (MEMORY.md
// §6 M11): a shared calendar's events go to section 7 and a loose end written after outside text to
// section 8. Each part is its own small function, so a new line joins one list. Pure.

import { notedBy } from '../memory/notes';
import { renderOwner, renderThreads } from '../memory/profile';
import type { BriefInput } from './brief';
import { clock, part, weekday } from './brief-text';
import { verbSummary } from './brief-verbs';

/** Sections 1 and 2 together, headings included: the first layer. */
export const LAYER_MAX = 2_000;
/** Section 1's body at most, so section 2 always has room inside the layer. */
export const NOW_MAX = 1_300;
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
  const wakes = `wakes today ${i.wakesToday}${i.wakeBudget ? ` of ${i.wakeBudget}` : ''}`;
  const backoff = i.backoffUntil > i.now ? ` · usage backoff until ${clock(i.backoffUntil, i.tz)}` : '';
  return [
    `${weekday(i.now, i.tz)} ${clock(i.now, i.tz)} (${i.tz}) · day ${i.day} · role ${i.role}`,
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

/** Today's state, owner's own only, each in its budget: the weather, the calendar, what is due (the
 * reminders, the scheduled verbs), the song playing. Reflex gets none: the day is not its business. */
function todayLines(i: BriefInput): string[] {
  if (i.role === 'reflex') return [];
  return [
    ...(i.weather ? [`weather: ${i.weather}`.slice(0, 160)] : []),
    ...part(i.calendar, 400, 'th get /v1/briefing/calendar days=2'),
    ...part(i.due, 360, 'th remind list'),
    ...(i.playing ? [i.playing.slice(0, 160)] : []),
  ];
}

/** Section 1, ≤ NOW_MAX characters (cut at a whole line). */
export function nowSection(i: BriefInput): string {
  const text = [stateLines(i), ...VOICE, ...todayLines(i)].join('\n');
  return text.length <= NOW_MAX ? text : text.slice(0, text.lastIndexOf('\n', NOW_MAX));
}

/** Section 2 within `budget`: the owner's own words (the profile's top `owner` lines), their loose
 * ends (none written after outside text), the verb classes' positions. Cuts point at the full
 * sections (9, 10, 13). Reflex reads no memory and queues no verb. */
export function ownerSection(i: BriefInput, budget: number): string {
  if (i.role === 'reflex') return NO_MEMORY;
  const verbs = verbSummary(i.settings ?? []);
  const room = budget - verbs.length - 60;
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
  return ['In their own words:', facts, 'Loose ends:', threads, verbs].join('\n');
}
