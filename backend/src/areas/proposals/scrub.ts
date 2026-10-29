// When the owner forgets a fact (MEMORY.md §3), nothing may keep its words: every decision card
// that names it (`ref` `fact:<id>`) loses all of its text (question, why, if ignored, the buttons
// and the Worker's target line), however many there are, and a card still waiting is cancelled,
// since there is nothing left to decide. Called from memory's forget, also when forget is itself
// what an approved card runs (that card is `approved` by then, so it is scrubbed, not cancelled).
import type { Writer } from '../../objects/commit';
import * as store from './store';

export const FORGOTTEN = {
  question: 'Forget a fact?',
  why: '(forgotten)',
  if_ignored: '(forgotten)',
  options: ['Forget it', 'Keep it'],
} as const;

export function forgotten(w: Writer, factIds: string[]): void {
  for (const id of factIds) {
    const ref = `fact:${id}`;
    const open = store.waitingFor(w.db, ref);
    if (store.scrubRef(w.db, ref, { ...FORGOTTEN, options: [...FORGOTTEN.options] }) === 0) continue;
    if (open) {
      store.decide(w.db, open.id, { status: 'cancelled', decided_at: w.at });
      w.ledger({
        kind: 'proposal',
        actor: 'worker',
        what: 'cancelled a decision card',
        why: 'the owner forgot the fact it was about',
        ref: `proposal:${open.id}`,
        undoable: false,
        proposal_id: open.id,
      });
    }
    w.change('proposal', ref);
  }
}
