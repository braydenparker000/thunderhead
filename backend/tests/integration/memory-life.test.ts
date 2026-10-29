// A fact's life (MEMORY.md §3, §8, §12): remembered with evidence and seen in the next briefing,
// superseded (the newer value wins everywhere), confirmed, fixed and pinned by the owner, muted
// (no surface may cite it), undone, and forgotten: gone from facts, search, the FTS index, the
// briefing and every ledger row's words, with one contentless tombstone left.
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  Fact,
  FactDetail,
  LedgerEntry,
  Page,
  ProfileResponse,
  SearchResponse,
  UndoResponse,
} from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson, coreSql, makeAgent } from '../helpers';
import { addOp, as, brief, CHAT_SESSION, ops, ownerSays, type Principals, principals, reason } from '../memory-helpers';

let P = {} as Principals;
let said = '';
const chat = () => as(P.C, CHAT_SESSION);
const device = () => ({ token: P.D });
const fact = async (id: string) =>
  (await apiJson<Page<Fact>>('GET', '/v1/memory/facts?include_superseded=true&limit=200', device())).body.items.find(
    (f) => f.id === id,
  );
const search = async (q: string) =>
  (await apiJson<SearchResponse>('GET', `/v1/search?q=${encodeURIComponent(q)}&sources=facts`, device())).body.items;
const undo = (token: string, id: string, session = CHAT_SESSION) =>
  apiJson<UndoResponse>('POST', `/v1/ledger/${id}/undo`, { ...as(token, session), body: {} });

beforeAll(async () => {
  P = await principals();
  said = await ownerSays(P.D, 'My practice goal is 100 bpm on the second piece.');
});

describe('remember and recall', () => {
  it("a fact stated today is in the next briefing's profile with its short id, and in search", async () => {
    const op = addOp([`msg:${said}`], { kind: 'goal', text: 'Wants the second piece at 100 bpm' });
    const r = await ops(chat(), [op]);
    expect(r.body.applied[0].fact_id).toBe(op.id);
    const f = await fact(op.id);
    expect(f).toMatchObject({ source: 'user', confidence: 0.95, evidence: [`msg:${said}`], written_by: CHAT_SESSION });
    expect(f?.confidence_now).toBeCloseTo(0.95, 2);
    const b = await brief(P.C, CHAT_SESSION, 'chat');
    expect(b.body.full).toContain(
      `[f:${op.id.replace(/-/g, '').slice(-8)}] Wants the second piece at 100 bpm (0.9, u, since`,
    );
    expect((await search('100 bpm')).map((h) => h.ref)).toContain(`fact:${op.id}`);
    const [row] = await coreSql<{ what: string; why: string; undo_json: string }>(
      'SELECT what, why, undo_json FROM ledger WHERE id = ?',
      r.body.applied[0].ledger_id,
    );
    expect(row.what).toBe('remembered a goal');
    expect(`${row.what} ${row.why} ${row.undo_json}`).not.toContain('100 bpm');
  });

  it('reflex reads no memory: 403 on the memory routes, and its briefing carries none', async () => {
    const R = await makeAgent(P.D, 'mind:reflex');
    expect((await apiJson('GET', '/v1/memory/facts', { token: R })).status).toBe(403);
    expect((await apiJson('GET', '/v1/memory/profile', { token: R })).status).toBe(403);
    const b = await apiJson<{ full: string }>('POST', '/v1/mind/brief', {
      ...as(R, 'cse_memory_reflex'),
      body: {
        claim: true,
        session_id: 'cse_memory_reflex',
        role: 'reflex',
        constitution_sha256: 'none',
        th_version: '0.1.0',
      },
    });
    expect(b.status).toBe(200);
    expect(b.body.full).not.toContain('Wants the second piece at 100 bpm');
    expect(b.body.full).toContain('Not in the reflex briefing');
  });

  it('rules go to section 3 of the core, not the profile', async () => {
    const op = addOp([`msg:${said}`], { kind: 'rule', text: 'Answer in two lines on the phone' });
    expect(await reason(chat(), op)).toBeNull();
    const b = await brief(P.C, CHAT_SESSION, 'chat');
    const three = b.body.core.slice(b.body.core.indexOf('## 3.'), b.body.core.indexOf('## 4.'));
    expect(three).toContain('Answer in two lines on the phone (since');
    expect((await apiJson<ProfileResponse>('GET', '/v1/memory/profile', device())).body.text).not.toContain(
      'two lines',
    );
  });
});

