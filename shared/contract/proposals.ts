// Proposals as data (SECURITY.md §5.3, API.md §11.10, BEHAVIOR.md §4): one registry for the
// decision cards behind the ask-first classes. It says which ops a proposal may carry, the class
// each is filed under, who may raise it, the shape of its args, where approving it runs, and the
// card's limits. The Worker validates and executes from it (backend/src/areas/proposals), `th
// propose` checks a spec against it before sending, the phone takes the class labels from it and
// CONTRACT.md lists it. Free-form code or SQL is never executed: an op not listed here is refused.
// Only the owner decides: a tap on a signed-in device, or the owner's own words recorded by
// mind:chat and checked by the Worker against the message itself. Plain data, Node-importable.
import * as z from 'zod/mini';
import type { Actor, Id, Json, Ms } from './api';

/** The four ask-first classes, plus `memory_big` (memory changes the Worker won't apply alone,
 * MEMORY.md §6, M8–M10), which is a decision but not ask-first. `label` is the card's class text
 * (HOME.md §3.1). */
export const PROPOSAL_CLASSES = {
  delete: { ask_first: true, label: "Can't be undone" },
  money: { ask_first: true, label: 'Costs money' },
  access: { ask_first: true, label: 'Changes access' },
  reach_people: { ask_first: true, label: 'Reaches someone else' },
  memory_big: { ask_first: false, label: 'Changes what I remember' },
} as const;
export type ProposalClass = keyof typeof PROPOSAL_CLASSES;
export const PROPOSAL_CLASS_NAMES = Object.keys(PROPOSAL_CLASSES) as ProposalClass[];

export const PROPOSAL_LIMITS = {
  question: 80,
  why: 140,
  if_ignored: 140,
  /** Each of the two buttons: the action first, then the safe choice. */
  option: 20,
  /** Waiting at once, counting only those an agent raised (409 decision_budget); the Worker's own
   * cards (the laws pin) are never held back by the budget. */
  waiting: 3,
  /** Days a proposal waits before it expires (nothing happens then). */
  expires_days: 7,
  /** "Not yet" brings a card back the next morning at most this many times; then it expires. */
  snoozes: 3,
  /** The canonical spec JSON, at most. */
  spec_bytes: 8_192,
} as const;

const uuid = z.string().check(z.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
const sha256 = z.string().check(z.regex(/^[0-9a-f]{64}$/));

/** Who may raise an op: mind roles by their route letter, or the Worker itself. */
export type ProposalBy = 'C' | 'N' | 'R' | 'worker';

export interface ProposalOp {
  /** The classes it may be filed under: the mind names one and the Worker refuses the rest. */
  classes: readonly ProposalClass[];
  by: readonly ProposalBy[];
  /** Where approving it runs: inside Core's own commit, or in the Auth object right after it
   * (the proposal is `approved` until that step reports, and the 15-minute cron retries it). */
  runs: 'core' | 'auth';
  /** The thing it acts on, as `[ref kind, arg name]`: one waiting card per thing, and the card's
   * words are scrubbed when the owner forgets what it names. */
  ref: readonly [kind: string, arg: string];
  args: z.ZodMiniType;
  doc: string;
}

export const PROPOSAL_OPS = {
  'memory.forget': {
    classes: ['delete'],
    by: ['C'],
    runs: 'core',
    ref: ['fact', 'id'],
    args: z.strictObject({ id: uuid }),
    doc: "Forget a fact and every version of it for good (the owner's hard delete, MEMORY.md §3).",
  },
  'agents.revoke': {
    classes: ['access'],
    by: ['C', 'N', 'R'],
    runs: 'auth',
    ref: ['agent', 'agent_id'],
    args: z.strictObject({ agent_id: uuid }),
    doc: 'Revoke one agent key; it stops working within 60 s (SECURITY.md §14.2).',
  },
  'laws.pin': {
    classes: ['access'],
    by: ['worker'],
    runs: 'core',
    ref: ['laws', 'sha256'],
    args: z.strictObject({ sha256, previous: z.nullable(sha256) }),
    doc: 'Pin mind/CONSTITUTION.md at this SHA-256; any other version is then reported in every briefing and its rule writes are refused (the constitution pin).',
  },
} as const satisfies Record<string, ProposalOp>;
export type ProposalOpName = keyof typeof PROPOSAL_OPS;

export function proposalOp(name: string): ProposalOp | null {
  return Object.hasOwn(PROPOSAL_OPS, name) ? PROPOSAL_OPS[name as ProposalOpName] : null;
}

// --- wire types (API.md §2, §11.10) --------------------------------------------------------------

export type ProposalStatus = 'waiting' | 'approved' | 'rejected' | 'expired' | 'cancelled' | 'executed' | 'failed';

/** What approving did: a flat record (`{fact_id}`, `{pinned}`, `{revoked}`, or `{code}` when it failed). */
export type ProposalResult = Record<string, string | number | boolean | null>;

export interface ProposalSpec {
  v: 1;
  op: string;
  args: Record<string, Json>;
}

export interface Proposal {
  id: Id;
  created_at: Ms;
  created_by: Actor;
  class: ProposalClass;
  question: string;
  why: string;
  if_ignored: string;
  odds: number | null;
  /** The two buttons' labels: the action, then the safe choice. */
  options: string[];
  /** What the second button does: `reject` ("No": nothing happens) or `snooze` ("Not yet"). */
  safe: 'reject' | 'snooze';
  spec: ProposalSpec;
  /** SHA-256 of the canonical spec: an approval covers exactly this. */
  spec_hash: string;
  status: ProposalStatus;
  expires_at: Ms;
  /** When the card may show: its creation, the end of the quiet hours it was made in, or the
   * morning after a "Not yet". The phone shows a waiting card only from then. */
  show_from: Ms;
  snoozes: number;
  decided_at: Ms | null;
  decided_via: 'tap' | 'words' | null;
  decided_message_id: Id | null;
  result: ProposalResult | null;
}

export interface PutProposalRequest {
  class: ProposalClass;
  question: string;
  why: string;
  if_ignored: string;
  odds?: number;
  options: [string, string];
  /** What the second button does (default `reject`). */
  safe?: 'reject' | 'snooze';
  spec: ProposalSpec;
}

/** `snooze` is the card's "Not yet": it comes back the next morning (at most 3 times). */
export type ProposalDecision = 'approve' | 'reject' | 'snooze';

export interface DecideProposalRequest {
  decision: ProposalDecision;
  spec_hash: string;
  /** The owner's own words: required from mind:chat, refused from a device. */
  by_message?: Id;
}

export interface DecideProposalResponse {
  status: ProposalStatus;
  result?: ProposalResult;
  ledger_id: Id;
}

export interface CancelProposalRequest {
  why: string;
}

export interface ProposalsResponse {
  items: Proposal[];
  next: string | null;
}
