// Batch 3 of the verbs (shared/contract/verbs-mind.ts; API.md §11.11): a conversation's title, the
// owner's keep of a fact learned from outside text (always a card: the owner's tap is the keep)
// and a Muse order with the owner's data (the reach-people floor). Per verb: it works, its undo
// puts back what was there, and it is refused where it must be. Everything is synthetic.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Fact, Message, Page, PermitRefusal, Thread } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson, coreSql } from '../helpers';
import { addOp, ops, ownerSays } from '../memory-helpers';
import { chat, clearAgentCards, decide, P, raise, setup } from '../proposal-helpers';
import { doneNow, refusal, settle, undo, verb } from '../verb-helpers';

beforeAll(setup);

/** The card the refusal names, raised and approved by the owner: its id. */
async function approved(r: PermitRefusal): Promise<string> {
  const card = await raise({
    class: r.card.class,
    question: 'May I do this one thing?',
    why: 'It needs your yes.',
    if_ignored: 'Nothing happens.',
    ...(r.card.class === 'permit' ? { odds: 0.7 } : {}),
    options: ['Do it', 'Not now'],
    spec: r.card.spec,
  });
  expect(card.status, JSON.stringify(card.body)).toBe(201);
  const yes = await decide(card.body.id, { decision: 'approve', spec_hash: card.body.spec_hash });
  expect(yes.body.status).toBe('executed');
  return card.body.id;
}
/** Asked, refused with its card, approved, asked again with it. */
async function withCard(name: string, args: object) {
  const no = await verb(name, args);
  expect([no.status, no.body.error?.code], JSON.stringify(no.body)).toEqual([403, 'proposal_required']);
  const id = await approved(refusal(no.body));
  return { refused: refusal(no.body), again: await verb(name, args, { proposal_id: id }) };
}

describe('thread.title', () => {
  it("names a conversation; its undo puts back none; the owner's name and law 8 are refused", async () => {
    const said = await apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, { token: P.D, body: { body: 'Hi there' } });
    const id = said.body.thread_id;
    const thread = async () => (await apiJson<Thread>('GET', `/v1/threads/${id}`, { token: P.D })).body;
    const r = await doneNow(await verb('thread.title', { thread_id: id, title: 'Weekend garden plans' }));
    expect([r.result, r.permit?.position]).toEqual([{ previous: null }, 'quiet']);
    expect([(await thread()).title, (await thread()).title_source]).toEqual(['Weekend garden plans', 'mind']);
    expect((await undo(r.ledger_id)).body.status).toBe('undone');
    expect((await thread()).title).toBeNull();
    const law = await verb('thread.title', { thread_id: id, title: 'Prayer before bed' });
    expect([law.status, (law.body.error.details as { topic: string }).topic]).toEqual([422, 'faith']);
    await apiJson('PUT', `/v1/threads/${id}/title`, { token: P.D, body: { title: 'Mine' } });
    expect((await verb('thread.title', { thread_id: id, title: 'Another name' })).status).toBe(409);
    expect((await verb('thread.title', { thread_id: uuidv7(), title: 'Nowhere' })).status).toBe(404);
    expect((await verb('thread.title', { thread_id: id, title: ' padded' })).status).toBe(422);
  });
});

describe('memory.outside_keep', () => {
  const fact = async (id: string) =>
    (
      await apiJson<Page<Fact>>('GET', '/v1/memory/facts?include_superseded=true&limit=200', { token: P.D })
    ).body.items.find((f) => f.id === id);

  it('always a card, whatever the position; approved, the fact is kept as the owner’s; undo puts it back', async () => {
    const said = await ownerSays(P.D, 'I sometimes read before sleep.');
    const guess = addOp([`msg:${said}`], { source: 'inferred', text: 'Probably reads at night' });
    expect((await ops(chat(), [guess])).body.applied[0].provenance).toBe('outside');
    await settle({ 'mind.permit.outside': 'quiet' });
    const { refused, again } = await withCard('memory.outside_keep', { fact_id: guess.id });
    expect(refused).toMatchObject({ action: 'memory.outside_keep', class: 'outside', floor: null, position: 'ask' });
    const r = await doneNow(again);
    const kept = r.result as { fact_id: string; provenance: string };
    expect(kept.provenance).toBe('owner');
    expect(kept.fact_id).not.toBe(guess.id);
    expect((await fact(kept.fact_id))?.provenance).toBe('owner');
    expect((await fact(guess.id))?.superseded_at).not.toBeNull();
    expect((await undo(r.ledger_id)).body.status).toBe('undone');
    expect((await fact(guess.id))?.superseded_at).toBeNull();
    expect((await fact(guess.id))?.provenance).toBe('outside');
    await settle({ 'mind.permit.outside': 'ask' });
    await clearAgentCards();
  });

  it("refuses a fact that is not outside, and one that doesn't exist", async () => {
    const said = await ownerSays(P.D, 'I like tea in the afternoon.');
    const own = addOp([`msg:${said}`], { text: 'Likes afternoon tea' });
    expect((await ops(chat(), [own])).body.applied[0].provenance).toBe('owner');
    const { again } = await withCard('memory.outside_keep', { fact_id: own.id });
    expect([again.status, (again.body.error.details as { reason: string }).reason]).toEqual([422, 'not_outside']);
    const none = await withCard('memory.outside_keep', { fact_id: uuidv7() });
    expect(none.again.status).toBe(404);
    await clearAgentCards();
  });
});

describe('muse.order_personal', () => {
  const args = {
    title: 'Covers of my evening songs',
    words: 'Find covers of the songs I play most in the evening.',
    app: 'music',
  };

  it('the reach-people floor asks even at quiet; approved, a personal order; undo cancels it', async () => {
    await settle({ 'mind.permit.muse': 'quiet' });
    const { refused, again } = await withCard('muse.order_personal', args);
    expect(refused).toMatchObject({ class: 'muse', floor: 'reach_people', card: { class: 'reach_people' } });
    const r = await doneNow(again);
    expect(r.result).toEqual({ order_id: r.id });
    const row = async () =>
      (
        await coreSql<{ status: string; personal: number; kind: string }>(
          'SELECT status, personal, kind FROM work_orders WHERE id = ?',
          r.id,
        )
      )[0];
    expect(await row()).toEqual({ status: 'queued', personal: 1, kind: 'muse.request' });
    expect((await undo(r.ledger_id)).body.status).toBe('undone');
    expect((await row()).status).toBe('cancelled');
    await settle({ 'mind.permit.muse': 'ask' });
    await clearAgentCards();
  });

  it('law 8 holds over its words, before any card; never-stored words make no order', async () => {
    const law = await verb('muse.order_personal', { ...args, words: 'Find songs about my health this year.' });
    expect([law.status, (law.body.error.details as { topic: string }).topic]).toEqual([422, 'health']);
    const { again } = await withCard('muse.order_personal', { ...args, words: 'My password is Summer2026, use it.' });
    expect(again.status).toBe(422);
    expect((await verb('muse.order_personal', { ...args, words: '' })).status).toBe(422);
    await clearAgentCards();
  });
});