describe('supersede, confirm, and the owner own fixes', () => {
  it('the newer value wins: the old version closes, search and the profile show only the new one', async () => {
    const old = addOp([`msg:${said}`], { kind: 'routine', text: 'Evenings are best for practice' });
    await ops(chat(), [old]);
    const now = await ownerSays(P.D, 'Mornings are best for practice now.');
    const fresh = uuidv7();
    const r = await ops(chat(), [
      {
        op: 'supersede',
        id: old.id,
        reason: 'the owner changed it',
        new: { id: fresh, text: 'Mornings are best for practice', evidence: [`msg:${now}`] },
      },
    ]);
    expect(r.body.applied[0].fact_id).toBe(fresh);
    expect(await fact(old.id)).toMatchObject({ superseded_by: fresh });
    expect(await fact(fresh)).toMatchObject({ kind: 'routine', subject: 'music.evening', superseded_at: null });
    const current = await apiJson<Page<Fact>>('GET', '/v1/memory/facts?kind=routine', device());
    expect(current.body.items.map((f) => f.id)).toEqual([fresh]);
    expect((await search('practice')).map((h) => h.ref)).toEqual([`fact:${fresh}`]);
    const profile = (await apiJson<ProfileResponse>('GET', '/v1/memory/profile', device())).body;
    expect(profile.text).toContain('Mornings are best');
    expect(profile.text).not.toContain('Evenings are best');
    expect(await reason(chat(), { op: 'confirm', id: old.id, evidence: [`msg:${now}`] })).toBe('superseded');
  });

  it("a fact's detail has its earlier versions, its evidence with what was said, and its why", async () => {
    const [f] = (await apiJson<Page<Fact>>('GET', '/v1/memory/facts?kind=routine', device())).body.items;
    const d = await apiJson<FactDetail>('GET', `/v1/memory/facts/${f.id}`, device());
    expect(d.body.fact.id).toBe(f.id);
    expect(d.body.history.map((h) => h.text)).toEqual(['Evenings are best for practice']);
    expect(d.body.evidence[0]).toMatchObject({
      kind: 'msg',
      who: 'owner',
      text: 'Mornings are best for practice now.',
    });
    expect(d.body.why).toBe('the owner changed it');
    expect((await apiJson('GET', `/v1/memory/facts/${uuidv7()}`, device())).status).toBe(404);
    expect((await apiJson('GET', '/v1/memory/facts/not-an-id', device())).status).toBe(422);
  });

  it("confirm resets the clock; confirmed in the owner's words, a guess becomes a user fact", async () => {
    const guess = addOp([`msg:${said}`], {
      source: 'inferred',
      kind: 'goal',
      text: 'Wants to perform the piece',
      tags: ['imported'],
    });
    await ops(chat(), [guess]);
    expect((await fact(guess.id))?.confidence).toBe(0.6);
    await coreSql('UPDATE facts SET last_confirmed = last_confirmed - 86400000 WHERE id = ?', guess.id);
    const yes = await ownerSays(P.D, 'Yes, I want to perform it.');
    const r = await ops(chat(), [{ op: 'confirm', id: guess.id, evidence: [`msg:${yes}`] }]);
    const lifted = await fact(r.body.applied[0].fact_id);
    expect(lifted).toMatchObject({
      source: 'user',
      tags: [],
      evidence: [`msg:${yes}`],
      text: 'Wants to perform the piece',
    });
    expect((await fact(guess.id))?.superseded_by).toBe(lifted?.id);
  });

  it('the Memory page: Add and Fix cite their own ledger row; Pin; a device add is always the owner', async () => {
    const add = addOp([], { text: 'Owns a classical guitar', kind: 'fact' });
    const r = await ops(device(), [add]);
    expect(await fact(add.id)).toMatchObject({
      source: 'user',
      evidence: [`ledger:${r.body.applied[0].ledger_id}`],
      written_by: 'owner',
    });
    expect(await reason(device(), addOp([], { source: 'inferred' }))).toBe('bad_op');
    const fix = uuidv7();
    await ops(device(), [
      { op: 'supersede', id: add.id, new: { id: fix, text: 'Owns two classical guitars', evidence: [] } },
    ]);
    await ops(device(), [{ op: 'pin', id: fix, pinned: true }]);
    expect(await fact(fix)).toMatchObject({ pinned: true, confidence_now: 1, source: 'user' });
  });
});

