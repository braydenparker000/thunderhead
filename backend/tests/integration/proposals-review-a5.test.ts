// Stage A.5, the review of P4 A+B: each finding as a test that fails on 6ff6b40. Only a tap moves
// the laws pin; a snooze in words uses its message up; only words in the open day's thread count;
// mind:chat records words only from its claimed session; the import key touches no card; forgetting
// a fact scrubs every field of every card that named it; and a card's target line is the Worker's,
// so a revoke card says which key a Yes revokes. The taint cases have files of their own
// (proposals-review-a5-taint, -borrow): a taint carries over to the role's later claims. The
// re-check of d08cbdc added two, each failing there: a message a snooze used stays used when the
// card is cancelled later, and reflex never gets a fact card's words from GET /v1/proposals.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Proposal, ProposalsResponse } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson, coreSql, makeAgent } from '../helpers';
import { ownerSays } from '../memory-helpers';
import { chat, clearAgentCards, decide, fact, forgetCard, later, P, raise, setup, waiting } from '../proposal-helpers';

beforeAll(setup);

const by = (p: Proposal, message: string, decision = 'approve') => ({
  decision,
  spec_hash: p.spec_hash,
  by_message: message,
});
const outcome = (r: { status: number; body: { status?: string; error?: { code: string } } }) =>
  `${r.status} ${r.body.status ?? r.body.error?.code}`;
const forget = (id: string) =>
  apiJson('POST', '/v1/memory/ops', { token: P.D, body: { batch_id: uuidv7(), ops: [{ op: 'forget', id }] } });
const revoke = (agent_id: string) => ({
  class: 'access',
  question: 'Revoke the old night key?',
  why: 'It was pasted into a log by mistake.',
  if_ignored: 'Nothing happens; the key keeps working.',
  options: ['Revoke it', 'Keep it'],
  spec: { v: 1, op: 'agents.revoke', args: { agent_id } },
});

describe('who decides, and with which words', () => {
  it('only a tap decides the laws card: the owner’s words through mind:chat are refused', async () => {
    const laws = (await waiting()).find((p) => p.spec.op === 'laws.pin') as Proposal;
    expect(laws).toBeDefined();
    await later();
    const hello = await ownerSays(P.D, 'good morning');
    expect(outcome(await decide(laws.id, by(laws, hello), chat()))).toBe('403 not_owner_words');
    expect((await waiting()).find((p) => p.id === laws.id)?.status).toBe('waiting');
  });

  it('a snooze in words uses its message: the same words approve no other card', async () => {
    await clearAgentCards();
    const a = (await raise(forgetCard(await fact(), { safe: 'snooze', options: ['Forget it', 'Not yet'] }))).body;
    const b = (await raise(forgetCard(await fact()))).body;
    await later();
    const m = await ownerSays(P.D, 'not yet');
    expect((await decide(a.id, by(a, m, 'snooze'), chat())).body.status).toBe('waiting');
    expect(outcome(await decide(b.id, by(b, m), chat()))).toBe('403 not_owner_words');
    // Cancelling the card it put off doesn't free the message either.
    const x = await apiJson('POST', `/v1/proposals/${a.id}/cancel`, {
      ...chat(),
      body: { why: 'the owner put it off' },
    });
    expect(x.status).toBe(200);
    expect(outcome(await decide(b.id, by(b, m), chat()))).toBe('403 not_owner_words');
  });

  it('a yes left in yesterday’s thread does not count once the owner has written in today’s', async () => {
    await clearAgentCards();
    const p = (await raise(forgetCard(await fact()))).body;
    await later();
    const yes = await ownerSays(P.D, 'yes, forget it');
    const [d] = await coreSql<{ value_json: string }>("SELECT value_json FROM settings WHERE key = 'day.current'");
    // The day rolls (as 60 quiet minutes would roll it); the owner takes it back in the new thread.
    await coreSql("UPDATE settings SET value_json = '\"2099-12-30\"' WHERE key = 'day.current'");
    try {
      await later();
      const no = await ownerSays(P.D, 'wait, no, keep it');
      const threads = await coreSql<{ thread_id: string }>(
        'SELECT thread_id FROM messages WHERE id IN (?, ?)',
        yes,
        no,
      );
      expect(new Set(threads.map((t) => t.thread_id)).size).toBe(2);
      expect(outcome(await decide(p.id, by(p, yes), chat()))).toBe('403 not_owner_words');
    } finally {
      await coreSql("UPDATE settings SET value_json = ? WHERE key = 'day.current'", d.value_json);
    }
  });

  it('mind:chat records words only from its claimed session', async () => {
    await clearAgentCards();
    const p = (await raise(forgetCard(await fact()))).body;
    await later();
    const yes = await ownerSays(P.D, 'yes');
    expect(outcome(await decide(p.id, by(p, yes), { token: P.C }))).toBe('403 session_required');
  });

  it('the one-time import key raises, decides and cancels no card', async () => {
    await clearAgentCards();
    const imp = await makeAgent(P.D, 'mind:chat', 'import-once');
    const call = { token: imp, headers: { 'TH-Session': 'cse_import_run_1' } };
    const p = (await raise(forgetCard(await fact()))).body;
    await later();
    const yes = await ownerSays(P.D, 'yes');
    expect(outcome(await decide(p.id, by(p, yes), call))).toBe('403 forbidden');
    expect(outcome(await raise(forgetCard(await fact()), call))).toBe('403 forbidden');
    const cancel = await apiJson<{ error: { code: string } }>('POST', `/v1/proposals/${p.id}/cancel`, {
      ...call,
      body: { why: 'the import asked to' },
    });
    expect(`${cancel.status} ${cancel.body.error?.code}`).toBe('403 forbidden');
  });
});

