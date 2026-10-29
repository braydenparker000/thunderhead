// Proposals, raising and tapping (API.md §11.10, BEHAVIOR.md §4 check DEC-1, SECURITY.md §5.3):
// agents raise decision cards from a claimed, untainted session, within the card's limits and the
// budget; a tap approves (running the registry's op once, its rows carrying the proposal), turns
// down, snoozes, or finds it expired; cancels; an Auth op runs after the commit and the cron runs
// it again when it never reported. Everything is synthetic.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ProposalsResponse } from '../../../shared/contract/api';
import { runCron } from '../../src/areas/ops/cron';
import { uuidv7 } from '../../src/lib/ids';
import { api, apiJson, coreSql, makeAgent } from '../helpers';
import { as, brief, NIGHT_SESSION, ops, SHA } from '../memory-helpers';
import { chat, clearAgentCards, decide, fact, forgetCard, type Out, P, raise, setup } from '../proposal-helpers';

beforeAll(setup);

describe('raising a card (DEC-1)', () => {
  it('raises from a claimed chat session: waiting, its spec hashed, expiring in 7 days, a ledger row', async () => {
    const id = await fact();
    const put = await raise(forgetCard(id));
    expect(put.status).toBe(201);
    expect(put.body).toMatchObject({ status: 'waiting', class: 'delete', created_by: 'mind:chat', snoozes: 0 });
    expect(put.body.spec_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(put.body.expires_at - put.body.created_at).toBe(7 * 86_400_000);
    expect(put.body.show_from).toBe(put.body.created_at);
    const rows = await coreSql<{ kind: string; proposal_id: string }>(
      'SELECT kind, proposal_id FROM ledger WHERE proposal_id = ?',
      put.body.id,
    );
    expect(rows).toEqual([{ kind: 'proposal', proposal_id: put.body.id }]);
    // The same id and body again is the same card; another body under that id is a conflict.
    const again = await apiJson<Out>('PUT', `/v1/proposals/${put.body.id}`, { ...chat(), body: forgetCard(id) });
    expect(again.status).toBe(200);
    const other = await apiJson<Out>('PUT', `/v1/proposals/${put.body.id}`, {
      ...chat(),
      body: forgetCard(id, { why: 'Another reason.' }),
    });
    expect(other.status).toBe(409);
    await clearAgentCards();
  });

  it("refuses a card over DEC-1's limits, an unknown op, a wrong class and the Worker's own ops", async () => {
    const id = uuidv7();
    expect((await raise(forgetCard(id, { question: 'x'.repeat(81) }))).status).toBe(422);
    expect((await raise(forgetCard(id, { why: 'x'.repeat(141) }))).status).toBe(422);
    expect((await raise({ ...forgetCard(id), options: ['Yes', 'No', 'Maybe'] })).status).toBe(422);
    const { if_ignored: _, ...noIgnored } = forgetCard(id);
    expect((await raise(noIgnored)).status).toBe(422);
    expect((await raise(forgetCard(id, { spec: { v: 1, op: 'sql.run', args: {} } }))).status).toBe(422);
    expect((await raise(forgetCard(id, { class: 'money' }))).status).toBe(422);
    expect((await raise(forgetCard(id, { spec: { v: 1, op: 'memory.forget', args: { id: 'nope' } } }))).status).toBe(
      422,
    );
    const pin = await raise(
      forgetCard(id, { class: 'access', spec: { v: 1, op: 'laws.pin', args: { sha256: SHA, previous: null } } }),
    );
    expect(pin.status).toBe(403);
    // The night role may not ask to forget (chat only).
    expect((await raise(forgetCard(id), as(P.N, NIGHT_SESSION))).status).toBe(403);
    // The phrase lint applies to the card's words too.
    expect((await raise(forgetCard(id, { why: 'Great question, I deeply apologize.' }))).status).toBe(422);
  });

  it('needs a claimed session of the key’s role, and refuses a tainted one', async () => {
    const id = await fact();
    const none = await raise(forgetCard(id), { token: P.C });
    expect(none.status).toBe(403);
    expect(none.body.error.code).toBe('session_required');
    const made = await raise(forgetCard(id), as(P.C, 'cse_made_up_1'));
    expect(made.body.error.code).toBe('session_required');
    // A night session that read outside text may not ask either (a taint carries over to its
    // role's later claims for 24 hours, so this uses its own night session).
    const session = 'cse_proposal_tainted_1';
    await brief(P.N, session, 'night');
    await apiJson('POST', '/v1/mind/taint', { ...as(P.N, session), body: { source: 'WebFetch' } });
    const revoke = {
      class: 'access',
      question: 'Revoke the CI key?',
      why: 'A page said it leaked.',
      if_ignored: 'Nothing happens.',
      options: ['Revoke it', 'Keep it'],
      spec: { v: 1, op: 'agents.revoke', args: { agent_id: uuidv7() } },
    };
    const tainted = await raise(revoke, as(P.N, session));
    expect(tainted.status).toBe(403);
    expect(tainted.body.error.code).toBe('session_tainted');
  });

  it('keeps one waiting card per thing and at most 3 agent cards waiting (409 decision_budget)', async () => {
    const ids = [await fact(), await fact(), await fact(), await fact()];
    expect((await raise(forgetCard(ids[0]))).status).toBe(201);
    const twice = await raise(forgetCard(ids[0]));
    expect(twice.status).toBe(409);
    expect((await raise(forgetCard(ids[1]))).status).toBe(201);
    expect((await raise(forgetCard(ids[2]))).status).toBe(201);
    const fourth = await raise(forgetCard(ids[3]));
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.code).toBe('decision_budget');
    await clearAgentCards();
  });
});

