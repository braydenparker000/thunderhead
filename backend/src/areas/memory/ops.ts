// Memory ops (API.md §11.13, MEMORY.md §3): a batch of ≤ 50 small operations, each validated on
// its own (validate.ts); the valid ones apply together in the caller's commit, each with its
// ledger row and stored inverse, and the rest are listed with their reason. A batch is idempotent
// by its id for 7 days (op_batches). Ledger rows of memory never carry a fact's text, so the
// owner's `forget` can leave nothing behind but a contentless tombstone.
import { MEMORY_LIMITS, type MemoryOpsResponse } from '../../../../shared/contract/memory.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail } from '../../lib/result';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { sessionGuards } from '../mind/guards';
import { type Applied, add, confirm, supersede } from './fact-ops';
import { batch, putBatch } from './notes';
import { flag, forget } from './owner-ops';
import { type OpContext, type ParsedOp, parseOp, Reject } from './validate';

/** POST /v1/memory/ops. `hash` is the canonical body hash (API.md §7). */
export function apply(w: Writer, c: Caller, batchId: string, raw: unknown[], hash: string): MemoryOpsResponse {
  const key = `memory.ops:${batchId}`;
  const seen = batch(w.db, key);
  if (seen) {
    if (seen.req_sha256 !== hash) throw new Fail('conflict');
    return JSON.parse(seen.result_json) as MemoryOpsResponse;
  }
  const device = c.who === 'D';
  if (!device && !c.session_id)
    throw new Fail('validation', [{ path: 'TH-Session', issue: 'required for memory writes' }]);
  const guards = !device && c.session_id ? sessionGuards(w.db, c.session_id) : null;
  const out: MemoryOpsResponse = { applied: [], proposals: [], rejected: [] };
  let supersedes = 0;
  raw.forEach((r, i) => {
    const ctx: OpContext = {
      db: w.db,
      at: w.at,
      device,
      night: c.who === 'N',
      tainted: guards?.tainted ?? false,
      // M12: the pin needs the constitution hash the session claimed with; none claimed, no rules.
      lawsBroken: !device && (guards?.constitution ?? 'none') === 'none',
      selfLedger: uuidv7(w.at),
    };
    try {
      const op = parseOp(r);
      if (op.op === 'supersede' && ctx.night && supersedes >= MEMORY_LIMITS.night_supersedes)
        throw new Reject('proposal_required'); // M10
      const done = one(w, c, ctx, op);
      if (op.op === 'supersede') supersedes++;
      out.applied.push({ i, ...done });
    } catch (e) {
      if (!(e instanceof Reject)) throw e;
      out.rejected.push({ i, reason: e.reason });
    }
  });
  if (!out.applied.length) {
    const reasons = new Set(out.rejected.map((r) => r.reason));
    const only = reasons.size === 1 ? [...reasons][0] : null;
    if (only === 'session_tainted' || only === 'laws_unpinned') throw new Fail(only);
    throw new Fail(
      'validation',
      out.rejected.map((r) => ({ path: `ops.${r.i}`, issue: r.reason })),
    );
  }
  putBatch(w.db, {
    key,
    route: 'POST /v1/memory/ops',
    req_sha256: hash,
    status: 200,
    result_json: JSON.stringify(out),
    at: w.at,
  });
  return out;
}

function one(w: Writer, c: Caller, ctx: OpContext, op: ParsedOp): Applied {
  switch (op.op) {
    case 'add':
      return add(w, c, ctx, op);
    case 'supersede':
      return supersede(w, c, ctx, op);
    case 'confirm':
      return confirm(w, c, ctx, op);
    case 'pin':
    case 'may_raise':
      return flag(w, c, ctx, op.id, op.op === 'pin' ? 'pinned' : 'may_raise', op.op === 'pin' ? op.pinned : op.value);
    case 'forget':
      return forget(w, c, ctx, op.id);
  }
}
