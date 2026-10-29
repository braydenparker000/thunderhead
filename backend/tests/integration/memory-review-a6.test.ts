// Stage A.6, the second review of P3 memory: each finding as a test that fails on 54cd448. A taint
// can't be shed by claiming a new session id (only the session the Worker fired after the taint
// starts clean); forgetting a fact takes its words from the ledger rows of the surfaces that drew
// on it; the reflex briefing carries no session note; a night write over the owner's day-note edit
// says so; and a day note in everyday words is kept. The never-stored rules themselves are unit
// tests (tests/unit/memory-guards.test.ts). Storage carries over between tests here, so the
// untainted cases run before the first taint.
import { beforeAll, describe, expect, it } from 'vitest';
import type { DayNote, LedgerEntry, Page } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { dayBefore, HOUR } from '../../src/lib/time';
import { apiJson, coreSql, makeAgent } from '../helpers';
import {
  addOp,
  as,
  brief,
  CHAT_SESSION,
  firedWake,
  NIGHT_SESSION,
  ops,
  ownerSays,
  type Principals,
  principals,
  reason,
} from '../memory-helpers';

let P = {} as Principals;
let said = '';
let today = '';
const device = () => ({ token: P.D });
const taint = (token: string, session: string) =>
  apiJson('POST', '/v1/mind/taint', { ...as(token, session), body: { source: 'WebFetch' } });
const dayNote = (call: { token: string; headers?: Record<string, string> }, day: string, summary: string) =>
  apiJson<DayNote & { error?: { code: string } }>('PUT', `/v1/memory/day-notes/${day}`, {
    ...call,
    body: { summary, decisions: [], importance: 3 },
  });
const line = (slot: string, facts: string[], why: string) =>
  apiJson('PUT', `/v1/surfaces/home/${slot}`, {
    ...as(P.C, CHAT_SESSION),
    body: { kind: 'line', schema: 1, payload: { text: 'A harbour walk later.' }, why, topic_key: `t-${slot}`, facts },
  });

beforeAll(async () => {
  P = await principals();
  said = await ownerSays(P.D, 'Probe owner words.');
  today = (await brief(P.N, NIGHT_SESSION, 'night')).body.day;
});

describe('before any taint', () => {
  it("the owner's own session, on a day with no tainted session, starts clean", async () => {
    const b = await brief(P.N, 'cse_a6_manual', 'night');
    expect([b.status, b.body.wake?.claim_match, b.body.tainted]).toEqual([200, 'manual', false]);
    expect(b.body.core).not.toContain('taint:');
    expect(await reason(as(P.N, 'cse_a6_manual'), addOp([`msg:${said}`], { text: 'Clean manual write' }))).toBeNull();
  });

  it('forget takes the words of every surface row that drew on the fact, not only the latest', async () => {
    const g = addOp([`msg:${said}`], { text: 'Likes the harbour walk' });
    expect((await ops(as(P.C, CHAT_SESSION), [g])).status).toBe(200);
    expect((await line('line.3', [g.id], 'because of the wombatgrove harbour walk')).status).toBe(200);
    expect((await line('line.3', [g.id], 'the wombatgrove walk again, at dusk')).status).toBe(200);
    expect((await ops(device(), [{ op: 'forget', id: g.id }])).status).toBe(200);
    const page = await apiJson<Page<LedgerEntry>>('GET', '/v1/ledger?limit=50', device());
    expect(page.body.items.some((x) => x.why.includes('wombatgrove'))).toBe(false);
    expect(
      await coreSql("SELECT what FROM ledger WHERE why LIKE '%wombatgrove%' OR undo_json LIKE '%wombatgrove%'"),
    ).toEqual([]);
    const puts = await coreSql<{ why: string; undoable: number }>(
      "SELECT why, undoable FROM ledger WHERE kind = 'arrangement' AND what LIKE 'home/line.3 ←%'",
    );
    expect(puts).toEqual([
      { why: 'it drew on something the owner forgot', undoable: 0 },
      { why: 'it drew on something the owner forgot', undoable: 0 },
    ]);
  });

  it('the reflex briefing carries no session note', async () => {
    const note = { id: uuidv7(), body: 'Session note about the wombatgrove harbour', open_items: [] };
    expect((await apiJson('POST', '/v1/mind/notes', { ...as(P.C, CHAT_SESSION), body: note })).status).toBe(201);
    const R = await makeAgent(P.D, 'mind:reflex');
    const b = await apiJson<{ full: string; core: string }>('POST', '/v1/mind/brief', {
      ...as(R, 'cse_a6_reflex'),
      body: {
        claim: true,
        session_id: 'cse_a6_reflex',
        role: 'reflex',
        constitution_sha256: 'a'.repeat(64),
        th_version: '0.1.0',
      },
    });
    expect(b.status).toBe(200);
    expect(b.body.full).not.toContain('wombatgrove');
    expect(b.body.core).toContain('Session notes: Not in the reflex briefing');
    expect((await brief(P.C, CHAT_SESSION, 'chat')).body.full).toContain('wombatgrove'); // chat still reads it
  });

  it("a night write over the owner's edit keeps the owner's words and says so", async () => {
    const day = dayBefore(today, 5);
    expect((await dayNote(device(), day, 'The owner wrote this.')).status).toBe(200);
    const r = await dayNote(as(P.N, NIGHT_SESSION), day, 'The night tried to rewrite it.');
    expect([r.status, r.body.summary, r.body.kept_owner_edit]).toEqual([200, 'The owner wrote this.', true]);
    const mine = await dayNote(device(), day, 'The owner wrote this, then more.');
    expect(mine.body.kept_owner_edit).toBeUndefined();
  });

  it('a day note in everyday words is kept ("the second pass was cleaner")', async () => {
    const r = await dayNote(
      as(P.N, NIGHT_SESSION),
      dayBefore(today, 6),
      'Practised the piece; the second pass was cleaner.',
    );
    expect([r.status, r.body.error?.code]).toEqual([200, undefined]);
  });
});

