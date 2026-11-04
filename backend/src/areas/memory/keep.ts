// The owner's Keep of a fact learned from outside text, asked in the chat (`memory.outside_keep`,
// shared/contract/verbs-mind.ts). Its class always asks (mind/permit.ts), so it runs only with the
// card the owner approved: that tap is the Keep, and it lifts the fact into an `owner` version as
// Keep under "Learned from outside" does (fact-ops.ts `confirm`, MEMORY.md §6 M11e), with memory's
// own ledger row and undo (`memory.reopen`). Only from a clean session: one that read outside text
// may not ask to keep what it read; and only a current `outside` fact.
import { uuidv7 } from '../../lib/ids';
import { Fail } from '../../lib/result';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { claimedSession } from '../mind/guards';
import { type Applied, confirm } from './fact-ops';
import * as store from './store';
import { type OpContext, Reject } from './validate';

export function keepOutside(w: Writer, c: Caller, factId: string): Applied {
  const guards = claimedSession(w.db, c.session_id, c.who === 'N' ? 'night' : 'chat');
  if (guards.tainted) throw new Fail('session_tainted');
  if (guards.offRecord) throw new Fail('off_record');
  const f = store.fact(w.db, factId);
  if (!f || f.superseded_at !== null) throw new Fail('not_found', { reason: 'no such fact' });
  if (store.provenanceOf(f) !== 'outside') throw new Fail('validation', { reason: 'not_outside' });
  // The approved card stands in for the device's tap: the owner's own act, its evidence its row.
  const ctx: OpContext = {
    db: w.db,
    at: w.at,
    device: true,
    tainted: false,
    lawsBroken: false,
    selfLedger: uuidv7(w.at),
  };
  try {
    return confirm(w, c, ctx, { op: 'confirm', id: factId });
  } catch (e) {
    if (e instanceof Reject) throw new Fail('validation', { reason: e.reason });
    throw e;
  }
}
