// What lands (BEHAVIOR.md §3.6, EVALS.md §9): the meter's outcome of each arrangement (meter.ts, the
// same rule, one row at a time), counted per topic and per place over the last 30 days, and the
// streak: ignored or undone in a row since the last kept, a home line never seen and one not decided
// yet skipped. Three in a row and the topic rests for 30 days. The streak counts only what was placed
// after the topic last reopened or went quiet, so a reopened topic starts clean. Counts only, never a
// score (law 16). Pure.
import { LANDS, type TopicLands } from '../../../../shared/contract/lands.ts';
import { DAY, dayBefore, ownerDay } from '../../lib/time';
import { logicalDay } from '../conversation/day';
import { type Arrangement, arrangements, type Rollup } from './meter';

export type Outcome = 'kept' | 'undone' | 'ignored' | 'unseen' | 'waiting';
const OUTCOMES: readonly Outcome[] = ['kept', 'undone', 'ignored', 'unseen', 'waiting'];

export interface Placed extends Arrangement {
  topic_key: string;
  /** `home`, `briefing`, or the app whose surface it was. */
  place: string;
}

/** What the pass needs of a topic's row (surfaces/store.ts TopicState). */
export interface TopicMarks {
  quiet_from: number | null;
  quiet_until: number | null;
  said_at: number | null;
  reopened_at: number | null;
}

/** Senses by day, so each arrangement reads only its own day's and the next. */
export function byDay(senses: Rollup[]): Map<string, Rollup[]> {
  const out = new Map<string, Rollup[]>();
  for (const r of senses) {
    const day = out.get(r.day);
    if (day) day.push(r);
    else out.set(r.day, [r]);
  }
  return out;
}

/** One arrangement's outcome by the meter's own rule. */
export function outcomeOf(a: Arrangement, days: Map<string, Rollup[]>, now: number, tz: string): Outcome {
  const day = logicalDay(a.at, tz);
  const near = [...(days.get(day) ?? []), ...(days.get(dayBefore(day, -1)) ?? [])];
  const c = arrangements([a], near, now, tz);
  return OUTCOMES.find((k) => c[k] > 0) ?? 'waiting';
}

/** Ignored or undone in a row at the end, oldest first in; a kept resets it; unseen and waiting are skipped. */
export function streakOf(outcomes: Outcome[]): number {
  let n = 0;
  for (const o of outcomes) {
    if (o === 'kept') n = 0;
    else if (o === 'ignored' || o === 'undone') n++;
  }
  return n;
}

/** Whether a topic rests at `now`. */
export const resting = (m: TopicMarks | undefined, now: number) =>
  m?.quiet_until !== null && m?.quiet_until !== undefined && m.quiet_until > now;

/** Each topic's counts over `rows` (the window, oldest first), its streak since it last reopened or
 * went quiet, and its resting state. Unsorted. */
export function countTopics(
  rows: Placed[],
  days: Map<string, Rollup[]>,
  marks: Map<string, TopicMarks>,
  now: number,
  tz: string,
): TopicLands[] {
  const by = new Map<string, Placed[]>();
  for (const r of rows) {
    const list = by.get(r.topic_key);
    if (list) list.push(r);
    else by.set(r.topic_key, [r]);
  }
  const out: TopicLands[] = [];
  for (const [key, list] of by) {
    const m = marks.get(key);
    const since = Math.max(m?.reopened_at ?? 0, m?.quiet_from ?? 0);
    const t = { kept: 0, undone: 0, ignored: 0, unseen: 0, waiting: 0 };
    const counted: Outcome[] = [];
    for (const a of list) {
      const o = outcomeOf(a, days, now, tz);
      t[o]++;
      if (a.at > since) counted.push(o);
    }
    out.push({
      topic_key: key,
      places: [...new Set(list.map((a) => a.place).reverse())],
      ...t,
      streak: streakOf(counted),
      ...restingFields(m, now, tz),
    });
  }
  return out;
}

/** A topic's resting fields: when it reopens (and that day), whether the mind said so. */
export function restingFields(m: TopicMarks | undefined, now: number, tz: string) {
  const until = resting(m, now) ? (m?.quiet_until ?? null) : null;
  return {
    quiet_until: until,
    reopens: until === null ? null : ownerDay(until, tz),
    said: until !== null && !!m?.said_at,
  };
}

/** Whether this pass sends a topic to rest: its streak reached the rule's, and it does not rest yet. */
export const trips = (t: TopicLands) => t.quiet_until === null && t.streak >= LANDS.streak;

/** When a topic sent to rest at `now` reopens. */
export const quietUntil = (now: number) => now + LANDS.quiet_days * DAY;

/** Worst first: resting, then the longest streak, then the most turned down against kept, then the key. */
export function worstFirst(a: TopicLands, b: TopicLands): number {
  const down = (t: TopicLands) => t.ignored + t.undone - t.kept;
  return (
    Number(b.quiet_until !== null) - Number(a.quiet_until !== null) ||
    b.streak - a.streak ||
    down(b) - down(a) ||
    a.topic_key.localeCompare(b.topic_key)
  );
}

/** The counts kept on the topic's row for the briefing (lands_json), without its resting fields. */
export type LandsCache = Omit<TopicLands, 'topic_key' | 'quiet_until' | 'reopens' | 'said'>;
export const cacheOf = ({ topic_key: _k, quiet_until: _q, reopens: _r, said: _s, ...c }: TopicLands): LandsCache => c;