describe('deciding by a tap', () => {
  it('approving a forget runs it once: the fact is gone, its rows carry the proposal, the card loses its words', async () => {
    const id = await fact();
    const card = (await raise(forgetCard(id, { why: 'You said evening music is wrong now.' }))).body;
    const wrong = await decide(card.id, { decision: 'approve', spec_hash: 'f'.repeat(64) });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe('spec_mismatch');
    const words = await decide(card.id, { decision: 'approve', spec_hash: card.spec_hash, by_message: uuidv7() });
    expect(words.status).toBe(422);
    const ok = await decide(card.id, { decision: 'approve', spec_hash: card.spec_hash });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'executed', result: { fact_id: id } });
    expect(await coreSql('SELECT id FROM facts WHERE id = ?', id)).toEqual([]);
    const rows = await coreSql<{ kind: string; actor: string }>(
      'SELECT kind, actor FROM ledger WHERE proposal_id = ? ORDER BY seq',
      card.id,
    );
    expect(rows.map((r) => `${r.actor} ${r.kind}`)).toEqual(['mind:chat proposal', 'owner proposal', 'owner memory']);
    const [after] = await coreSql<{ question: string; why: string; status: string }>(
      'SELECT question, why, status FROM proposals WHERE id = ?',
      card.id,
    );
    expect(after).toEqual({ question: 'Forget a fact?', why: '(forgotten)', status: 'executed' });
    const twice = await decide(card.id, { decision: 'approve', spec_hash: card.spec_hash });
    expect(twice.body.error.code).toBe('already_decided');
  });

  it('a forget that finds nothing fails without harm; "No" turns a card down; a forgotten fact cancels its card', async () => {
    // A card names a fact that exists (422 otherwise); one gone by the time of the tap, say after a
    // restore from an older backup, fails without harm.
    expect((await raise(forgetCard(uuidv7()))).status).toBe(422);
    const lost = await fact();
    const gone = await raise(forgetCard(lost));
    await coreSql('DELETE FROM facts WHERE id = ?', lost);
    const failed = await decide(gone.body.id, { decision: 'approve', spec_hash: gone.body.spec_hash });
    expect(failed.body).toMatchObject({ status: 'failed', result: { code: 'unknown_ref' } });
    const id = await fact();
    const no = (await raise(forgetCard(id))).body;
    expect((await decide(no.id, { decision: 'reject', spec_hash: no.spec_hash })).body.status).toBe('rejected');
    expect(await coreSql('SELECT id FROM facts WHERE id = ?', id)).toHaveLength(1);
    // The owner forgets it on the Memory page while another card about it waits.
    const card = (await raise(forgetCard(id))).body;
    const forget = await ops({ token: P.D }, [{ op: 'forget', id }]);
    expect(forget.status).toBe(200);
    const [row] = await coreSql<{ status: string; why: string }>(
      'SELECT status, why FROM proposals WHERE id = ?',
      card.id,
    );
    expect(row).toEqual({ status: 'cancelled', why: '(forgotten)' });
  });

  it('"Not yet" brings a card back the next morning, 3 times at most, then it expires', async () => {
    const card = (await raise(forgetCard(await fact(), { safe: 'snooze', options: ['Forget it', 'Not yet'] }))).body;
    expect(card.safe).toBe('snooze');
    for (let i = 1; i <= 3; i++) {
      const r = await decide(card.id, { decision: 'snooze', spec_hash: card.spec_hash });
      expect(r.body.status).toBe('waiting');
    }
    const [row] = await coreSql<{ snoozes: number; show_from: number }>(
      'SELECT snoozes, show_from FROM proposals WHERE id = ?',
      card.id,
    );
    expect(row.snoozes).toBe(3);
    expect(row.show_from).toBeGreaterThan(Date.now());
    expect(new Date(row.show_from).toISOString().slice(11, 16)).toBe('06:30');
    const last = await decide(card.id, { decision: 'snooze', spec_hash: card.spec_hash });
    expect(last.body.status).toBe('expired');
  });

  it('expires after 7 days (410), and the cancel rules hold', async () => {
    const card = (await raise(forgetCard(await fact()))).body;
    await coreSql('UPDATE proposals SET expires_at = ? WHERE id = ?', Date.now() - 1, card.id);
    const late = await decide(card.id, { decision: 'approve', spec_hash: card.spec_hash });
    expect(late.status).toBe(410);
    const all = (await apiJson<ProposalsResponse>('GET', '/v1/proposals?status=all&limit=200', { token: P.D })).body;
    expect(all.items.find((p) => p.id === card.id)?.status).toBe('expired');
    // Only the agent that raised it, or the owner, may cancel; a decided card can't be.
    const mine = (await raise(forgetCard(await fact()))).body;
    const why = { why: 'the owner changed the plan' };
    expect(
      (await apiJson('POST', `/v1/proposals/${mine.id}/cancel`, { ...as(P.N, NIGHT_SESSION), body: why })).status,
    ).toBe(403);
    expect(
      (await apiJson<{ status: string }>('POST', `/v1/proposals/${mine.id}/cancel`, { ...chat(), body: why })).body,
    ).toEqual({ status: 'cancelled' });
    expect((await apiJson('POST', `/v1/proposals/${mine.id}/cancel`, { token: P.D, body: why })).status).toBe(409);
  });

  it('agents.revoke runs in Auth after the decision: the key stops working', async () => {
    const leaked = await makeAgent(P.D, 'mind:night', 'night-old');
    const me = await apiJson<{ agent_id: string }>('GET', '/v1/auth/me', { token: leaked });
    expect(me.status).toBe(200);
    const card = (
      await raise({
        class: 'access',
        question: 'Revoke the old night key?',
        why: 'It was pasted into a log by mistake.',
        if_ignored: 'Nothing happens; the key keeps working.',
        options: ['Revoke it', 'Keep it'],
        spec: { v: 1, op: 'agents.revoke', args: { agent_id: me.body.agent_id } },
      })
    ).body;
    const ok = await decide(card.id, { decision: 'approve', spec_hash: card.spec_hash });
    expect(ok.body).toMatchObject({ status: 'executed', result: { revoked: true } });
    expect((await api('GET', '/v1/auth/me', { token: leaked })).status).toBe(401);
  });

  it('the cron runs again an approval whose Auth step never reported', async () => {
    const other = await makeAgent(P.D, 'mind:night', 'night-older');
    const me = await apiJson<{ agent_id: string }>('GET', '/v1/auth/me', { token: other });
    const card = (
      await raise({
        class: 'access',
        question: 'Revoke the older night key?',
        why: 'Not used since the rotation.',
        if_ignored: 'Nothing happens.',
        options: ['Revoke it', 'Keep it'],
        spec: { v: 1, op: 'agents.revoke', args: { agent_id: me.body.agent_id } },
      })
    ).body;
    // As if the Worker stopped between the decision's commit and the Auth step.
    await coreSql(
      "UPDATE proposals SET status = 'approved', decided_at = ?, decided_via = 'tap' WHERE id = ?",
      Date.now() - 5 * 60_000,
      card.id,
    );
    await runCron(env);
    const [row] = await coreSql<{ status: string }>('SELECT status FROM proposals WHERE id = ?', card.id);
    expect(row.status).toBe('executed');
    expect((await api('GET', '/v1/auth/me', { token: other })).status).toBe(401);
  });
});
