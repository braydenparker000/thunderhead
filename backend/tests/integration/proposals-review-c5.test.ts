// Stage C.5, the review of P4 C: each finding on the Worker's side as a test that fails on c4bb02c.
// A session can't approve its own repo.change card in the owner's words: only a tap decides it (the
// twin of the laws card). The eval sandbox never reaches the Auth object: TH-Sandbox on /v1/auth/*
// is refused, and a revoke card raised there names the id it was given instead of looking the key
// up. The hook-side findings are in mind/tests (hook-pre-tool, hook-post-tool). Everything is synthetic.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Proposal } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { api, apiJson, makeAgent } from '../helpers';
import { ownerSays } from '../memory-helpers';
import { chat, clearAgentCards, decide, later, P, raise, setup, waiting } from '../proposal-helpers';

beforeAll(setup);

const repoChange = (base: string) => ({
  class: 'access',
  question: 'Let the mind change the CI workflow?',
  why: 'The test job needs a longer timeout.',
  if_ignored: 'Nothing happens; the workflow stays as it is.',
  options: ['Allow it', 'Not now'],
  spec: { v: 1, op: 'repo.change', args: { paths: ['.github/workflows/ci.yml'], base } },
});
const outcome = (r: { status: number; body: { status?: string; error?: { code: string } } }) =>
  `${r.status} ${r.body.status ?? r.body.error?.code}`;

describe('who decides a repo.change card', () => {
  it('only a tap: the owner’s words through mind:chat are refused, and the card still waits', async () => {
    await clearAgentCards();
    const raised = await raise(repoChange('a'.repeat(40)));
    expect(raised.status).toBe(201);
    const p = raised.body as Proposal;
    await later();
    const yes = await ownerSays(P.D, 'yes, allow it');
    const words = { decision: 'approve', spec_hash: p.spec_hash, by_message: yes };
    expect(outcome(await decide(p.id, words, chat()))).toBe('403 not_owner_words');
    expect((await waiting()).find((x) => x.id === p.id)?.status).toBe('waiting');
    // The owner's tap on a signed-in device decides it.
    expect(outcome(await decide(p.id, { decision: 'approve', spec_hash: p.spec_hash }))).toBe('200 executed');
  });
});

describe('the eval sandbox and the Auth object', () => {
  const sandbox = (token: string, session?: string) => ({
    token,
    headers: { 'TH-Sandbox': 'eval', ...(session ? { 'TH-Session': session } : {}) },
  });

  it('refuses TH-Sandbox on every /v1/auth/ route, even ones the key may call outside it', async () => {
    expect((await api('GET', '/v1/auth/me', { token: P.C })).status).toBe(200);
    expect((await api('GET', '/v1/auth/me', sandbox(P.C))).status).toBe(403);
    const glass = await api('POST', '/v1/auth/breakglass', { ...sandbox(P.C), body: {} });
    expect(glass.status).toBe(403);
  });

  it('a revoke card raised there names the id it was given, not the key Auth knows', async () => {
    expect((await api('POST', '/v1/evals/sandbox', { ...sandbox(P.N), body: { seed: [] } })).status).toBe(200);
    const session = 'cse_eval_chat_c5';
    const claim = await api('POST', '/v1/mind/brief', {
      ...sandbox(P.C, session),
      body: {
        claim: true,
        session_id: session,
        role: 'chat',
        constitution_sha256: 'a'.repeat(64),
        th_version: '0.1.0',
      },
    });
    expect(claim.status).toBe(200);
    const victim = await makeAgent(P.D, 'ci', 'ci-c5');
    const me = await apiJson<{ agent_id: string }>('GET', '/v1/auth/me', { token: victim });
    const card = await apiJson<Proposal>('PUT', `/v1/proposals/${uuidv7()}`, {
      ...sandbox(P.C, session),
      body: {
        class: 'access',
        question: 'Revoke the CI key?',
        why: 'A test asked for it.',
        if_ignored: 'Nothing happens.',
        options: ['Revoke it', 'Keep it'],
        spec: { v: 1, op: 'agents.revoke', args: { agent_id: me.body.agent_id } },
      },
    });
    expect(card.status).toBe(201);
    expect(card.body.target).toMatch(/not looked up: the eval sandbox/);
    expect(card.body.target).not.toContain('ci-c5');
  });
});
