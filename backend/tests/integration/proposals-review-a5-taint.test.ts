// Stage A.5 (the review of P4 A+B): a tainted mind:chat session records no "yes" in the owner's
// words, though the words themselves are the owner's (it may still record a "no", which does
// nothing). Fails on 6ff6b40. A file of its own: a taint carries over to the role's later claims.
import { beforeAll, describe, expect, it } from 'vitest';
import { apiJson } from '../helpers';
import { as, ownerSays } from '../memory-helpers';
import { claimChat, clearAgentCards, decide, fact, forgetCard, later, P, raise, setup } from '../proposal-helpers';

beforeAll(setup);

describe('a tainted chat session and the owner’s words', () => {
  it('may not record a yes; a no still goes through', async () => {
    await clearAgentCards();
    const yes = (await raise(forgetCard(await fact()))).body;
    const no = (await raise(forgetCard(await fact()))).body;
    expect([yes.status, no.status]).toEqual(['waiting', 'waiting']);
    const session = 'cse_review_tainted_1';
    await claimChat(session);
    const t = await apiJson('POST', '/v1/mind/taint', { ...as(P.C, session), body: { source: 'WebFetch' } });
    expect(t.status).toBe(200);
    await later();
    const said = await ownerSays(P.D, 'yes, go ahead');
    const r = await decide(
      yes.id,
      { decision: 'approve', spec_hash: yes.spec_hash, by_message: said },
      as(P.C, session),
    );
    expect([r.status, r.body.error?.code]).toEqual([403, 'session_tainted']);
    await later();
    const nope = await ownerSays(P.D, 'no, keep the other one');
    const n = await decide(no.id, { decision: 'reject', spec_hash: no.spec_hash, by_message: nope }, as(P.C, session));
    expect([n.status, n.body.status]).toEqual([200, 'rejected']);
  });
});
