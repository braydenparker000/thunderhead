// Stage A.5 (the review of P4 A+B): an older session id can't be borrowed to step around a newer
// session's taint. A chat claim ends the older chat sessions (they may not take the lease back), and
// a session of any role counts as tainted when another of its role was tainted after it claimed.
// A chat session whose lease merely lapsed, with no newer claim, still writes. Fails on 6ff6b40.
// A file of its own: a taint carries over to the role's later claims.
import { beforeAll, describe, expect, it } from 'vitest';
import { apiJson, coreSql } from '../helpers';
import { addOp, as, brief, NIGHT_SESSION, ops, ownerSays } from '../memory-helpers';
import { claimChat, clearAgentCards, fact, forgetCard, P, raise, setup } from '../proposal-helpers';

beforeAll(setup);

const age = () => coreSql("UPDATE leases SET renewed_at = renewed_at - 600000 WHERE task = 'chat'");

describe('borrowing an older session id', () => {
  it('a chat session whose lease lapsed, with no newer claim, takes it back and writes', async () => {
    const A = 'cse_review_lapsed_a';
    await claimChat(A);
    await age();
    expect((await apiJson('POST', '/v1/mind/status', { ...as(P.C, A), body: { state: 'working' } })).status).toBe(204);
    const said = await ownerSays(P.D, 'I practise scales first');
    expect((await ops(as(P.C, A), [addOp([`msg:${said}`], { text: 'Practises scales first' })])).status).toBe(200);
  });

  it('a newer chat claim ends the older one: its id raises no card, even with the lease free', async () => {
    await clearAgentCards();
    // Session A claimed and simply went quiet (no `th status stopping`): its lease lapsed.
    const A = 'cse_review_quiet_a';
    await claimChat(A);
    const id = await fact();
    await age();
    const B = 'cse_review_tainted_b';
    expect((await brief(P.C, B, 'chat')).status).toBe(200);
    expect((await apiJson('POST', '/v1/mind/taint', { ...as(P.C, B), body: { source: 'WebFetch' } })).status).toBe(200);
    expect((await raise(forgetCard(id), as(P.C, B))).body.error?.code).toBe('session_tainted');
    const [a] = await coreSql<{ ended_at: number | null }>(
      'SELECT ended_at FROM mind_sessions WHERE session_id = ?',
      A,
    );
    expect(a.ended_at).not.toBeNull();
    // B goes quiet too: A's id still may not take the lapsed lease back.
    await age();
    await apiJson('POST', '/v1/mind/status', { ...as(P.C, A), body: { state: 'working' } });
    const spoof = await raise(forgetCard(id), as(P.C, A));
    expect([spoof.status, spoof.body.error?.code]).toEqual([403, 'session_required']);
  });

  it('a night session counts as tainted once another night session was tainted after it claimed', async () => {
    const said = await ownerSays(P.D, 'I like long walks');
    const op = () => addOp([`msg:${said}`], { text: 'Likes long walks' });
    const LATER = 'cse_review_night_later';
    expect((await brief(P.N, LATER, 'night')).status).toBe(200);
    expect((await apiJson('POST', '/v1/mind/taint', { ...as(P.N, LATER), body: { source: 'Read' } })).status).toBe(200);
    // The first night session claimed before that taint and never read outside text itself.
    const r = await ops(as(P.N, NIGHT_SESSION), [op()]);
    expect([r.status, r.body.error?.code]).toEqual([403, 'session_tainted']);
  });
});
