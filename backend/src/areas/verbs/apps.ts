// The Worker-side verbs of batch 2 (shared/contract/verbs-apps.ts and verbs-shell.ts; MIND-PLAN
// §3.3, §3.7): the apps' arrangements (a shortlist to pick from, Study's next passage, Guitar's
// plan), each placed in its app's one slot through the surfaces area (surfaces/arrange.ts: its own
// ledger row, which run.ts makes the verb's, whose undo puts back what was there); Study's pace
// from the owner's words, through memory's rules; a conversation filed under a topic; a standing
// reminder rule. worker.ts runs them like the others.
import type { JsonObject } from '../../../../shared/contract/api';
import { ARRANGES } from '../../../../shared/contract/verbs-apps.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail } from '../../lib/result';
import { threadHeld } from '../conversation/held';
import { thread } from '../conversation/store';
import { setTopic } from '../conversation/store-threads';
import * as memory from '../memory/ops';
import { currentOf } from '../memory/subject';
import { SNOOZE_KEY, snoozeRules, withRule } from '../reminders/snooze';
import { writeSetting } from '../settings/mind-set';
import { arrange } from '../surfaces/arrange';
import type { Ran, RunCtx } from './worker';

type Args = Record<string, unknown>;
type Executor = (x: RunCtx, a: Args) => Ran;

/** The subject Study's pace is kept under (a goal in the owner's words). */
export const PACE_SUBJECT = 'study.pace';

/** An app's arrangement in its slot (ARRANGES), under the slot's own topic (`astra.tonight`); its
 * ref names what it is about (the book, the song), else the verb. */
const place =
  ({ at, kind, ref }: { at: string; kind: string; ref: string | null }): Executor =>
  (x, a) => {
    const [app, slot] = at.split('/');
    const about = ref ? (a[ref] as string) : `verb:${x.id}`;
    const put = { app, slot, kind, payload: a, why: x.why, topic_key: `${app}.${slot}`, ref: about };
    const { ledgerId, undo } = arrange(x.w, x.c, put, x.zone);
    return { result: { placed: at }, undo: undo as Ran['undo'], ledger_id: ledgerId };
  };

export const APP_EXECUTORS: Record<string, Executor> = {
  ...Object.fromEntries(Object.entries(ARRANGES).map(([verb, spec]) => [verb, place(spec)])),
  'study.pace_goal': (x, a): Ran => {
    const old = currentOf(x.w.db, 'goal', PACE_SUBJECT, x.w.at);
    const id = uuidv7(x.w.at);
    const fact = { text: `Study pace: ${a.pages as number} pages a week.`, evidence: a.evidence as string[] };
    const shape = { kind: 'goal', source: 'user', subject: PACE_SUBJECT, about: 'owner' };
    const op = old
      ? { op: 'supersede', id: old.id, reason: 'the owner set a new pace', new: { id, ...fact, ...shape } }
      : { op: 'add', id, ...fact, ...shape };
    const out = memory.apply(x.w, x.c, `verb:${x.id}`, [op], x.hash);
    return {
      result: { fact_id: id, previous: old?.id ?? null },
      undo: old
        ? { op: 'memory.reopen', args: { old_id: old.id, new_id: id } }
        : { op: 'memory.close', args: { fact_id: id } },
      ledger_id: out.applied[0].ledger_id,
    };
  },
  'thread.file': ({ w }, a) => {
    const id = a.thread_id as string;
    const t = thread(w.db, id);
    if (!t || threadHeld(w.db, id, w.at)) throw new Fail('not_found', { reason: 'no such conversation' });
    const topic = a.topic as string;
    if (t.topic === topic) return { result: { previous: topic }, undo: null };
    setTopic(w.db, id, topic, w.at);
    w.change('thread', `thread:${id}`);
    return {
      result: { previous: t.topic },
      undo: { op: 'thread.topic', args: { thread_id: id, topic, before: t.topic } },
    };
  },
  'reminder.snooze_rule': ({ w, c }, a) => {
    const rule = { during: a.during as string, from: a.from as string, to: a.to as string };
    const next = withRule(snoozeRules(w.db), rule);
    const was = writeSetting(w, c.actor, SNOOZE_KEY, next);
    return {
      result: { rules: next.length },
      undo: was ? { op: 'setting.restore', args: { ...was } as JsonObject } : null,
    };
  },
};

/** thread.file's undo: the topic before, while the thread still holds the one it was given. */
export function unfile(w: RunCtx['w'], args: Args): void {
  const id = typeof args.thread_id === 'string' ? args.thread_id : '';
  const t = thread(w.db, id);
  if (!t || t.topic !== args.topic) throw new Fail('conflict', { reason: 'the conversation changed since' });
  setTopic(w.db, id, typeof args.before === 'string' ? args.before : null, w.at);
  w.change('thread', `thread:${id}`);
}
