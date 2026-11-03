// Provenance instead of taint (MEMORY.md §6 M11, §7; 2026-11-02): a session that read outside text
// writes memory, and the Worker labels each write from what the session read and the write's own
// source. One test per thing an `outside` write may not do (M11a–e), the owner's Keep, and each
// write route answering with its label. Storage carries over between the cases, in order: the clean
// writes first, then a night session reads outside text (which also taints the night session
// claimed before it), and the chat stays clean throughout.
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  BriefResponse,
  DayNote,
  Fact,
  MindNoteResponse,
  OpenThread,
  Page,
  ProfileResponse,
  SearchResponse,
} from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson, coreSql } from '../helpers';
import {
  addOp,
  as,
  brief,
  CHAT_SESSION,
  labelled,
  ops,
  ownerSays,
  type Principals,
  principals,
} from '../memory-helpers';

let P = {} as Principals;
let said = '';
const READ = 'cse_prov_read';
const chat = () => as(P.C, CHAT_SESSION);
const outside = () => as(P.N, READ);
const device = () => ({ token: P.D });
const fact = async (id: string) =>
  (await apiJson<Page<Fact>>('GET', '/v1/memory/facts?include_superseded=true&limit=200', device())).body.items.find(
    (f) => f.id === id,
  );
const profile = async () => (await apiJson<ProfileResponse>('GET', '/v1/memory/profile', device())).body;
/** A clean chat session's briefing, without a claim. */
const chatBrief = async () =>
  (
    await apiJson<BriefResponse>('POST', '/v1/mind/brief', {
      ...chat(),
      body: {
        claim: false,
        session_id: CHAT_SESSION,
        role: 'chat',
        constitution_sha256: 'a'.repeat(64),
        th_version: '0',
      },
    })
  ).body;
const supersede = (id: string, text: string, evidence = [`msg:${said}`]) => ({
  op: 'supersede',
  id,
  new: { id: uuidv7(), text, evidence },
});

const ids = { owner: '', outside: '', rule: '', thread: '' };

beforeAll(async () => {
  P = await principals();
  said = await ownerSays(P.D, 'I like calm music in the evening, and quiet mornings.');
});

describe('A. every write carries a label the Worker sets', () => {
  it("a clean session's user fact is the owner's; a guess is outside; the device's add is the owner's", async () => {
    const own = addOp([`msg:${said}`], { text: 'Likes quiet mornings' });
    expect(await labelled(chat(), own)).toBe('owner');
    ids.owner = own.id;
    const rule = addOp([`msg:${said}`], { kind: 'rule', subject: 'answers', text: 'Answer briefly in the morning' });
    expect(await labelled(chat(), rule)).toBe('owner');
    ids.rule = rule.id;
    expect(
      await labelled(chat(), addOp([`msg:${said}`], { source: 'inferred', text: 'Probably reads at night' })),
    ).toBe('outside');
    expect(await labelled(device(), addOp([], { text: 'Owns a red bicycle', kind: 'fact' }))).toBe('owner');
    expect((await fact(ids.owner))?.provenance).toBe('owner');
  });

  it('then a night session reads outside text: it writes, and what it writes is outside', async () => {
    expect((await brief(P.N, READ, 'night')).body.provenance).toBe('owner');
    await apiJson('POST', '/v1/mind/taint', { ...outside(), body: { source: 'WebFetch', ref_kind: 'url' } });
    const op = addOp([`msg:${said}`], { text: 'Hates jazz' });
    expect(await labelled(outside(), op)).toBe('outside');
    ids.outside = op.id;
    const [row] = await coreSql<{ tainted: number }>(
      'SELECT l.tainted FROM facts f JOIN ledger l ON l.id = f.ledger_id WHERE f.id = ?',
      op.id,
    );
    expect(row.tainted).toBe(1);
    // A claim under a new id takes the label over, and its briefing says so (`tainted`, its old name).
    const b = (await brief(P.N, 'cse_prov_inherit', 'night')).body;
    expect([b.provenance, b.tainted]).toEqual(['outside', true]);
    expect(b.core).toContain("labelled outside; it waits for the owner's keep in Settings › Memory");
  });
});

