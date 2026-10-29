// When the owner forgets a fact (MEMORY.md §3), nothing may keep its words: the decision cards that
// name it (`ref` `fact:<id>`) lose their question and why, and a card still waiting is cancelled,
// since there is nothing left to decide. Called from memory's forget, also when forget is itself
// what an approved card runs (that card is `approved` by then, so it is scrubbed, not cancelled).
import type { Writer } from '../../objects/commit';
import * as store from './store';

export const FORGOTTEN = { question: 'Forget a fact?', why: '(forgotten)' } as const;

export function forgotten(w: Writer, factIds: string[]): void {
  for (const id of factIds)
    for (const p of store.byRef(w.db, `fact:${id}`)) {
      store.scrubWords(w.db, p.id, FORGOTTEN.question, FORGOTTEN.why);
      if (p.status === 'waiting') {
        store.decide(w.db, p.id, { status: 'cancelled', decided_at: w.at });
        w.ledger({
          kind: 'proposal',
          actor: 'worker',
          what: 'cancelled a decision card',
          why: 'the owner forgot the fact it was about',
          ref: `proposal:${p.id}`,
          undoable: false,
          proposal_id: p.id,
        });
      }
      w.change('proposal', `proposal:${p.id}`);
    }
}