describe("muting: don't bring this up", () => {
  it('a surface citing a muted fact is refused; private ones too; unknown ones are named', async () => {
    const op = addOp([`msg:${said}`], { text: 'Likes walking by the river' });
    await ops(chat(), [op]);
    const line = (facts: string[]) =>
      apiJson('PUT', '/v1/surfaces/home/line.1', {
        ...as(P.C, CHAT_SESSION),
        body: {
          kind: 'line',
          schema: 1,
          payload: { text: 'A walk by the river later.' },
          why: 'the weather is good',
          topic_key: 'walk',
          facts,
        },
      });
    expect((await line([op.id])).status).toBe(200);
    await ops(device(), [{ op: 'may_raise', id: op.id, value: false }]);
    const muted = await line([op.id]);
    expect(muted.status).toBe(422);
    expect((muted.body as { error: { details: { reason: string } } }).error.details.reason).toBe('muted_fact');
    expect((await line([uuidv7()])).status).toBe(422);
    const secret = addOp([`msg:${said}`], { text: 'Has a private appointment', sensitivity: 1 });
    await ops(chat(), [secret]);
    expect((await line([secret.id])).status).toBe(422);
    expect((await apiJson<ProfileResponse>('GET', '/v1/memory/profile', device())).body.text).toContain(
      'Likes walking by the river (0.9, u, since',
    );
  });
});

describe('undo (ledger)', () => {
  it('undoes an add, a supersede, a confirm and a flag; an older action after a newer one is 409', async () => {
    const a = addOp([`msg:${said}`], { text: 'Drinks coffee at nine' });
    const added = (await ops(chat(), [a])).body.applied[0];
    const next = uuidv7();
    const sup = (
      await ops(chat(), [
        { op: 'supersede', id: a.id, new: { id: next, text: 'Drinks coffee at ten', evidence: [`msg:${said}`] } },
      ])
    ).body.applied[0];
    expect((await undo(P.C, added.ledger_id)).status).toBe(409); // the add is no longer the newest state
    expect((await undo(P.C, sup.ledger_id)).body.status).toBe('undone');
    expect(await fact(a.id)).toMatchObject({ superseded_at: null, superseded_by: null });
    expect(await fact(next)).toMatchObject({ superseded_by: null });
    expect((await fact(next))?.superseded_at).not.toBeNull();
    expect((await undo(P.C, added.ledger_id)).body.status).toBe('undone');
    expect((await fact(a.id))?.superseded_at).not.toBeNull();
    const pin = addOp([`msg:${said}`], { text: 'Reads before sleep' });
    await ops(chat(), [pin]);
    const flagged = (await ops(device(), [{ op: 'pin', id: pin.id, pinned: true }])).body.applied[0];
    expect((await undo(P.D, flagged.ledger_id)).body.status).toBe('undone');
    expect((await fact(pin.id))?.pinned).toBe(false);
  });
});

describe('forget (MEMORY.md §3, §12 acceptance)', () => {
  it('removes every version from facts, search, the FTS index and the briefing; leaves one tombstone', async () => {
    const words = 'Zebrafinch secret hobby';
    const first = addOp([`msg:${said}`], { text: `${words} one` });
    await ops(chat(), [first]);
    const second = uuidv7();
    await ops(chat(), [
      {
        op: 'supersede',
        id: first.id,
        reason: `zebrafinch reason`,
        new: { id: second, text: `${words} two`, evidence: [`msg:${said}`] },
      },
    ]);
    expect((await brief(P.C, CHAT_SESSION, 'chat')).body.full).toContain('Zebrafinch');
    const r = await ops(device(), [{ op: 'forget', id: second }]);
    expect(r.status).toBe(200);
    expect(await coreSql('SELECT id FROM facts WHERE id IN (?, ?)', first.id, second)).toEqual([]);
    expect(await search('zebrafinch')).toEqual([]);
    const blocks = await coreSql<{ block: ArrayBuffer }>('SELECT block FROM facts_fts_data');
    expect(blocks.some((b) => new TextDecoder().decode(b.block).toLowerCase().includes('zebrafinch'))).toBe(false);
    expect((await brief(P.C, CHAT_SESSION, 'chat')).body.full).not.toContain('Zebrafinch');
    const ledger = await coreSql<Record<string, string | null>>('SELECT * FROM ledger');
    expect(JSON.stringify(ledger).toLowerCase()).not.toContain('zebrafinch');
    const tomb = ledger.find((l) => l.id === r.body.applied[0].ledger_id);
    expect(tomb).toMatchObject({ what: 'forgot a preference', undoable: 0 });
    expect(JSON.parse(String(tomb?.op_json))).toMatchObject({
      op: 'memory.forget',
      fact_id: second,
      kind: 'preference',
      versions: 2,
    });
    const page = await apiJson<Page<LedgerEntry>>('GET', '/v1/ledger?limit=50', device());
    const chain = page.body.items.filter((l) => l.ref === `fact:${first.id}` || l.ref === `fact:${second}`);
    expect(chain.length).toBeGreaterThanOrEqual(2);
    for (const l of chain.filter((x) => x.id !== tomb?.id))
      expect(l).toMatchObject({ undoable: false, why: 'the owner forgot this' });
    expect((await undo(P.D, String(tomb?.id))).status).toBe(422);
  });
});
