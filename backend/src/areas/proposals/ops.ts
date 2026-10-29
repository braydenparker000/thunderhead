// Proposals (API.md §11.10, BEHAVIOR.md §4, DEC-1): an agent raises a decision card, which waits
// for the owner (deciding it is decide.ts), expires after 7 days or is cancelled; the Worker raises
// its own laws card at a claim. Every step writes a ledger row and a `proposal` change, so the
// phone's card and the mind's briefing follow it. A tainted session raises no card at all: every agent op is in an
// ask-first class, and outside text must never start one (SECURITY.md §5.3, EVALS.md INJ-02…22).
import type { Json, Proposal, PutProposalRequest } from '../../../../shared/contract/api';
import { lintMindText } from '../../../../shared/contract/lint.ts';
import { PROPOSAL_CLASSES, PROPOSAL_LIMITS, proposalOp } from '../../../../shared/contract/proposals.ts';
import { canonicalJson } from '../../lib/canonical';
import { uuidv7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import { DAY } from '../../lib/time';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { sha256Hex } from '../auth/crypto';
import { claimedSession } from '../mind/guards';
import { heldUntil, quietWindow } from '../settings/quiet';
import { lawsCard } from './laws';
import * as store from './store';

const ROLE = { C: 'chat', N: 'night', R: 'reflex' } as const;

function lint(path: string, text: string): void {
  const problem = lintMindText(text);
  if (problem) throw invalid(path, problem);
}

/** The card's ref: what its op acts on (one waiting card per thing). */
const refOf = (op: { ref: readonly [string, string] }, args: Record<string, unknown>) =>
  `${op.ref[0]}:${String(args[op.ref[1]])}`;

/** PUT /v1/proposals/:id from an agent. `hash` is the canonical body hash (API.md §7). */
export function put(
  w: Writer,
  c: Caller,
  id: string,
  r: PutProposalRequest,
  hash: string,
  tz: string,
): { proposal: Proposal; created: boolean } {
  const found = store.byId(w.db, id);
  if (found) {
    if (found.req_sha256 !== hash) throw new Fail('conflict');
    return { proposal: store.toProposal(found), created: false };
  }
  if (c.who !== 'C' && c.who !== 'N' && c.who !== 'R') throw new Fail('forbidden');
  const op = proposalOp(r.spec.op);
  if (!op) throw invalid('spec.op', 'not an op in the executor map');
  if (!op.by.includes(c.who)) throw new Fail('forbidden');
  if (!op.classes.includes(r.class)) throw invalid('class', `this op is filed under ${op.classes.join(' or ')}`);
  const args = op.args.safeParse(r.spec.args);
  if (!args.success)
    throw new Fail(
      'validation',
      args.error.issues.map((i) => ({ path: ['spec', 'args', ...i.path.map(String)].join('.'), issue: i.message })),
    );
  // Only a claimed, live session of the key's role may ask, and never a tainted one.
  const s = claimedSession(w.db, c.session_id, ROLE[c.who]);
  if (s.tainted && PROPOSAL_CLASSES[r.class].ask_first) throw new Fail('session_tainted');
  lint('question', r.question);
  lint('why', r.why);
  lint('if_ignored', r.if_ignored);
  const spec = { v: 1 as const, op: r.spec.op, args: args.data as Record<string, Json> };
  const specJson = canonicalJson(spec);
  if (specJson.length > PROPOSAL_LIMITS.spec_bytes)
    throw invalid('spec', `at most ${PROPOSAL_LIMITS.spec_bytes} bytes`);
  if (store.waiting(w.db).filter((p) => p.created_by !== 'worker').length >= PROPOSAL_LIMITS.waiting)
    throw new Fail('decision_budget');
  const ref = refOf(op, spec.args);
  if (store.byRef(w.db, ref).some((p) => p.status === 'waiting'))
    throw new Fail('conflict', [{ path: 'spec', issue: 'a card for this already waits' }]);
  insert(w, c.actor, c.session_id, id, { ...r, spec }, specJson, ref, hash, tz);
  return { proposal: store.toProposal(store.byId(w.db, id) as store.ProposalRow), created: true };
}

/** A card the Worker raises itself (the laws pin): no session, no budget, no lint. */
export function raise(w: Writer, id: string, r: PutProposalRequest, tz: string): void {
  const op = proposalOp(r.spec.op);
  if (!op?.by.includes('worker')) throw new Error(`not a Worker op: ${r.spec.op}`);
  insert(w, 'worker', null, id, r, canonicalJson(r.spec), refOf(op, r.spec.args), null, tz);
}

function insert(
  w: Writer,
  actor: Caller['actor'],
  sessionId: string | null,
  id: string,
  r: PutProposalRequest,
  specJson: string,
  ref: string,
  hash: string | null,
  tz: string,
): void {
  // A card made in quiet hours waits for their end (HOME.md §3.4); the owner's words must come
  // after it could first be seen.
  const from = heldUntil(w.at, tz, quietWindow(w.db));
  store.insert(w.db, {
    id,
    created_at: w.at,
    created_by: actor,
    session_id: sessionId,
    class: r.class,
    question: r.question,
    why: r.why,
    if_ignored: r.if_ignored,
    odds: r.odds ?? null,
    options_json: JSON.stringify(r.options),
    safe: r.safe ?? 'reject',
    spec_json: specJson,
    spec_hash: sha256Hex(specJson),
    op: r.spec.op,
    ref,
    expires_at: w.at + PROPOSAL_LIMITS.expires_days * DAY,
    visible_from: from,
    show_from: from,
    req_sha256: hash,
  });
  w.ledger({
    kind: 'proposal',
    actor,
    session_id: sessionId,
    what: `asked the owner (${r.class}: ${r.spec.op})`,
    why: 'a decision card waits for a tap or the owner’s own words',
    ref: `proposal:${id}`,
    undoable: false,
    proposal_id: id,
  });
  w.change('proposal', `proposal:${id}`);
}

/** Waiting cards past their time expire: nothing happens, and the ledger says so. */
export function settle(w: Writer): number {
  const ids = store.expireDue(w.db, w.at);
  for (const id of ids) {
    w.ledger({
      kind: 'proposal',
      actor: 'worker',
      what: 'a decision card expired',
      why: 'the owner did not answer within 7 days, so nothing was done',
      ref: `proposal:${id}`,
      undoable: false,
      proposal_id: id,
    });
    w.change('proposal', `proposal:${id}`);
  }
  return ids.length;
}

/** POST /v1/proposals/:id/cancel: the agent that raised it, or the owner. */
export function cancel(w: Writer, c: Caller, id: string, why: string): { status: 'cancelled' } {
  settle(w);
  const p = store.byId(w.db, id);
  if (!p) throw new Fail('not_found');
  if (c.who !== 'D' && p.created_by !== c.actor) throw new Fail('forbidden');
  if (p.status === 'expired') throw new Fail('expired');
  if (p.status !== 'waiting') throw new Fail('already_decided');
  store.decide(w.db, id, { status: 'cancelled', decided_at: w.at });
  w.ledger({
    kind: 'proposal',
    actor: c.actor,
    session_id: c.session_id,
    what: 'cancelled a decision card',
    why,
    ref: `proposal:${id}`,
    undoable: false,
    proposal_id: id,
  });
  w.change('proposal', `proposal:${id}`);
  return { status: 'cancelled' };
}

/** A claim's laws hash (the constitution pin): raise the card it calls for (laws.ts), replacing a
 * card still waiting for an older version of the file. */
export function lawsAtClaim(w: Writer, sha: string, tz: string): void {
  const card = lawsCard(w.db, sha);
  if (!card) return;
  for (const old of store.waiting(w.db).filter((p) => p.op === 'laws.pin')) {
    store.decide(w.db, old.id, { status: 'cancelled', decided_at: w.at });
    w.ledger({
      kind: 'proposal',
      actor: 'worker',
      what: 'cancelled a decision card',
      why: 'the laws file changed again, so a newer card replaces it',
      ref: `proposal:${old.id}`,
      undoable: false,
      proposal_id: old.id,
    });
    w.change('proposal', `proposal:${old.id}`);
  }
  raise(
    w,
    uuidv7(w.at),
    {
      class: 'access',
      question: card.question,
      why: card.why,
      if_ignored: card.if_ignored,
      options: card.options,
      safe: card.safe,
      spec: { v: 1, op: 'laws.pin', args: card.args },
    },
    tz,
  );
}
