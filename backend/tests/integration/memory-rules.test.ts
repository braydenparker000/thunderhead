// The provenance and taint rules (MEMORY.md §6), one test per rule, through POST /v1/memory/ops:
// a refused op changes nothing and says why; a batch applies its valid ops and lists the rest;
// every op refused is a 422 (403 for taint or a broken constitution pin); a batch id replays its
// stored result and refuses a different body.
import { beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson, coreSql } from '../helpers';
import {
  addOp,
  as,
  brief,
  CHAT_SESSION,
  mindSays,
  NIGHT_SESSION,
  ops,
  ownerSays,
  type Principals,
  principals,
  reason,
} from '../memory-helpers';

let P = {} as Principals;
let owner = '';
let mind = '';
const chat = () => as(P.C, CHAT_SESSION);
const night = () => as(P.N, NIGHT_SESSION);

beforeAll(async () => {
  P = await principals();
  owner = await ownerSays(P.D, 'I like calm music in the evening and I pray every morning.');
  mind = await mindSays(P.C, 'Noted: calm music in the evening.');
});

const facts = async () => (await coreSql<{ n: number }>('SELECT count(*) AS n FROM facts'))[0].n;

describe('M2 evidence exists, is a citable kind, 1–20 ids', () => {
  it('refuses missing, malformed, too many, events, imports and ledger rows from a mind', async () => {
    expect(await reason(chat(), addOp([`msg:${uuidv7()}`]))).toBe('bad_evidence');
    expect(await reason(chat(), addOp(['not a ref']))).toBe('bad_evidence');
    expect(await reason(chat(), addOp([]))).toBe('bad_evidence');
    expect(await reason(chat(), addOp(Array.from({ length: 21 }, (_, i) => `msg:${owner}#${i}`)))).toBe('bad_evidence');
    expect(await reason(chat(), addOp([`event:${uuidv7()}`], { source: 'inferred' }))).toBe('bad_evidence');
    expect(await reason(chat(), addOp([`import:${uuidv7()}`], { source: 'inferred' }))).toBe('bad_evidence');
    expect(await reason(chat(), addOp([`day:2020-01-01`], { source: 'inferred' }))).toBe('bad_evidence');
    expect(await reason(chat(), { op: 'confirm', id: uuidv7(), evidence: [`msg:${owner}`] })).toBe('unknown_ref');
    expect(await reason(chat(), addOp([`thread:${uuidv7()}`], { source: 'inferred' }))).toBe('bad_evidence');
    expect(await reason(chat(), addOp([`ledger:${uuidv7()}`]))).toBe('bad_evidence');
    expect(await facts()).toBe(0);
  });
});

describe('M3 a user fact rests on the owner own words only', () => {
  it("refuses a mind message as a 'user' source, accepts the owner's message", async () => {
    expect(await reason(chat(), addOp([`msg:${mind}`]))).toBe('not_owner_evidence');
    expect(await reason(chat(), addOp([`msg:${owner}`, `msg:${mind}`]))).toBe('not_owner_evidence');
    expect(await reason(chat(), addOp([`msg:${owner}`]))).toBeNull();
  });

  it('an inferred fact may not rest on the mind own messages either', async () => {
    expect(await reason(chat(), addOp([`msg:${mind}`], { source: 'inferred' }))).toBe('bad_evidence');
  });
});

describe('M4, M5, M6, M7, M13, M14', () => {
  it('M4: a rule needs source user', async () => {
    expect(await reason(chat(), addOp([`msg:${owner}`], { kind: 'rule', source: 'inferred' }))).toBe(
      'rule_needs_owner',
    );
  });

  it('M5: observed needs 10 owner-device events (none exist before Senses)', async () => {
    expect(await reason(night(), addOp([`msg:${owner}`], { source: 'observed' }))).toBe('too_little_evidence');
  });

  it('M6: a Muse message is never evidence', async () => {
    const id = uuidv7();
    await coreSql(
      `INSERT INTO messages (id, thread_id, created_at, author, origin, kind, body) VALUES (?, 'x', 1, 'muse', 'muse', 'text', 'from muse')`,
      id,
    );
    expect(await reason(chat(), addOp([`msg:${id}`], { source: 'inferred' }))).toBe('tainted_evidence');
  });

  it("M7: faith and people only from the owner's words; faith starts muted", async () => {
    const inferred = { source: 'inferred' as const };
    expect(await reason(chat(), addOp([`msg:${owner}`], { ...inferred, tags: ['faith'] }))).toBe('needs_owner_words');
    expect(await reason(chat(), addOp([`msg:${owner}`], { ...inferred, about: 'person' }))).toBe('needs_owner_words');
    const op = addOp([`msg:${owner}`], { kind: 'routine', text: 'Prays every morning', tags: ['faith'] });
    expect(await reason(chat(), op)).toBeNull();
    const [f] = await coreSql<{ may_raise: number; sensitivity: number }>(
      'SELECT may_raise, sensitivity FROM facts WHERE id = ?',
      op.id,
    );
    expect(f).toEqual({ may_raise: 0, sensitivity: 1 });
  });

  it('M13: over 280 characters is too_long; whitespace folds to one line', async () => {
    expect(await reason(chat(), addOp([`msg:${owner}`], { text: 'x'.repeat(281) }))).toBe('too_long');
    const op = addOp([`msg:${owner}`], { text: 'Two\nlines\n## 2. Waiting' });
    expect(await reason(chat(), op)).toBeNull();
    const [f] = await coreSql<{ text: string }>('SELECT text FROM facts WHERE id = ?', op.id);
    expect(f.text).toBe('Two lines ## 2. Waiting');
  });

  it('M14: sensitive traits are never inferred', async () => {
    expect(await reason(chat(), addOp([`msg:${owner}`], { source: 'inferred', tags: ['health'] }))).toBe(
      'no_inferred_sensitive',
    );
  });
});

