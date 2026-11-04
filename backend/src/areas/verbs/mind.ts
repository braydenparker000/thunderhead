// The Worker-side verbs of batch 3 (shared/contract/verbs-mind.ts): a conversation's title, the
// owner's keep of an outside fact (memory/keep.ts: memory's own ledger row and undo) and a Muse
// order with the owner's data (work/placed.ts). worker.ts runs them like the others; their stored
// inverses are here too (undo.ts dispatches by op).
import { law8Topic } from '../../../../shared/contract/verbs.ts';
import { Fail } from '../../lib/result';
import { threadHeld } from '../conversation/held';
import { thread } from '../conversation/store';
import { patchThread, restoreTitle } from '../conversation/store-threads';
import { keepOutside } from '../memory/keep';
import { cancel } from '../work/ops';
import { placePersonal } from '../work/placed';
import type { Ran, RunCtx } from './worker';

type Args = Record<string, unknown>;

/** Law 8 over words the gate does not read on its own (a title names content elsewhere). */
function lawWords(path: string, text: string): void {
  const topic = law8Topic(text, null);
  if (topic) throw new Fail('validation', { reason: 'needs_owner_words', topic, path });
}

export const MIND_EXECUTORS: Record<string, (x: RunCtx, a: Args) => Ran> = {
  'thread.title': ({ w }, a) => {
    const id = a.thread_id as string;
    const title = a.title as string;
    lawWords('args.title', title);
    const t = thread(w.db, id);
    if (!t || threadHeld(w.db, id, w.at)) throw new Fail('not_found', { reason: 'no such conversation' });
    if (t.title_source === 'owner') throw new Fail('conflict', { reason: 'the owner named this thread' });
    if (t.title === title) return { result: { previous: title }, undo: null };
    patchThread(w.db, id, title, undefined, w.at);
    w.change('thread', `thread:${id}`);
    return {
      result: { previous: t.title ?? null },
      undo: { op: 'thread.retitle', args: { thread_id: id, title, before: t.title ?? null, source: t.title_source } },
    };
  },
  'memory.outside_keep': ({ w, c }, a) => {
    const out = keepOutside(w, c, a.fact_id as string);
    // memory's own row keeps the inverse (memory.reopen); the verb's row is that one.
    return { result: { fact_id: out.fact_id, provenance: out.provenance }, undo: null, ledger_id: out.ledger_id };
  },
  'muse.order_personal': ({ w, c, id }, a) => {
    lawWords('args.title', a.title as string);
    placePersonal(w, c, id, a as { title: string; words: string; app?: string });
    return { result: { order_id: id }, undo: { op: 'work.cancel', args: { order_id: id } } };
  },
};

export const MIND_UNDO_OPS = ['thread.retitle', 'work.cancel'];

export function undoMind(w: RunCtx['w'], op: string, args: Args): void {
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  if (op === 'work.cancel') {
    cancel(w, str(args.order_id) ?? '');
    return;
  }
  const id = str(args.thread_id) ?? '';
  const t = thread(w.db, id);
  if (!t) throw new Fail('not_found');
  if (t.title !== args.title) throw new Fail('conflict', { reason: 'the conversation was named again since' });
  restoreTitle(w.db, id, str(args.before), str(args.source), w.at);
  w.change('thread', `thread:${id}`);
}
