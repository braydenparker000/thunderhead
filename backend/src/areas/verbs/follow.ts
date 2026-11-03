// The follow-through rule (BEHAVIOR.md §5): when a verb the mind queued in a class the owner feels
// later (music, podcasts, practice, watch) completes under `tell` or `quiet` (a Worker-side verb
// as it is queued, a phone verb when the phone reports it done), the Worker opens one loose end for
// the mind: "follow up: did <verb> land?", citing the verb's ledger row, due the next owner-local
// day. At most one per topic (`follow.<verb>`) in 7 days, kept in the nudges' `topics` rows. The
// mind closes it once it has asked (`th thread done`); one still open 3 days after it was opened
// is dropped by the 15-minute tick. Under `ask` the owner already saw a card for exactly that
// call, so nothing is followed up. A plan counts once, keyed by the plan (its line on home, so the
// same evening plan run every day is asked about once a week), when it runs; its steps never count
// on their own (`followPlan`).
import type { PermitPosition } from '../../../../shared/contract/permits.ts';
import { permitOf } from '../../../../shared/contract/permits.ts';
import { uuidv7 } from '../../lib/ids';
import { DAY, dayBefore, ownerDay, zonedInstant } from '../../lib/time';
import type { Writer } from '../../objects/commit';
import * as notes from '../memory/notes';
import { topicShown, topicShownAt } from '../surfaces/store';

/** The classes whose verbs get a follow-up. */
export const FOLLOW_CLASSES: readonly string[] = ['music', 'podcasts', 'practice', 'watch'];
/** One follow-up per topic in this long. */
export const FOLLOW_GAP = 7 * DAY;
/** An open follow-up the mind never asked about is dropped after this long. */
export const FOLLOW_KEEP = 3 * DAY;
/** The tag that marks one (the tick finds them by it). */
export const FOLLOW_TAG = 'follow-up';

export const topicOf = (verb: string) => `follow.${verb}`;

/** After a mind's verb completed: its follow-up, if the rule asks for one. Returns its id, or null.
 * A plan names its own class, topic and words (`followPlan`). */
export function followThrough(
  w: Writer,
  v: {
    verb: string;
    why: string;
    position: PermitPosition | null;
    cls?: string | null;
    topic?: string;
    label?: string;
  },
  ledgerId: string,
  zone: () => string,
): string | null {
  const cls = v.cls !== undefined ? v.cls : permitOf(v.verb)?.class;
  if (!cls || !FOLLOW_CLASSES.includes(cls) || (v.position !== 'tell' && v.position !== 'quiet')) return null;
  const topic = v.topic ?? topicOf(v.verb);
  const label = v.label ?? v.verb;
  const last = topicShownAt(w.db, topic);
  if (last !== null && last > w.at - FOLLOW_GAP) return null;
  topicShown(w.db, topic, w.at);
  const id = uuidv7(w.at);
  const tz = zone();
  const row: notes.OpenThreadRow = {
    id,
    text: `follow up: did ${label} land? (${v.why.replace(/\s+/g, ' ').trim()})`.slice(0, 280),
    owner: 'mind',
    due_at: zonedInstant(dayBefore(ownerDay(w.at, tz), -1), 0, tz),
    tags_json: JSON.stringify([FOLLOW_TAG]),
    status: 'open',
    evidence_json: JSON.stringify([`ledger:${ledgerId}`]),
    opened_at: w.at,
    last_progress_at: null,
    closed_at: null,
    closed_why: null,
  };
  w.ledger({
    kind: 'memory',
    actor: 'worker',
    what: 'opened a follow-up',
    why: `after ${label} (ledger:${ledgerId})`,
    ref: `open:${id}`,
    undo: { op: 'open.restore', args: { id, before: null, after: { ...row } } },
  });
  notes.putOpenThread(w.db, row);
  w.change('open_thread', `open:${id}`);
  return id;
}

/** A plan that ran: one follow-up for all of it, in the first followed class among its steps,
 * keyed by its line (`follow.plan:<what>`). */
export function followPlan(
  w: Writer,
  p: { what: string; why: string; position: PermitPosition | null; verbs: string[] },
  ledgerId: string,
  zone: () => string,
): string | null {
  const cls = p.verbs.map((v) => permitOf(v)?.class ?? null).find((c) => c && FOLLOW_CLASSES.includes(c)) ?? null;
  const what = p.what.replace(/\s+/g, ' ').trim();
  return followThrough(
    w,
    {
      verb: 'plan.run',
      why: p.why,
      position: p.position,
      cls,
      topic: `follow.plan:${what.toLowerCase().slice(0, 64)}`,
      label: `the plan "${what}"`,
    },
    ledgerId,
    zone,
  );
}

/** The tick's pass: follow-ups still open FOLLOW_KEEP after they were opened are dropped. Reads the
 * open loose ends overdue by a day (the due index), at most 50 a pass. */
export function dropUnasked(w: Writer): number {
  let n = 0;
  for (const t of notes.openDueBefore(w.db, w.at - DAY, 50)) {
    if (t.opened_at > w.at - FOLLOW_KEEP || !(t.tags_json ?? '').includes(`"${FOLLOW_TAG}"`)) continue;
    const row = { ...t, status: 'dropped' as const, closed_at: w.at, closed_why: 'not asked within 3 days' };
    w.ledger({
      kind: 'memory',
      actor: 'worker',
      what: 'dropped a follow-up',
      why: 'dropped: not asked within 3 days',
      ref: `open:${t.id}`,
      undo: { op: 'open.restore', args: { id: t.id, before: { ...t }, after: { ...row } } },
    });
    notes.putOpenThread(w.db, row);
    w.change('open_thread', `open:${t.id}`);
    n++;
  }
  return n;
}
