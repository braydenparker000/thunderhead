// Deciding a card (API.md §11.10, BEHAVIOR.md §4, DEC-2): only the owner decides, by a tap on a
// signed-in device or in their own words, which mind:chat records (`by_message`) and the Worker
// checks against the message itself. An approval covers the spec's hash only. Approving runs the
// registry's op (executors.ts): in this commit for Core's own ops; an Auth op comes back with what
// is left to run (after.ts), and `ran` records its outcome once.
import type {
  DecideProposalRequest,
  Json,
  Proposal,
  ProposalDecision,
  ProposalResult,
} from '../../../../shared/contract/api';
import { PROPOSAL_LIMITS, proposalOp } from '../../../../shared/contract/proposals.ts';
import { Fail, invalid } from '../../lib/result';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { currentDay } from '../conversation/day';
import { latestOwnerMessage } from '../conversation/stats';
import * as convo from '../conversation/store';
import { Reject } from '../memory/validate';
import { claimedSession } from '../mind/guards';
import { nextQuietEnd, quietWindow } from '../settings/quiet';
import { CORE_RUNS, runsIn } from './executors';
import { settle } from './ops';
import * as store from './store';

/** What approving a card left to run after the commit (the Auth object's ops). */
export interface After {
  id: string;
  op: string;
  args: Record<string, Json>;
}

export interface Decided {
  status: Proposal['status'];
  result?: ProposalResult;
  ledger_id: string;
  after?: After;
}

/** DEC-2: the cited message is the owner's own, typed on a signed-in device, in the open day's
 * thread (a "yes" left in yesterday's thread is overtaken by whatever the owner wrote today), sent
 * after the card could first be seen, still the owner's latest in that thread, and not already
 * used to answer a card (a snooze in words uses it up too). Who records it is checked first. */
function ownerWords(w: Writer, messageId: string, p: store.ProposalRow, tz: string): void {
  const m = convo.messageById(w.db, messageId);
  if (m?.author !== 'owner' || m.origin !== 'owner_device') throw new Fail('not_owner_words');
  if (m.thread_id !== convo.dailyThread(w.db, currentDay(w.db, tz, w.at))?.id) throw new Fail('not_owner_words');
  if (m.created_at <= p.visible_from || m.created_at > w.at) throw new Fail('not_owner_words');
  if (latestOwnerMessage(w.db, m.thread_id)?.id !== m.id) throw new Fail('not_owner_words');
  if (store.messageUsed(w.db, messageId)) throw new Fail('not_owner_words');
}

const WORDS: Record<ProposalDecision, [tap: string, words: string]> = {
  approve: ['approved by a tap', 'approved in the owner’s own words'],
  reject: ['turned down by a tap', 'turned down in the owner’s own words'],
  snooze: ['put off until tomorrow by a tap', 'put off until tomorrow in the owner’s own words'],
};

/** POST /v1/proposals/:id/decide. `c` is the device that tapped, or mind:chat with the owner's
 * words. An approval whose op runs in Auth comes back `approved` with what is left to run. */
