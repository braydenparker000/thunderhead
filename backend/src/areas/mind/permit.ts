// Standing permissions in the Worker (shared/contract/permits.ts, API.md §11.11). Every write the
// mind makes on the owner's things asks `gate` first, inside its own commit and before it writes:
// the action's position is its floor's `ask`, else the owner's `mind.permit.<class>`, else the
// contract's default. `tell` and `quiet` go ahead and come back with the write (so the chat role
// knows whether to say what it did) and on its ledger row. `ask` goes ahead only with a
// `permit.allow` card the owner approved for exactly this call, which the write uses up; without one
// it is refused (403 `proposal_required`) with the card to raise. The owner's own writes are never
// gated. This is a check before the one write path (objects/commit.ts), never a second one.
import {
  PERMIT_POSITIONS,
  type Permit,
  type PermitPosition,
  type PermitRefusal,
  permitKey,
  permitOf,
  permitSetting,
} from '../../../../shared/contract/permits.ts';
import { canonicalJson } from '../../lib/canonical';
import { Fail } from '../../lib/result';
import type { Db } from '../../objects/base';
import { type Caller, isMind } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { sha256Hex } from '../auth/crypto';
import { takeApproval } from '../proposals/approval';
import { getSetting } from '../settings/store';

/** How the mind may take `action` now: a floor always asks; else the owner's setting for its
 * class, or the contract's default while the owner never set one (or set one no longer allowed).
 * One settings row read. An action the contract doesn't list is a bug, not a refusal. */
export function positionFor(db: Db, action: string): PermitPosition {
  const spec = permitOf(action);
  if (!spec) throw new Error(`no standing permission for ${action}`);
  if (spec.floor) return 'ask';
  const set = getSetting(db, permitKey(spec.class));
  const position = (PERMIT_POSITIONS as readonly unknown[]).includes(set)
    ? (set as PermitPosition)
    : (permitSetting(spec.class).default as PermitPosition);
  // An action that takes away something the owner chose is never done quietly (`tell_min`).
  return spec.tell_min && position === 'quiet' ? 'tell' : position;
}

/** What a card approves: the action and its call, canonical, hashed. A call is what the action
 * does (a verb's schema and args, a surface's slot and payload), never its id or its why. */
export const callHash = (action: string, call: unknown) => sha256Hex(canonicalJson({ action, call }));

/** A gated write's permit, and the card that let an `ask` through (for its ledger row). */
export interface Gated {
  permit: Permit;
  proposal_id: string | null;
}

/**
 * Before the mind's write of `action` (`call`: what it does; `by`: the record it makes, `verb:<id>`,
 * …): null for anyone but the mind; else its permit, or a throw. `proposalId` names the approving
 * card (a verb's `proposal_id`, or `TH-Proposal`), read only while the position is `ask`. No caller
 * at all is a Worker of the release before calling for the moment a deploy takes: not the mind.
 */
export function gate(
  w: Writer,
  c: Caller | undefined,
  action: string,
  call: unknown,
  by: string,
  proposalId?: string | null,
): Gated | null {
  if (!c || !isMind(c)) return null;
  const spec = permitOf(action);
  if (!spec) throw new Error(`no standing permission for ${action}`);
  const position = positionFor(w.db, action);
  const permit: Permit = { action, class: spec.class, position };
  if (position !== 'ask') return { permit, proposal_id: null };
  const hash = callHash(action, call);
  const given = proposalId ?? c.proposal_id ?? null;
  const taken = given ? takeApproval(w, given, action, hash, by) : null;
  if (taken?.ok) return { permit, proposal_id: given };
  const refusal: PermitRefusal = {
    reason: 'permit',
    action,
    class: spec.class,
    position: 'ask',
    floor: spec.floor ?? null,
    card: { class: spec.floor ?? 'permit', spec: { v: 1, op: 'permit.allow', args: { action, call: hash } } },
    ...(taken ? { given: taken.why } : {}),
  };
  throw new Fail('proposal_required', refusal);
}

/** A gated write's ledger fields: the position it ran under and the card that allowed it. */
export const ledgerPermit = (g: Gated | null) =>
  g ? { permit: g.permit.position, ...(g.proposal_id ? { proposal_id: g.proposal_id } : {}) } : {};

/** The answer's `permit` field, for the mind only (the owner's answers are unchanged). */
export const withPermit = <T extends object>(value: T, g: Gated | null): T & { permit?: Permit } =>
  g ? { ...value, permit: g.permit } : value;