describe('what a card names', () => {
  it('forgetting a fact scrubs every field of its card: the question, why, if-ignored, buttons and target', async () => {
    await clearAgentCards();
    const id = await fact();
    const p = (
      await raise(
        forgetCard(id, {
          question: 'Forget that you like calm music?',
          why: 'You said calm music was wrong.',
          if_ignored: 'Nothing happens; calm music stays remembered.',
          options: ['Forget calm music', 'Keep it'],
        }),
      )
    ).body;
    expect(p.status).toBe('waiting');
    expect((await forget(id)).status).toBe(200);
    const [row] = await coreSql('SELECT question, why, if_ignored, options_json FROM proposals WHERE id = ?', p.id);
    expect(JSON.stringify(row)).not.toMatch(/calm music/i);
    expect(await coreSql('SELECT target FROM proposals WHERE id = ?', p.id)).toEqual([{ target: null }]);
  });

  it('…of every card that named it, however many', async () => {
    await clearAgentCards();
    const id = await fact();
    for (let i = 0; i < 21; i++) {
      const p = (await raise(forgetCard(id, { question: `Forget calm music, take ${i}?` }))).body;
      expect(p.status).toBe('waiting');
      await apiJson('POST', `/v1/proposals/${p.id}/cancel`, { token: P.D, body: { why: 'asking again later' } });
    }
    expect((await forget(id)).status).toBe(200);
    const rows = await coreSql<{ question: string }>('SELECT question FROM proposals WHERE ref = ?', `fact:${id}`);
    expect(rows).toHaveLength(21);
    expect(rows.filter((r) => /calm music/.test(r.question))).toEqual([]);
  });

  it('a revoke card names the key a Yes revokes, from Auth; an unknown or revoked key is refused', async () => {
    await clearAgentCards();
    const ci = await makeAgent(P.D, 'ci', 'ci-deploy');
    const me = await apiJson<{ agent_id: string }>('GET', '/v1/auth/me', { token: ci });
    // The agent's words say "the old night key"; the Worker's line says which key it is.
    const card = await raise(revoke(me.body.agent_id));
    expect([card.status, card.body.target]).toEqual([201, 'key ci-deploy (CI)']);
    const ghost = await raise(revoke(uuidv7()));
    expect([ghost.status, ghost.body.error.details]).toEqual([
      422,
      [{ path: 'spec.args.agent_id', issue: 'no active agent key with this id' }],
    ]);
    expect(outcome(await decide(card.body.id, { decision: 'approve', spec_hash: card.body.spec_hash }))).toBe(
      '200 executed',
    );
    expect((await raise(revoke(me.body.agent_id))).status).toBe(422);
    // A forget card names its fact by kind and words; a card for no fact is refused.
    expect((await raise(forgetCard(await fact()))).body.target).toBe('preference: Likes calm music in the evening');
    expect((await raise(forgetCard(uuidv7()))).status).toBe(422);
  });
});

describe('what reflex sees', () => {
  it('a card about a fact reaches reflex without its words or target line', async () => {
    await clearAgentCards();
    const card = (await raise(forgetCard(await fact(), { question: 'Forget that you like calm music?' }))).body;
    const R = await makeAgent(P.D, 'mind:reflex');
    const r = await apiJson<ProposalsResponse>('GET', '/v1/proposals', { token: R });
    const seen = r.body.items.find((p) => p.id === card.id);
    expect(seen).toMatchObject({ status: 'waiting', target: null, options: [] });
    expect(JSON.stringify(seen)).not.toMatch(/calm music/i);
    // The owner's device still sees all of it.
    const mine = (await waiting()).find((p) => p.id === card.id);
    expect(mine?.target).toBe('preference: Likes calm music in the evening');
  });
});