export function decide(w: Writer, c: Caller, id: string, r: DecideProposalRequest, tz: string): Decided {
  settle(w);
  const p = store.byId(w.db, id);
  if (!p) throw new Fail('not_found');
  if (p.status === 'expired') throw new Fail('expired');
  if (p.status !== 'waiting') throw new Fail('already_decided');
  if (r.spec_hash !== p.spec_hash) throw new Fail('spec_mismatch');
  const device = c.who === 'D';
  if (device && r.by_message !== undefined) throw invalid('by_message', 'a device decides by a tap');
  if (!device) {
    if (c.who !== 'C') throw new Fail('forbidden');
    if (r.by_message === undefined) throw invalid('by_message', "mind:chat decides only with the owner's own words");
    // The words must be the owner's, and who records them matters too: only the claimed chat
    // session that holds the lease, and a tainted one may not record a yes (SECURITY.md §5.3).
    const s = claimedSession(w.db, c.session_id, 'chat');
    if (s.tainted && r.decision === 'approve') throw new Fail('session_tainted');
    // Some cards only a tap decides: the laws pin, so the mind never moves its own laws.
    if (proposalOp(p.op)?.decide === 'tap') throw new Fail('not_owner_words');
    ownerWords(w, r.by_message, p, tz);
  }
  const via = device ? 'tap' : 'words';
  const decision = {
    decided_at: w.at,
    decided_by_device: device ? c.device_id : null,
    decided_via: via,
    decided_message_id: device ? null : (r.by_message ?? null),
  } as const;
  const ledger = (what: string) =>
    w.ledger({
      kind: 'proposal',
      actor: 'owner',
      session_id: c.session_id,
      what,
      why: device ? 'the owner answered the card' : 'mind:chat recorded the owner’s message, checked by the Worker',
      ref: device ? `proposal:${id}` : `msg:${r.by_message}`,
      undoable: false,
      proposal_id: id,
    });
  w.change('proposal', `proposal:${id}`);
  const words = WORDS[r.decision][device ? 0 : 1];
  if (r.decision === 'snooze') {
    if (p.snoozes >= PROPOSAL_LIMITS.snoozes) {
      store.decide(w.db, id, { ...decision, status: 'expired' });
      return { status: 'expired', ledger_id: ledger('a decision card expired after its last "not yet"') };
    }
    store.snooze(w.db, id, nextQuietEnd(w.at, tz, quietWindow(w.db)), decision.decided_message_id);
    return { status: 'waiting', ledger_id: ledger(words) };
  }
  if (r.decision === 'reject') {
    store.decide(w.db, id, { ...decision, status: 'rejected' });
    return { status: 'rejected', ledger_id: ledger(words) };
  }
  store.decide(w.db, id, { ...decision, status: 'approved' });
  const ledgerId = ledger(words);
  const args = (JSON.parse(p.spec_json) as { args: Record<string, Json> }).args;
  if (runsIn(p.op) !== 'core') return { status: 'approved', ledger_id: ledgerId, after: { id, op: p.op, args } };
  const owner: Caller = { actor: 'owner', who: 'D', session_id: c.session_id, device_id: c.device_id };
  const run = CORE_RUNS[p.op as keyof typeof CORE_RUNS];
  w.proposal = id;
  try {
    const out = run ? run(w, args, p, owner) : null;
    if (!out) throw new Fail('not_found');
    store.finish(w.db, id, 'executed', out.result, out.ledger_id);
    return { status: 'executed', result: out.result, ledger_id: ledgerId };
  } catch (e) {
    const code = e instanceof Fail ? e.code : e instanceof Reject ? e.reason : null;
    if (code === null) throw e;
    store.finish(w.db, id, 'failed', { code }, null);
    return { status: 'failed', result: { code }, ledger_id: ledgerId };
  } finally {
    w.proposal = null;
  }
}

/** What the after-commit step did: `executed` with its result, or `failed` with a code. */
export type AfterOut = { ok: true; result: ProposalResult; what: string } | { ok: false; code: string };

/** Records the after-commit step of an approval (once: a repeat returns the stored outcome). */
export function ran(w: Writer, id: string, out: AfterOut): Decided {
  const p = store.byId(w.db, id);
  if (!p) throw new Fail('not_found');
  if (p.status !== 'approved')
    return {
      status: p.status,
      ledger_id: p.executed_ledger_id ?? '',
      result: p.result_json ? JSON.parse(p.result_json) : undefined,
    };
  const ledgerId = w.ledger({
    kind: 'proposal',
    actor: 'worker',
    what: out.ok ? out.what : `could not run an approved card (${out.code})`,
    why: 'the owner approved this card',
    ref: `proposal:${id}`,
    undoable: false,
    proposal_id: id,
  });
  const result = out.ok ? out.result : { code: out.code };
  store.finish(w.db, id, out.ok ? 'executed' : 'failed', result, ledgerId);
  w.change('proposal', `proposal:${id}`);
  return { status: out.ok ? 'executed' : 'failed', result, ledger_id: ledgerId };
}

/** Approvals whose after-commit step has not reported for 2 minutes (the cron runs them again). */
export function stale(w: Writer): After[] {
  return store
    .open(w.db)
    .filter((p) => p.status === 'approved' && (p.decided_at ?? 0) < w.at - 120_000)
    .map((p) => ({ id: p.id, op: p.op, args: (JSON.parse(p.spec_json) as { args: Record<string, Json> }).args }));
}
