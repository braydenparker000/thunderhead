// The P4 proposal calls of the cost suite (cost.test.ts checks every budget): raising a forget
// card, the waiting list, a tap that approves one (its forget runs in the same commit), one
// approved in the owner's own words, a cancel, and the cron's look for approvals whose Auth step
// never reported. Quiet hours are off, so each card shows at once.
import { runInDurableObject } from 'cloudflare:test';
import type { Message, NewAgentResponse, ProposalsResponse, SignedIn } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import type { Core } from '../../src/objects/core';
import { api, apiJson, core, coreSql, PASSWORD } from '../helpers';

type Cost = (
  name: string,
  fn: () => Promise<Response>,
  status: number,
  stub?: ReturnType<typeof core>,
) => Promise<void>;

export async function proposalCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const pw = `${PASSWORD} new`;
  const d = await grant('192.0.2.251', pw);
  await api('PATCH', '/v1/settings', { ...d, body: { 'quiet.start': '06:30', 'quiet.end': '06:30' } });
  const token = (
    await apiJson<NewAgentResponse>('POST', '/v1/auth/agents', {
      token: d.token,
      body: { name: 'chat-cost-4', role: 'mind:chat', current_password: pw },
    })
  ).body.token;
  const c = { token, headers: { 'TH-Session': 'cse_cost_cards' } };
  await api('GET', '/v1/auth/me', c);
  // The earlier chat session went quiet; this one claims the lease.
  await coreSql("UPDATE leases SET renewed_at = 0 WHERE task = 'chat'");
  const claim = {
    claim: true,
    session_id: 'cse_cost_cards',
    role: 'chat',
    constitution_sha256: 'none',
    th_version: '0.1.0',
  };
  await api('POST', '/v1/mind/brief', { ...c, body: claim });
  const say = async (body: string) =>
    (await apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, { ...d, body: { body } })).body.id;
  const said = await say('Forget the jazz bit, it is wrong.');
  const fact = async () => {
    const id = uuidv7();
    const op = { op: 'add', id, kind: 'preference', text: 'Likes jazz', source: 'user', evidence: [`msg:${said}`] };
    await api('POST', '/v1/memory/ops', { ...c, body: { batch_id: uuidv7(), ops: [op] } });
    return id;
  };
  const card = (id: string) => ({
    class: 'delete',
    question: 'Forget this for good?',
    why: 'You said it was wrong.',
    if_ignored: 'Nothing happens; it stays.',
    options: ['Forget it', 'Keep it'],
    spec: { v: 1, op: 'memory.forget', args: { id } },
  });
  const k = core();
  const [a, b, x] = [uuidv7(), uuidv7(), uuidv7()];
  const [fa, fb, fx] = [await fact(), await fact(), await fact()];
  await cost(
    'PUT /v1/proposals/:id (a forget card) (Core)',
    () => api('PUT', `/v1/proposals/${a}`, { ...c, body: card(fa) }),
    201,
    k,
  );
  await api('PUT', `/v1/proposals/${b}`, { ...c, body: card(fb) });
  await api('PUT', `/v1/proposals/${x}`, { ...c, body: card(fx) });
  await cost('GET /v1/proposals (3 waiting) (Core)', () => api('GET', '/v1/proposals', d), 200, k);
  const items = (await apiJson<ProposalsResponse>('GET', '/v1/proposals', d)).body.items;
  const hash = (id: string) => items.find((p) => p.id === id)?.spec_hash;
  await cost(
    'POST /v1/proposals/:id/decide (a tap; the forget runs) (Core)',
    () => api('POST', `/v1/proposals/${a}/decide`, { ...d, body: { decision: 'approve', spec_hash: hash(a) } }),
    200,
    k,
  );
  await new Promise((r) => setTimeout(r, 5));
  const yes = await say('yes, forget it');
  await cost(
    'POST /v1/proposals/:id/decide (the owner’s words; the forget runs) (Core)',
    () =>
      api('POST', `/v1/proposals/${b}/decide`, {
        ...c,
        body: { decision: 'approve', spec_hash: hash(b), by_message: yes },
      }),
    200,
    k,
  );
  await cost(
    'POST /v1/proposals/:id/cancel (Core)',
    () => api('POST', `/v1/proposals/${x}/cancel`, { ...c, body: { why: 'asked by mistake' } }),
    200,
    k,
  );
  const stale = async () => {
    await runInDurableObject(k as unknown as DurableObjectStub<Core>, (o: Core) => o.staleApprovals());
    return new Response(null, { status: 204 });
  };
  await cost('cron: approvals whose Auth step never reported (none) (Core)', stale, 204, k);
}
