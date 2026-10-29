// Proposals in the owner's own words (BEHAVIOR.md §4 check DEC-2), quiet hours (HOME.md §3.4) and
// the constitution pin (mind/CONSTITUTION.md): mind:chat records the owner's words and the Worker
// checks the message itself; a card made in quiet hours waits for their end; a laws file the owner
// has not approved raises one card and its rule writes are refused. Everything is synthetic.
import { beforeAll, describe, expect, it } from 'vitest';
import type { BriefResponse, LedgerEntry, Proposal } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson, coreSql } from '../helpers';
import { addOp, as, CHAT_SESSION, mindSays, NIGHT_SESSION, ops, ownerSays, SHA } from '../memory-helpers';
import {
  chat,
  claimChat,
  clearAgentCards,
  decide,
  fact,
  forgetCard,
  later,
  P,
  raise,
  setup,
  waiting,
} from '../proposal-helpers';

beforeAll(setup);

describe("deciding in the owner's own words (DEC-2)", () => {
  async function card(): Promise<Proposal> {
    await clearAgentCards();
    return (await raise(forgetCard(await fact()))).body;
  }
  const by = (p: Proposal, message: string, decision = 'approve') => ({
    decision,
    spec_hash: p.spec_hash,
    by_message: message,
  });

  it("approves on the owner's latest device message after the card, and the ledger keeps its ref", async () => {
    const p = await card();
    await later();
    const yes = await ownerSays(P.D, 'yes, forget it');
    const r = await decide(p.id, by(p, yes), chat());
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('executed');
    const [row] = await coreSql<{ decided_via: string; decided_message_id: string }>(
      'SELECT decided_via, decided_message_id FROM proposals WHERE id = ?',
      p.id,
    );
    expect(row).toEqual({ decided_via: 'words', decided_message_id: yes });
    const ledger = await apiJson<{ items: LedgerEntry[] }>('GET', '/v1/ledger?limit=20', { token: P.D });
    expect(ledger.body.items.some((l) => l.ref === `msg:${yes}` && l.proposal_id === p.id)).toBe(true);
  });

  it('refuses words that are not the owner’s latest device message after the card', async () => {
    const before = await ownerSays(P.D, 'yes');
    await later();
    const p = await card();
    await later();
    const refused = async (message: string) => {
      const r = await decide(p.id, by(p, message), chat());
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('not_owner_words');
    };
    await refused(before); // older than the card
    await refused(await mindSays(P.C, 'Shall I forget it?')); // the mind's own words
    const first = await ownerSays(P.D, 'yes');
    await ownerSays(P.D, 'wait, which one?');
    await refused(first); // no longer the owner's latest
    await refused(uuidv7()); // no such message
    // An imported old chat line and a system line look like the owner's but are not.
    const [{ thread_id }] = await coreSql<{ thread_id: string }>('SELECT thread_id FROM messages WHERE id = ?', first);
    for (const [author, origin] of [
      ['owner', 'import'],
      ['system', 'system'],
    ]) {
      const id = uuidv7();
      await coreSql(
        `INSERT INTO messages (id, thread_id, created_at, author, origin, kind, body) VALUES (?, ?, ?, ?, ?, 'text', 'yes')`,
        id,
        thread_id,
        Date.now(),
        author,
        origin,
      );
      await refused(id);
    }
    // Only mind:chat records words; the night key can't decide at all, and needs words to.
    expect((await decide(p.id, by(p, first), as(P.N, NIGHT_SESSION))).status).toBe(403);
    expect((await decide(p.id, { decision: 'approve', spec_hash: p.spec_hash }, chat())).status).toBe(422);
  });

  it('one message answers one card', async () => {
    const a = await card();
    const b = (await raise(forgetCard(await fact()))).body;
    await later();
    const yes = await ownerSays(P.D, 'yes to that');
    expect((await decide(a.id, by(a, yes, 'reject'), chat())).body.status).toBe('rejected');
    const again = await decide(b.id, by(b, yes), chat());
    expect(again.body.error.code).toBe('not_owner_words');
  });
});

