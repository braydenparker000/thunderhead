// What approving a proposal does, op by op: the fixed executor map of API.md §11.10. Its keys are
// the registry's ops (shared/contract/proposals.ts; a test keeps them equal). Core's own ops run
// inside the decision's commit with the owner's authority, and every ledger row they write carries
// the proposal's id (Writer.proposal). An executor checks everything before it writes, so a refusal
// (a fact already gone) leaves nothing half done: the proposal is then `failed` with the code.
// `agents.revoke` runs in the Auth object after the commit (after.ts).
import type { Json, ProposalResult } from '../../../../shared/contract/api';
import { PROPOSAL_OPS, type ProposalOpName } from '../../../../shared/contract/proposals.ts';
import { uuidv7 } from '../../lib/ids';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { forget } from '../memory/owner-ops';
import { pin } from './laws';
import type { ProposalRow } from './store';

export interface Ran {
  result: ProposalResult;
  ledger_id: string | null;
}

type CoreRun = (w: Writer, args: Record<string, Json>, p: ProposalRow, owner: Caller) => Ran;

/** The ops that run inside Core's commit. */
export const CORE_RUNS: Partial<Record<ProposalOpName, CoreRun>> = {
  'memory.forget': (w, a, _p, owner) => {
    const ctx = { db: w.db, at: w.at, device: true, tainted: false, lawsBroken: false, selfLedger: uuidv7(w.at) };
    const r = forget(w, owner, ctx, String(a.id));
    return { result: { fact_id: r.fact_id }, ledger_id: r.ledger_id };
  },
  // The approval is the record: the hook asks for it (th approved) before an edit or a push.
  'repo.change': (_w, a) => ({ result: { paths: Array.isArray(a.paths) ? a.paths.length : 0 }, ledger_id: null }),
  'laws.pin': (w, a, p) => {
    const sha = String(a.sha256);
    return { result: { pinned: sha }, ledger_id: pin(w, sha, p.id) };
  },
};

/** Every op is run somewhere: in Core (above) or after the commit (after.ts). */
export function runsIn(op: string): 'core' | 'auth' | null {
  if (!Object.hasOwn(PROPOSAL_OPS, op)) return null;
  return PROPOSAL_OPS[op as ProposalOpName].runs;
}
