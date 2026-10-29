// The proposals' half of the Core object (P4 stage A, areas/proposals): raising, listing, deciding
// and cancelling decision cards, and recording the after-commit step of an approval whose op runs
// in the Auth object. A code layer of the one Core class, like core-memory.ts: no Durable Object
// class of its own. `Core` (core.ts) adds the laws check at each claim and expiry in its tick.
import type {
  CancelProposalRequest,
  DecideProposalRequest,
  Proposal,
  PutProposalRequest,
} from '../../../shared/contract/api';
import * as decide from '../areas/proposals/decide';
import * as proposals from '../areas/proposals/ops';
import * as store from '../areas/proposals/store';
import type { Out } from '../lib/result';
import type { Caller } from './caller';
import { CoreImport } from './core-import';

export abstract class CoreProposals extends CoreImport {
  putProposal(
    c: Caller,
    id: string,
    r: PutProposalRequest,
    hash: string,
    target: string | null = null,
  ): Out<{ proposal: Proposal; created: boolean }> {
    return this.run((w) => proposals.put(w, c, id, r, hash, this.tz(), target));
  }

  /** Newest first, as stored rows (the route shapes them: a list of the recursive `Json` type is
   * too deep for the RPC stub's types). Cards past their time are expired on the way. */
  proposals(status: 'waiting' | 'all', before: string | null, limit: number): store.ProposalRow[] {
    if (store.waiting(this.db).some((p) => p.expires_at <= Date.now())) this.write((w) => proposals.settle(w));
    return store.page(this.db, status, before, limit);
  }

  decideProposal(c: Caller, id: string, r: DecideProposalRequest): Out<decide.Decided> {
    return this.run((w) => decide.decide(w, c, id, r, this.tz()));
  }

  proposalRan(id: string, out: decide.AfterOut): Out<decide.Decided> {
    return this.run((w) => decide.ran(w, id, out));
  }

  cancelProposal(c: Caller, id: string, why: CancelProposalRequest['why']): Out<{ status: 'cancelled' }> {
    return this.run((w) => proposals.cancel(w, c, id, why));
  }

  /** Approvals whose Auth step has not reported for 2 minutes, for the cron to run again. */
  staleApprovals(): decide.After[] {
    return this.write((w) => decide.stale(w));
  }
}
