// Open threads and day notes (API.md §11.13, MEMORY.md §2, §9, §11): written with evidence and a
// ledger row whose undo restores them, idempotent for the same body (a rerun night step never
// makes version 2), shown in the briefing (sections 4, 6 and 9) and found by federated search,
// whose semantic seam fuses one more ranked list.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DayNote, OpenThread, SearchResponse, UndoResponse } from '../../../shared/contract/api';
import { SEMANTIC } from '../../src/areas/search/sources';
import { uuidv7 } from '../../src/lib/ids';
import { dayBefore } from '../../src/lib/time';
import { apiJson, coreSql } from '../helpers';
import { as, brief, CHAT_SESSION, NIGHT_SESSION, ownerSays, type Principals, principals } from '../memory-helpers';

let P = {} as Principals;
let said = '';
const chat = () => as(P.C, CHAT_SESSION);
const night = () => as(P.N, NIGHT_SESSION);
const putThread = (call: object, id: string, body: object) =>
  apiJson<OpenThread>('PUT', `/v1/memory/open-threads/${id}`, { ...call, body });
const putNote = (call: object, day: string, body: object) =>
  apiJson<DayNote>('PUT', `/v1/memory/day-notes/${day}`, { ...call, body });
const ledgerCount = async () => (await coreSql<{ n: number }>('SELECT count(*) AS n FROM ledger'))[0].n;
let today = '';
const yesterday = () => dayBefore(today);

beforeAll(async () => {
  P = await principals();
  said = await ownerSays(P.D, "Let's fix the metronome bug tomorrow.");
  today = (await brief(P.C, CHAT_SESSION, 'chat')).body.day;
});

describe('open threads', () => {
  it('are opened with evidence, idempotent for the same body, closed with done or dropped (why required)', async () => {
    const id = uuidv7();
    const body = { text: 'Fix the metronome bug', owner: 'mind', evidence: [`msg:${said}`], tags: ['agreed'] };
    const r = await putThread(chat(), id, body);
    expect(r.body).toMatchObject({ id, status: 'open', tags: ['agreed'], evidence: [`msg:${said}`] });
    const rows = await ledgerCount();
    expect((await putThread(chat(), id, body)).status).toBe(200);
    expect(await ledgerCount()).toBe(rows);
    expect((await putThread(chat(), uuidv7(), { ...body, evidence: [`msg:${uuidv7()}`] })).status).toBe(422);
    const drop = await apiJson('PATCH', `/v1/memory/open-threads/${id}`, { ...night(), body: { status: 'dropped' } });
    expect(drop.status).toBe(422);
    const done = await apiJson<OpenThread>('PATCH', `/v1/memory/open-threads/${id}`, { ...night(), body: { status: 'done' } });
    expect(done.body).toMatchObject({ status: 'done', closed_at: expect.any(Number) });
    const open = await apiJson<{ items: OpenThread[] }>('GET', '/v1/memory/open-threads', { token: P.D });
    expect(open.body.items.map((t) => t.id)).not.toContain(id);
    const all = await apiJson<{ items: OpenThread[] }>('GET', '/v1/memory/open-threads?status=all', { token: P.D });
    expect(all.body.items.map((t) => t.id)).toContain(id);
  });

  it('show in briefing section 4, mind-owned first then due soonest, with full ids', async () => {
    const mine = uuidv7();
    const theirs = uuidv7();
    await putThread({ token: P.D }, theirs, { text: 'Owner: send the recording', owner: 'owner', evidence: [] });
    await putThread(chat(), mine, { text: 'Mind: tidy the practice list', owner: 'mind', evidence: [`msg:${said}`], due_at: Date.now() + 3_600_000 });
    const b = await brief(P.C, CHAT_SESSION, 'chat');
    const four = b.body.core.slice(b.body.core.indexOf('## 4.'), b.body.core.indexOf('## 5.'));
    expect(four.indexOf(`[${mine}] Mind: tidy`)).toBeGreaterThan(-1);
    expect(four.indexOf(`[${mine}]`)).toBeLessThan(four.indexOf(`[${theirs}]`));
  });

  it('an undo restores the loose end as it was; after a newer change it is 409', async () => {
    const id = uuidv7();
    await putThread(chat(), id, { text: 'Check the tuner', owner: 'mind', evidence: [`msg:${said}`] });
    const closed = await apiJson('PATCH', `/v1/memory/open-threads/${id}`, { ...chat(), body: { status: 'done' } });
    expect(closed.status).toBe(200);
    const [row] = await coreSql<{ id: string }>(
      "SELECT id FROM ledger WHERE ref = ? AND what = 'closed a loose end'",
      `open:${id}`,
    );
    const u = await apiJson<UndoResponse>('POST', `/v1/ledger/${row.id}/undo`, { ...chat(), body: {} });
    expect(u.body.status).toBe('undone');
    const [t] = await coreSql<{ status: string }>('SELECT status FROM open_threads WHERE id = ?', id);
    expect(t.status).toBe('open');
  });
});

