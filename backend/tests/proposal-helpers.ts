// Helpers for the proposal suites: the owner and mind keys with claimed sessions, a fact to forget,
// a forget card, and one-call wrappers to raise, decide and list cards. Everything is synthetic.
import { expect } from 'vitest';
import type {
  DecideProposalResponse,
  ErrorBody,
  Proposal,
  ProposalsResponse,
  PutProposalRequest,
} from '../../shared/contract/api';
import { uuidv7 } from '../src/lib/ids';
import { apiJson } from './helpers';
import { addOp, as, brief, CHAT_SESSION, ops, ownerSays, type Principals, principals, SHA } from './memory-helpers';

export type Out = Proposal & ErrorBody;
export type Call = { token: string; headers?: Record<string, string> };

export const P = {} as Principals;

/** The owner, chat and night keys with claimed sessions, and no quiet hours (a card shows at once). */
export async function setup(): Promise<void> {
  Object.assign(P, await principals());
  current = CHAT_SESSION;
  await apiJson('PATCH', '/v1/settings', { token: P.D, body: { 'quiet.start': '06:30', 'quiet.end': '06:30' } });
}

/** The chat session that holds the lease now (one at a time: a new claim stops the last). */
let current = CHAT_SESSION;
export const chat = () => as(P.C, current);
export async function claimChat(session: string, sha = SHA) {
  await apiJson('POST', '/v1/mind/status', { ...as(P.C, current), body: { state: 'stopping' } });
  current = session;
  const r = await brief(P.C, session, 'chat', sha);
  expect(r.status).toBe(200);
  return r;
}

/** Lets the clock move on, so "after the card" is never the same millisecond. */
export const later = () => new Promise((r) => setTimeout(r, 5));

/** A fact the owner stated, for forget cards. */
export async function fact(): Promise<string> {
  const msg = await ownerSays(P.D, 'I like calm music in the evening');
  const add = addOp([`msg:${msg}`]);
  const r = await ops(chat(), [add]);
  expect(r.status).toBe(200);
  return add.id;
}

export const forgetCard = (id: string, over: Partial<PutProposalRequest> = {}): PutProposalRequest => ({
  class: 'delete',
  question: 'Forget this fact for good?',
  why: 'You said it was wrong.',
  if_ignored: 'Nothing happens; the fact stays.',
  options: ['Forget it', 'Keep it'],
  spec: { v: 1, op: 'memory.forget', args: { id } },
  ...over,
});

export function raise(body: unknown, call: Call = chat(), id = uuidv7()) {
  return apiJson<Out>('PUT', `/v1/proposals/${id}`, { ...call, body });
}

export function decide(id: string, body: object, call: Call = { token: P.D }) {
  return apiJson<DecideProposalResponse & ErrorBody>('POST', `/v1/proposals/${id}/decide`, { ...call, body });
}

export async function waiting(): Promise<Proposal[]> {
  return (await apiJson<ProposalsResponse>('GET', '/v1/proposals', { token: P.D })).body.items;
}

/** Cancels every card an agent raised, so a test starts under the budget. */
export async function clearAgentCards(): Promise<void> {
  for (const p of await waiting())
    if (p.created_by !== 'worker')
      await apiJson('POST', `/v1/proposals/${p.id}/cancel`, {
        token: P.D,
        body: { why: 'clearing for the next test' },
      });
}
