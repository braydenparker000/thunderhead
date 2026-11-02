// Using an approved `permit.allow` card (shared/contract/proposals.ts, API.md §11.11): an action
// whose standing permission is Ask, or that has a floor, goes through for the mind only with a card
// the owner approved for exactly that call. The write uses the card up in its own commit, so a
// refused or failed write leaves it unused; it counts for 7 days after the yes.
import type { PermitRefusal } from '../../../../shared/contract/permits.ts';
import { PROPOSAL_LIMITS, type ProposalResult } from '../../../../shared/contract/proposals.ts';
import { DAY } from '../../lib/time';
import type { Writer } from '../../objects/commit';
import * as store from './store';

export type Taken = { ok: true } | { ok: false; why: NonNullable<PermitRefusal['given']> };

/** Uses card `id` for `action` with call hash `call`, by the write `by` (`verb:<id>`, …). */
export function takeApproval(w: Writer, id: string, action: string, call: string, by: string): Taken {
  const p = store.byId(w.db, id);
  if (p?.op !== 'permit.allow') return { ok: false, why: 'not_found' };
  if (p.status === 'waiting') return { ok: false, why: 'waiting' };
  if (p.status !== 'executed') return { ok: false, why: 'not_approved' };
  const { args } = JSON.parse(p.spec_json) as { args: { action?: unknown; call?: unknown } };
  if (args.action !== action || args.call !== call) return { ok: false, why: 'other_call' };
  const result = (p.result_json ? JSON.parse(p.result_json) : {}) as ProposalResult;
  if (result.used_by) return { ok: false, why: 'used' };
  if ((p.decided_at ?? 0) < w.at - PROPOSAL_LIMITS.expires_days * DAY) return { ok: false, why: 'expired' };
  store.finish(w.db, id, 'executed', { ...result, used_by: by, used_at: w.at }, p.executed_ledger_id);
  w.change('proposal', `proposal:${id}`);
  return { ok: true };
}