describe('a taint holds for its role: a new claim takes it over (24 hours since A.7)', () => {
  it('night: after th taint, a claim with a new id is tainted too (no fact, no day note)', async () => {
    await taint(P.N, NIGHT_SESSION);
    const s = 'cse_a6_minted';
    const b = await brief(P.N, s, 'night');
    expect([b.status, b.body.tainted]).toEqual([200, true]);
    expect(b.body.core).toContain('taint: this session is tainted');
    expect(await reason(as(P.N, s), addOp([`msg:${said}`], { text: 'Night laundered via new claim' }))).toBe(
      'session_tainted',
    );
    const dn = await dayNote(as(P.N, s), dayBefore(today, 3), 'Minted session note.');
    expect([dn.status, dn.body.error?.code]).toEqual([403, 'session_tainted']);
    const [row] = await coreSql<{ taint_source: string }>(
      'SELECT taint_source FROM mind_sessions WHERE session_id = ?',
      s,
    );
    expect(row.taint_source).toBe('inherited:WebFetch');
  });

  it('a loose claim inherits it: the open wake was fired for another session', async () => {
    await firedWake('night', 'session_someone_else');
    const b = await brief(P.N, 'cse_a6_loose', 'night');
    expect([b.body.wake?.claim_match, b.body.tainted]).toEqual(['loose', true]);
  });

  it('a wake fired before the taint does not clean a later claim, even an exact one', async () => {
    await firedWake('night', 'session_a6early', -60_000);
    const b = await brief(P.N, 'cse_a6early', 'night');
    expect([b.body.wake?.claim_match, b.body.tainted]).toEqual(['exact', true]);
  });

  it('the session the Worker fired after the taint starts clean (an exact id match)', async () => {
    await firedWake('night', 'session_a6fresh');
    const s = 'cse_a6fresh';
    const b = await brief(P.N, s, 'night');
    expect([b.body.wake?.claim_match, b.body.tainted]).toEqual(['exact', false]);
    expect(await reason(as(P.N, s), addOp([`msg:${said}`], { text: 'A clean fired session' }))).toBeNull();
    expect((await dayNote(as(P.N, s), dayBefore(today, 4), 'A fired session note.')).status).toBe(200);
  });

  it('chat: stopping and claiming a new id does not shed it', async () => {
    await apiJson('POST', '/v1/mind/status', { ...as(P.C, CHAT_SESSION), body: { state: 'stopping' } });
    const c1 = 'cse_a6_chat_1';
    expect((await brief(P.C, c1, 'chat')).body.tainted).toBe(false);
    await taint(P.C, c1);
    await apiJson('POST', '/v1/mind/status', { ...as(P.C, c1), body: { state: 'stopping' } });
    const c2 = 'cse_a6_chat_2';
    expect((await brief(P.C, c2, 'chat')).body.tainted).toBe(true);
    expect(await reason(as(P.C, c2), addOp([`msg:${said}`], { text: 'Chat laundered via new claim' }))).toBe(
      'session_tainted',
    );
  });

  it("a taint more than 24 hours old doesn't carry over", async () => {
    await coreSql('UPDATE mind_sessions SET tainted_at = ? WHERE tainted_at IS NOT NULL', Date.now() - 25 * HOUR);
    const b = await brief(P.N, 'cse_a6_next_day', 'night');
    expect(b.body.tainted).toBe(false);
  });
});