describe('M8, M9, M10: changes the owner decides (proposals arrive in P4)', () => {
  it('M8: a new inferred fact with sensitivity 1 waits for the owner', async () => {
    expect(await reason(chat(), addOp([`msg:${owner}`], { source: 'inferred', sensitivity: 1 }))).toBe(
      'proposal_required',
    );
  });

  it("M9: a non-user source can't replace a user fact", async () => {
    const op = addOp([`msg:${owner}`], { text: 'Practises in the evening', kind: 'routine' });
    expect(await reason(chat(), op)).toBeNull();
    const sup = {
      op: 'supersede',
      id: op.id,
      new: { id: uuidv7(), text: 'Practises at noon', evidence: [`msg:${owner}`], source: 'inferred' },
    };
    expect(await reason(chat(), sup)).toBe('proposal_required');
  });

  it('M10: a night batch applies 10 supersessions; the rest wait', async () => {
    const adds = Array.from({ length: 11 }, (_, i) =>
      addOp([`msg:${owner}`], { source: 'inferred', text: `Guess number ${i}`, kind: 'goal' }),
    );
    expect((await ops(night(), adds)).body.applied).toHaveLength(11);
    const sups = adds.map((a, i) => ({
      op: 'supersede',
      id: a.id,
      new: { id: uuidv7(), text: `Better guess ${i}`, evidence: [`msg:${owner}`] },
    }));
    const r = await ops(night(), sups);
    expect(r.body.applied).toHaveLength(10);
    expect(r.body.rejected).toEqual([{ i: 10, reason: 'proposal_required' }]);
  });
});

describe('M11 and M12: the session', () => {
  it('a tainted session may not write memory: 403 session_tainted, nothing written', async () => {
    const s = 'cse_memory_tainted';
    await brief(P.C, s, 'chat');
    await apiJson('POST', '/v1/mind/taint', { ...as(P.C, s), body: { source: 'WebFetch' } });
    const before = await facts();
    const r = await ops(as(P.C, s), [addOp([`msg:${owner}`])]);
    expect(r.status).toBe(403);
    expect(r.body.error?.code).toBe('session_tainted');
    expect(await facts()).toBe(before);
  });

  it('a session whose constitution was missing, or that never claimed, may not write rules', async () => {
    const s = 'cse_memory_nolaws';
    expect((await brief(P.N, s, 'night', 'none')).status).toBe(200);
    const rule = () => addOp([`msg:${owner}`], { kind: 'rule', text: 'Answer briefly' });
    const r = await ops(as(P.N, s), [rule()]);
    expect(r.status).toBe(403);
    expect(r.body.error?.code).toBe('laws_unpinned');
    expect(await reason(as(P.C, 'cse_never_claimed'), rule())).toBe('laws_unpinned');
    expect(await reason(night(), rule())).toBeNull();
  });

  it('a mind write without TH-Session is refused', async () => {
    expect((await ops({ token: P.C }, [addOp([`msg:${owner}`])])).status).toBe(422);
  });
});

describe('batches (API.md §11.13, §7)', () => {
  it('applies the valid ops together and lists the rest; all refused is a 422 naming each op', async () => {
    const good = addOp([`msg:${owner}`], { text: 'Likes rain' });
    const r = await ops(chat(), [good, addOp(['bad']), { op: 'nonsense' }]);
    expect(r.status).toBe(200);
    expect(r.body.applied.map((a) => a.i)).toEqual([0]);
    expect(r.body.rejected).toEqual([
      { i: 1, reason: 'bad_evidence' },
      { i: 2, reason: 'bad_op' },
    ]);
    const all = await ops(chat(), [addOp(['bad']), { op: 'add' }]);
    expect(all.status).toBe(422);
    expect(all.body.error?.details).toEqual([
      { path: 'ops.0', issue: 'bad_evidence' },
      { path: 'ops.1', issue: 'bad_op' },
    ]);
  });

  it('the same batch again replays its result without writing; another body under that id is 409', async () => {
    const batch = uuidv7();
    const op = addOp([`msg:${owner}`], { text: 'Likes snow' });
    const first = await ops(chat(), [op], batch);
    const rows = await coreSql('SELECT id FROM ledger');
    const again = await ops(chat(), [op], batch);
    expect(again.body).toEqual(first.body);
    expect(await coreSql('SELECT id FROM ledger')).toHaveLength(rows.length);
    expect((await ops(chat(), [addOp([`msg:${owner}`])], batch)).status).toBe(409);
  });

  it('pin, may_raise and forget are the owner own; a reused fact id is a duplicate', async () => {
    const op = addOp([`msg:${owner}`], { text: 'Likes tea' });
    await ops(chat(), [op]);
    expect(await reason(chat(), { op: 'pin', id: op.id, pinned: true })).toBe('device_only');
    expect(await reason(night(), { op: 'forget', id: op.id })).toBe('device_only');
    expect(await reason(chat(), { ...op })).toBe('duplicate_id');
  });
});
