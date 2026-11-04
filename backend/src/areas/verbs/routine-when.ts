// A routine's condition (routines.ts): checked and resolved when the card is raised and again at the
// yes, put in words for the card and Settings, and turned into the next time it comes due. An `at`
// time is the owner's wall clock on the given weekdays; a fact's usual time is the start of the band
// of hours its routine of the senses names (shared/contract/senses.ts `parseRoutineRef`), on its
// weekdays; an `after` waits for the first event of its type in the owner's day, so it has no time.
import { dayWords, ROUTINE_DAYS, type RoutineCondition, type Weekday } from '../../../../shared/contract/routines.ts';
import { parseRoutineRef, SENSE_TYPES } from '../../../../shared/contract/senses.ts';
import { law8Topic } from '../../../../shared/contract/verbs.ts';
import { WORKER_EVENTS } from '../../../../shared/contract/watches.ts';
import { Fail, invalid } from '../../lib/result';
import { DAY, ownerDay, zonedMinute } from '../../lib/time';
import type { Db } from '../../objects/base';
import { lineage } from '../memory/store';

/** The condition as stored: a fact's carries the time and days it was read at, and its words. */
export type Resolved =
  | { at: string; days?: Weekday[] }
  | { after: string }
  | { fact: string; at: string; days: Weekday[]; text: string };

const PATH = 'spec.args.condition';
const pad = (n: number) => String(n).padStart(2, '0');
const short = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** Checks the condition and reads a fact's usual time (one lineage read by the fact's id). */
export function resolve(db: Db, c: RoutineCondition): Resolved {
  if ('at' in c) return c.days ? { at: c.at, days: c.days } : { at: c.at };
  if ('after' in c) {
    if (!Object.hasOwn(SENSE_TYPES, c.after) && !Object.hasOwn(WORKER_EVENTS, c.after))
      throw invalid(`${PATH}.after`, 'a sense type (or reminder.fired)');
    return { after: c.after };
  }
  const f = lineage(db, c.fact).find((v) => v.superseded_at === null);
  if (f?.source !== 'observed') throw invalid(`${PATH}.fact`, 'no current observed fact with this id');
  const refs = JSON.parse(f.evidence_json) as string[];
  const r = refs.map((x) => parseRoutineRef(x)).find((x) => x !== null);
  if (!r) throw invalid(`${PATH}.fact`, 'the fact cites no routine of the senses');
  // Law 8 reaches the condition too: a routine never runs off a fact about a topic the mind may not act on.
  const topic = law8Topic(f.text, {});
  if (topic) throw new Fail('validation', { reason: 'needs_owner_words', topic, path: `${PATH}.fact` });
  return { fact: c.fact, at: `${pad(r.hour_from)}:00`, days: [...r.weekdays], text: short(f.text, 60) };
}

/** "Weekdays at 07:30", "After music.play, once a day", "Saturdays at 09:00, your usual time (…)". */
export function words(c: Resolved): string {
  if ('after' in c) return `After ${c.after}, once a day`;
  const at = `${dayWords(c.days)} at ${c.at}`;
  return 'fact' in c ? `${at}, your usual time (${c.text})` : at;
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
const weekday = (day: string): Weekday => ROUTINE_DAYS[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7];

/** The first time after `after` the condition comes, in the owner's zone; null for an event. */
export function nextAt(c: Resolved, after: number, tz: string): number | null {
  if (!('at' in c)) return null;
  const minute = Number(c.at.slice(0, 2)) * 60 + Number(c.at.slice(3, 5));
  let day = ownerDay(after, tz);
  for (let k = 0; k < 9; k++) {
    if (!c.days || c.days.includes(weekday(day))) {
      const t = zonedMinute(day, minute, tz);
      if (t > after) return t;
    }
    day = nextDay(day);
  }
  return null;
}