describe('day notes', () => {
  it('version 1, the same body again stays 1, a new body is version 2; the owner may edit', async () => {
    const day = yesterday();
    const body = { summary: 'A calm day of practice and one bug report.', decisions: ['Fix the metronome first'], importance: 4 };
    const v1 = await putNote(night(), day, body);
    expect(v1.body).toMatchObject({ day, version: 1, written_by: NIGHT_SESSION, decisions: ['Fix the metronome first'] });
    expect(v1.body.stats).toMatchObject({ messages: expect.any(Number) });
    expect((await putNote(night(), day, body)).body.version).toBe(1);
    expect((await putNote({ token: P.D }, day, { ...body, importance: 5 })).body).toMatchObject({ version: 2, written_by: 'owner' });
    expect((await putNote(chat(), day, body)).status).toBe(403);
    expect((await putNote(night(), '2999-01-01', body)).status).toBe(422);
    const words = { ...body, summary: 'word '.repeat(151) };
    expect((await putNote(night(), day, words)).status).toBe(422);
    const list = await apiJson<{ items: DayNote[] }>('GET', `/v1/memory/day-notes?from=${day}&to=${day}`, { token: P.D });
    expect(list.body.items.map((n) => n.version)).toEqual([2]);
  });

  it("yesterday's note is section 6 of the next briefing, and its line is in section 9", async () => {
    const b = await brief(P.C, CHAT_SESSION, 'chat');
    expect(b.body.full).toMatch(/## 9\. Last 7 days\n.*A calm day of practice/);
    // No day was filed yet, so "yesterday" is the calendar day before the open one.
    const six = b.body.core.slice(b.body.core.indexOf('## 6.'), b.body.core.indexOf('## 7.'));
    expect(six).toContain(`Day note ${yesterday()} (importance 5, v2): A calm day of practice`);
    expect(six).toContain('- decided: Fix the metronome first');
  });
});

describe('federated search over facts and day notes', () => {
  afterEach(() => {
    SEMANTIC.recall = null;
  });

  it('finds day notes; a thread facet leaves facts and day notes out', async () => {
    const all = await apiJson<SearchResponse>('GET', '/v1/search?q=calm%20practice', { token: P.D });
    expect(all.body.items.map((h) => h.source)).toContain('day_notes');
    expect(all.body.items.find((h) => h.source === 'day_notes')?.ref).toBe(`day:${yesterday()}`);
    const [t] = await coreSql<{ thread_id: string }>('SELECT thread_id FROM messages LIMIT 1');
    const one = await apiJson<SearchResponse>('GET', `/v1/search?q=metronome&thread=${t.thread_id}`, { token: P.D });
    expect(one.body.items.every((h) => h.source === 'messages')).toBe(true);
  });

  it('the semantic seam adds one ranked list, fused by rank with the FTS lists', async () => {
    let asked: string[] = [];
    SEMANTIC.recall = {
      async run(_env, q, sources) {
        asked = sources;
        return [{ source: 'facts', ref: 'fact:semantic-only', snippet: `meaning of ${q.text}`, at: 1 }];
      },
    };
    const r = await apiJson<SearchResponse>('GET', '/v1/search?q=metronome', { token: P.D });
    expect(asked).toEqual(['messages', 'facts', 'day_notes']);
    expect(r.body.items.map((h) => h.ref)).toContain('fact:semantic-only');
    expect(r.body.items.find((h) => h.ref === 'fact:semantic-only')?.snippet).toBe('meaning of metronome');
  });
});