describe('quiet hours', () => {
  it('holds a card made in quiet hours until they end, and words before that do not count', async () => {
    await clearAgentCards();
    const said = await ownerSays(P.D, 'yes');
    await later();
    // Quiet from an hour ago until an hour from now (the end never before 06:30), in UTC.
    const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
    const start = hhmm(Date.now() - 3_600_000);
    const soon = hhmm(Date.now() + 3_600_000);
    const end = Date.now() % 86_400_000 >= 23 * 3_600_000 || soon < '06:30' ? '06:30' : soon;
    await apiJson('PATCH', '/v1/settings', { token: P.D, body: { 'quiet.start': start, 'quiet.end': end } });
    try {
      const p = (await raise(forgetCard(await fact()))).body;
      expect(p.show_from).toBeGreaterThan(p.created_at);
      expect(hhmm(p.show_from)).toBe(end);
      const r = await decide(p.id, { decision: 'approve', spec_hash: p.spec_hash, by_message: said }, chat());
      expect(r.body.error.code).toBe('not_owner_words');
    } finally {
      await apiJson('PATCH', '/v1/settings', { token: P.D, body: { 'quiet.start': '06:30', 'quiet.end': '06:30' } });
    }
    const early = await apiJson('PATCH', '/v1/settings', { token: P.D, body: { 'quiet.end': '06:00' } });
    expect(early.status).toBe(422);
  });
});

describe('the constitution pin', () => {
  const OTHER = 'b'.repeat(64);
  const lawsLine = (b: BriefResponse) => b.core.split('\n').find((l) => l.startsWith('laws:')) ?? '';
  const lawsCards = async () => (await waiting()).filter((p) => p.spec.op === 'laws.pin');

  it('asks the owner to pin the first version, once; a tap pins it', async () => {
    // principals() claimed with SHA, so the first card already waits.
    const [first] = await lawsCards();
    expect(first).toMatchObject({
      class: 'access',
      created_by: 'worker',
      spec: { args: { sha256: SHA, previous: null } },
    });
    const again = await claimChat(CHAT_SESSION);
    expect(lawsLine(again.body)).toMatch(/^laws: not pinned \(a card waits for the owner; sha256 /);
    expect(await lawsCards()).toHaveLength(1);
    const ok = await decide(first.id, { decision: 'approve', spec_hash: first.spec_hash });
    expect(ok.body).toMatchObject({ status: 'executed', result: { pinned: SHA } });
    expect(lawsLine((await claimChat(CHAT_SESSION)).body)).toMatch(/^laws: pinned/);
  });

  it('another version raises one card and refuses its rule writes until the owner keeps it', async () => {
    const session = 'cse_laws_changed_1';
    const b = await claimChat(session, OTHER);
    expect(lawsLine(b.body)).toMatch(/^laws: CHANGED, NOT APPROVED/);
    const cards = await lawsCards();
    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('The laws file changed without your OK. Keep the change?');
    const msg = await ownerSays(P.D, 'From now on, no practice reminders after ten');
    const rule = addOp([`msg:${msg}`], {
      kind: 'rule',
      subject: 'practice.reminders',
      text: 'No practice reminders after 22:00',
    });
    const refused = await ops(as(P.C, session), [rule]);
    expect(refused.body.error?.code).toBe('laws_unpinned');
    await decide(cards[0].id, { decision: 'approve', spec_hash: cards[0].spec_hash });
    expect(lawsLine((await claimChat(session, OTHER)).body)).toMatch(/^laws: pinned/);
    expect((await ops(as(P.C, session), [{ ...rule, id: uuidv7() }])).status).toBe(200);
  });

  it('"Restore it" is never asked again for that text, and the briefing says to restore it', async () => {
    const THIRD = 'c'.repeat(64);
    const session = 'cse_laws_third_1';
    await claimChat(session, THIRD);
    const [card] = await lawsCards();
    expect(card.spec.args.sha256).toBe(THIRD);
    await decide(card.id, { decision: 'reject', spec_hash: card.spec_hash });
    const again = await claimChat(session, THIRD);
    expect(lawsLine(again.body)).toMatch(/restore/);
    expect(await lawsCards()).toHaveLength(0);
  });
});
