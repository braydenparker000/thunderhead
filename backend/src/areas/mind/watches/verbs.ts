// `watch.set` and `watch.cancel` as Worker-side verbs (shared/contract/watches.ts WATCH_VERBS):
// verbs/worker.ts registers these executors beside its own, and the ledger's undo runs their
// inverses (ops.ts `undo`). No permit gate: the specs have no class (the mind's own bookkeeping).
import type { JsonObject } from '../../../../../shared/contract/api';
import type { Caller } from '../../../objects/caller';
import type { Writer } from '../../../objects/commit';
import { cancel, type SetArgs, set } from './ops';

interface Ran {
  result: JsonObject;
  undo: { op: string; args: JsonObject } | null;
}
type Executor = (x: { w: Writer; c: Caller; id: string }, a: Record<string, unknown>) => Ran;

export const WATCH_EXECUTORS: Record<string, Executor> = {
  // The watch's id is the verb's, so the verb's result and its ledger row name it.
  'watch.set': ({ w, c, id }, a) => ({
    result: set(w, c, id, a as unknown as SetArgs),
    undo: { op: 'watch.cancel', args: { id } },
  }),
  'watch.cancel': ({ w }, a) => ({
    result: cancel(w, a.id as string),
    undo: { op: 'watch.revive', args: { id: a.id as string } },
  }),
};
