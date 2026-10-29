// RUNTIME.md §7.1's token scopes, capability by capability, for every role: the rules inside routes
// that the route-scope test (who may call a route at all) can't see ("role tokens enforced", P4). Each key has a claimed session
// of its own role, so a refusal here is the role's, never a missing session. Synthetic data only.
import { beforeAll, describe, expect, it } from 'vitest';
import type { BriefResponse } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson, makeAgent, setupOwner } from '../helpers';
import { addOp, ownerSays } from '../memory-helpers';

type Role = 'D' | 'C' | 'N' | 'R' | 'M' | 'I';
const SESSION: Partial<Record<Role, string>> = { C: 'cse_matrix_chat', N: 'cse_matrix_night', R: 'cse_matrix_reflex' };
const ROLE = { C: 'chat', N: 'night', R: 'reflex' } as const;
const tokens = {} as Record<Role, string>;

beforeAll(async () => {
  tokens.D = (await setupOwner()).token;
  tokens.C = await makeAgent(tokens.D, 'mind:chat');
  tokens.N = await makeAgent(tokens.D, 'mind:night');
  tokens.R = await makeAgent(tokens.D, 'mind:reflex');
  tokens.M = await makeAgent(tokens.D, 'muse');
  tokens.I = await makeAgent(tokens.D, 'ci');
  for (const r of ['C', 'N', 'R'] as const) {
    const s = SESSION[r] as string;
    const b = await apiJson<BriefResponse>('POST', '/v1/mind/brief', {
      token: tokens[r],
      headers: { 'TH-Session': s },
      body: { claim: true, session_id: s, role: ROLE[r], constitution_sha256: 'a'.repeat(64), th_version: '0.1.0' },
    });
    expect(b.status).toBe(200);
  }
});

const as = (r: Role): { token: string; headers: Record<string, string> } => {
  const s = SESSION[r];
  return { token: tokens[r], headers: s ? { 'TH-Session': s } : {} };
};
const status = async (r: Role, method: string, path: string, body?: unknown) =>
  (await apiJson(method, path, { ...as(r), body })).status;

/** Each capability: the request, and the roles that may do it (every other role is refused). */
const CAPABILITIES: { name: string; may: Role[]; call: (r: Role) => Promise<number> }[] = [
  {
    name: 'post a reply in a conversation thread',
    may: ['D', 'C'],
    call: (r) => status(r, 'PUT', `/v1/messages/${uuidv7()}`, { body: 'hello' }),
  },
  {
    name: 'post an error line to the system thread',
    may: ['N', 'R'],
    call: (r) =>
      status(r, 'PUT', `/v1/messages/${uuidv7()}`, {
        kind: 'error',
        thread_id: 'system',
        body: 'night step 3 failed: timeout',
      }),
  },
  {
    name: 'write a home line (surfaces)',
    may: ['C', 'N'],
    call: (r) =>
      status(r, 'PUT', '/v1/surfaces/home/line.1', {
        kind: 'line',
        schema: 1,
        payload: { text: 'Hi.' },
        why: 'a short greeting',
        topic_key: `greeting-${r.toLowerCase()}`,
      }),
  },
  {
    name: 'remember a fact',
    may: ['C', 'N', 'D'],
    call: async (r) => {
      const msg = await ownerSays(tokens.D, 'I like calm music in the evening');
      const op = r === 'D' ? { ...addOp([`msg:${msg}`]), source: 'user' } : addOp([`msg:${msg}`]);
      return status(r, 'POST', '/v1/memory/ops', { batch_id: uuidv7(), ops: [op] });
    },
  },
  { name: 'read memory', may: ['D', 'C', 'N'], call: (r) => status(r, 'GET', '/v1/memory/facts') },
  {
    name: 'raise a decision card',
    may: ['C', 'N', 'R'],
    call: (r) =>
      status(r, 'PUT', `/v1/proposals/${uuidv7()}`, {
        class: 'access',
        question: 'Revoke an old key?',
        why: 'It is no longer used.',
        if_ignored: 'Nothing happens.',
        options: ['Revoke it', 'Keep it'],
        spec: { v: 1, op: 'agents.revoke', args: { agent_id: uuidv7() } },
      }),
  },
  {
    name: 'read the ledger, errors and health',
    may: ['D', 'C', 'N', 'R'],
    call: (r) => status(r, 'GET', '/v1/ledger'),
  },
  { name: 'issue agent keys (auth admin)', may: ['D'], call: (r) => status(r, 'GET', '/v1/auth/agents') },
  { name: 'change settings', may: ['D'], call: (r) => status(r, 'PATCH', '/v1/settings', { 'quiet.start': '22:00' }) },
];

describe('RUNTIME.md §7.1, capability by role', () => {
  for (const cap of CAPABILITIES)
    it(cap.name, async () => {
      for (const r of ['D', 'C', 'N', 'R', 'M', 'I'] as Role[]) {
        const s = await cap.call(r);
        if (cap.may.includes(r)) expect(s, `${r} may ${cap.name}`).toBeLessThan(300);
        // 403 for a role the route refuses; 422 where the route takes the role but not this request
        // (only night and reflex may name the system thread).
        else expect([403, 422], `${r} may not ${cap.name} (${s})`).toContain(s);
      }
      // Each card raised above fills the budget; clear them for the next capability.
      const cards = await apiJson<{ items: { id: string; created_by: string }[] }>('GET', '/v1/proposals', {
        token: tokens.D,
      });
      for (const p of cards.body.items)
        if (p.created_by !== 'worker')
          await apiJson('POST', `/v1/proposals/${p.id}/cancel`, {
            token: tokens.D,
            body: { why: 'clearing the matrix' },
          });
    });

  it('only a device decides by a tap, and only mind:chat records the owner’s words', async () => {
    const put = await apiJson<{ id: string; spec_hash: string }>('PUT', `/v1/proposals/${uuidv7()}`, {
      ...as('C'),
      body: {
        class: 'access',
        question: 'Revoke an unused key?',
        why: 'It has not been used.',
        if_ignored: 'Nothing happens.',
        options: ['Revoke it', 'Keep it'],
        spec: { v: 1, op: 'agents.revoke', args: { agent_id: uuidv7() } },
      },
    });
    const decide = (r: Role, body: object) => status(r, 'POST', `/v1/proposals/${put.body.id}/decide`, body);
    const tap = { decision: 'reject', spec_hash: put.body.spec_hash };
    for (const r of ['N', 'R', 'M', 'I'] as Role[]) expect(await decide(r, tap)).toBe(403);
    expect(await decide('C', tap)).toBe(422); // words only
    expect(await decide('D', { ...tap, by_message: uuidv7() })).toBe(422); // a tap only
    expect(await decide('D', tap)).toBe(200);
  });
});