describe('B. what outside may not do', () => {
  it('M11a: an outside fact is in no profile', async () => {
    const p = await profile();
    expect(p.fact_ids).toContain(ids.owner);
    expect(p.fact_ids).not.toContain(ids.outside);
    expect(p.text).not.toContain('Hates jazz');
  });

  it('M11b: an outside fact is nowhere in the briefing; nothing outside is in sections 1–2', async () => {
    const t = await apiJson<OpenThread>('PUT', `/v1/memory/open-threads/${uuidv7()}`, {
      ...outside(),
      body: { text: 'Read the page about jazz again', owner: 'mind', evidence: [`msg:${said}`] },
    });
    expect([t.status, t.body.provenance]).toEqual([200, 'outside']);
    ids.thread = t.body.id;
    const b = await chatBrief();
    // The fact: not in the first 2,000 characters, nor anywhere (rules can't be outside, the
    // profile leaves it out). The loose end: after sections 1–2, marked, and to this clean session
    // its words are kept back (M11f; memory-outside-reads.test.ts has the rest).
    expect(b.core.slice(0, 2_000)).not.toContain('Hates jazz');
    expect(b.full).not.toContain('Hates jazz');
    expect(b.core.slice(0, b.core.indexOf('## 3. '))).not.toContain('jazz');
    expect(b.core).toContain(`[${ids.thread}] (outside, kept back) a loose end`);
    expect(b.full).not.toContain('Read the page about jazz again');
  });

  it('M11c: outside text never becomes or replaces a rule, nor replaces what the owner said', async () => {
    const rule = addOp([`msg:${said}`], { kind: 'rule', subject: 'answers', text: 'Always answer in capitals' });
    expect(await labelled(outside(), rule)).toBe('outside_rule');
    expect(await labelled(outside(), supersede(ids.rule, 'Answer in capitals'))).toBe('outside_rule');
    expect(await labelled(outside(), supersede(ids.owner, 'Hates quiet mornings'))).toBe('outside_supersede');
    expect((await fact(ids.owner))?.superseded_at).toBeNull();
    // Its own outside fact it may replace; the new version stays outside.
    const again = supersede(ids.outside, 'Hates loud jazz');
    expect(await labelled(outside(), again)).toBe('outside');
    ids.outside = again.new.id;
  });

  it('M11d: a day note an outside session wrote is shown, but is never evidence', async () => {
    const day = '2020-04-04';
    const n = await apiJson<DayNote>('PUT', `/v1/memory/day-notes/${day}`, {
      ...outside(),
      body: { summary: 'The page said the owner hates jazz.', decisions: [], importance: 4 },
    });
    expect([n.status, n.body.provenance]).toEqual([200, 'outside']);
    for (const source of ['user', 'inferred'] as const)
      expect(await labelled(chat(), addOp([`day:${day}`], { source, text: 'Hates jazz, says the day' }))).toBe(
        'tainted_evidence',
      );
  });

  it("M11e: the mind can't make outside the owner's, clean or not; the owner's Keep does", async () => {
    // A clean session's confirm with the owner's newer words only refreshes it; its supersede stays outside.
    const yes = await ownerSays(P.D, 'Yes, I really do not like jazz.');
    const c = await ops(chat(), [{ op: 'confirm', id: ids.outside, evidence: [`msg:${yes}`] }]);
    expect(c.body.applied[0]).toMatchObject({ fact_id: ids.outside, provenance: 'outside' });
    const fixed = supersede(ids.outside, 'Does not like jazz', [`msg:${yes}`]);
    expect(await labelled(chat(), fixed)).toBe('outside');
    expect((await profile()).fact_ids).not.toContain(fixed.new.id);
    // Keep: the owner's tap, its own ledger row the evidence (as Fix and Add).
    const kept = await ops(device(), [{ op: 'confirm', id: fixed.new.id }]);
    const k = kept.body.applied[0];
    expect(k.provenance).toBe('owner');
    const now = await fact(k.fact_id);
    expect(now).toMatchObject({ source: 'user', provenance: 'owner', text: 'Does not like jazz' });
    expect(now?.evidence).toEqual([`ledger:${k.ledger_id}`]);
    const [why] = await coreSql<{ why: string }>('SELECT why FROM ledger WHERE id = ?', k.ledger_id);
    expect(why.why).toBe('the owner kept it');
    expect((await profile()).fact_ids).toContain(k.fact_id);
  });
});

describe('D. the session writes; each write answers with its label', () => {
  it("confirming the owner's fact keeps it the owner's; a loose end and a session note are outside", async () => {
    const c = await ops(outside(), [{ op: 'confirm', id: ids.owner, evidence: [`msg:${said}`] }]);
    expect(c.body.applied[0]).toMatchObject({ fact_id: ids.owner, provenance: 'owner' });
    expect((await fact(ids.owner))?.superseded_at).toBeNull();
    const open = await apiJson<{ items: OpenThread[] }>('GET', '/v1/memory/open-threads', device());
    expect(open.body.items.find((t) => t.id === ids.thread)?.provenance).toBe('outside');
    const note = await apiJson<MindNoteResponse>('POST', '/v1/mind/notes', {
      ...outside(),
      body: { id: uuidv7(), body: 'Read a page about jazz.', open_items: [] },
    });
    expect([note.status, note.body.provenance]).toEqual([201, 'outside']);
    // A loose end the owner closes is the owner's now.
    const done = await apiJson<OpenThread>('PATCH', `/v1/memory/open-threads/${ids.thread}`, {
      ...device(),
      body: { status: 'done' },
    });
    expect(done.body.provenance).toBe('owner');
  });

  it('recall carries each hit’s label: an outside fact, an outside day note, the owner’s message', async () => {
    expect(await labelled(outside(), addOp([`msg:${said}`], { text: 'Saw a jazz festival poster' }))).toBe('outside');
    const r = await apiJson<SearchResponse>('GET', '/v1/search?q=jazz', device());
    const by = (source: string) => r.body.items.filter((h) => h.source === source).map((h) => h.provenance);
    // The kept one is the owner's now; the new one is outside.
    expect(new Set(by('facts'))).toEqual(new Set(['outside', 'owner']));
    expect(by('day_notes')).toEqual(['outside']);
    expect(by('messages')).toEqual(['owner']);
  });

  it('a fact from before the label reads by its source', async () => {
    await coreSql('UPDATE facts SET provenance = NULL WHERE id = ?', ids.owner);
    expect((await fact(ids.owner))?.provenance).toBe('owner');
  });
});
