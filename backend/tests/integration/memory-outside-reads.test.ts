// Outside text kept back from a clean mind session (MEMORY.md §6 M11f, 2026-11-03): a memory row
// labelled `outside` reaches a session that read no outside text as its id, label and kind only, in
// recall, in every memory read and in the briefing, so it can't write those words down again as the
// owner's; the device reads all of it. A session that asks (`outside=1`) is served the words and
// marked first, so what it writes next is `outside`. A surface may not draw on an outside fact
// either. Storage carries over between the cases, in order: a night session reads outside text and
// writes, the chat reads, and the chat asks last.
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  BriefResponse,
  DayNote,
  Fact,
  FactDetail,
  OpenThread,
  Page,
  SearchResponse,
} from '../../../shared/contract/api';
import { KEPT_BACK } from '../../src/areas/memory/kept';
import { uuidv7 } from '../../src/lib/ids';
import { dayBefore } from '../../src/lib/time';
import { apiJson } from '../helpers';
import {
  addOp,
  as,
  brief,
  CHAT_SESSION,
  freshSession,
  labelled,
  ownerSays,
  type Principals,
  principals,
  SHA,
} from '../memory-helpers';

let P = {} as Principals;
let said = '';
let yesterday = '';
const READ = 'cse_outside_read';
const ids = { fact: '', owner: '', thread: '' };
const chat = (session = CHAT_SESSION) => as(P.C, session);
const outside = () => as(P.N, READ);
const device = () => ({ token: P.D });
const briefOf = async (call: ReturnType<typeof as>, session: string, role: 'chat' | 'night') =>
  (
    await apiJson<BriefResponse>('POST', '/v1/mind/brief', {
      ...call,
      body: { claim: false, session_id: session, role, constitution_sha256: SHA, th_version: '0' },
    })
  ).body;
const search = (q: string, call: { token: string; headers?: Record<string, string> }) =>
  apiJson<SearchResponse>('GET', `/v1/search?${q}`, call);
const memoryHits = (r: SearchResponse) =>
  r.items.filter((h) => h.provenance === 'outside' && (h.source === 'facts' || h.source === 'day_notes'));

beforeAll(async () => {
  P = await principals();
  said = await ownerSays(P.D, 'I like calm music in the evening.');
  yesterday = dayBefore((await briefOf(chat(), CHAT_SESSION, 'chat')).day);
  await brief(P.N, READ, 'night');
  await apiJson('POST', '/v1/mind/taint', { ...outside(), body: { source: 'WebFetch', ref_kind: 'url' } });
  const op = addOp([`msg:${said}`], { text: 'Hates jazz festivals' });
  expect(await labelled(outside(), op)).toBe('outside');
  ids.fact = op.id;
  const own = addOp([`msg:${said}`], { text: 'Likes calm jazz in the evening' });
  expect(await labelled(chat(), own)).toBe('owner');
  ids.owner = own.id;
  const t = await apiJson<OpenThread>('PUT', `/v1/memory/open-threads/${uuidv7()}`, {
    ...outside(),
    body: { text: 'Look up the jazz festival dates', owner: 'mind', evidence: [`msg:${said}`] },
  });
  ids.thread = t.body.id;
  const n = await apiJson<DayNote>('PUT', `/v1/memory/day-notes/${yesterday}`, {
    ...outside(),
    body: { summary: 'The page said the jazz festival is in May.', decisions: [], importance: 3 },
  });
  expect([t.body.provenance, n.body.provenance]).toEqual(['outside', 'outside']);
});

describe('kept back from a session that read no outside text', () => {
  it("recall: an outside fact or day note is its ref and label only; the owner's words come as they are", async () => {
    const r = (await search('q=jazz', chat())).body;
    expect(
      memoryHits(r)
        .map((h) => h.ref)
        .sort(),
    ).toEqual([`day:${yesterday}`, `fact:${ids.fact}`].sort());
    expect(memoryHits(r).every((h) => h.snippet === KEPT_BACK)).toBe(true);
    expect(r.items.find((h) => h.ref === `fact:${ids.owner}`)?.snippet).toContain('jazz');
    expect(JSON.stringify(r)).not.toContain('festival');
  });

  it('every memory read keeps them back too; the device reads them all', async () => {
    const reads = [
      '/v1/memory/facts?limit=200',
      `/v1/memory/facts/${ids.fact}`,
      '/v1/memory/open-threads?status=all',
      `/v1/memory/day-notes?from=${yesterday}&to=${yesterday}`,
    ];
    for (const path of reads) {
      const mind = await apiJson<unknown>('GET', path, chat());
      expect(mind.status, path).toBe(200);
      expect(JSON.stringify(mind.body), path).not.toContain('festival');
      expect(JSON.stringify(mind.body), path).toContain(KEPT_BACK);
      expect(JSON.stringify((await apiJson<unknown>('GET', path, device())).body), path).toContain('festival');
    }
    const list = (await apiJson<Page<Fact>>('GET', '/v1/memory/facts?limit=200', chat())).body.items;
    expect(list.find((f) => f.id === ids.fact)).toMatchObject({
      text: KEPT_BACK,
      subject: null,
      provenance: 'outside',
    });
    expect(list.find((f) => f.id === ids.owner)?.text).toBe('Likes calm jazz in the evening');
    const one = (await apiJson<FactDetail>('GET', `/v1/memory/facts/${ids.fact}`, chat())).body;
    expect([one.fact.text, one.why]).toEqual([KEPT_BACK, null]);
  });

  it('the briefing keeps them back from a clean session and shows them to a labelled one', async () => {
    const clean = await briefOf(chat(), CHAT_SESSION, 'chat');
    expect(clean.provenance).toBe('owner');
    expect(clean.core).toContain(`[${ids.thread}] ${KEPT_BACK} a loose end (mind, since`);
    expect(clean.core).toContain(`Day note ${yesterday} ${KEPT_BACK} (importance 3, v1)`);
    expect(clean.full).not.toContain('festival');
    const labelledBrief = await briefOf(outside(), READ, 'night');
    expect(labelledBrief.full).toContain(`[${ids.thread}] (outside) Look up the jazz festival dates`);
    expect(labelledBrief.full).toContain('The page said the jazz festival is in May.');
  });

  it('a surface may not draw on an outside fact (422 outside_fact); on the owner’s it may', async () => {
    const line = (facts: string[]) =>
      apiJson<{ error?: { details?: { reason?: string } } }>('PUT', '/v1/surfaces/home/line.1', {
        ...chat(),
        body: {
          kind: 'line',
          schema: 1,
          payload: { text: 'Calm music tonight.' },
          why: 'the evening',
          topic_key: 'calm',
          facts,
        },
      });
    const refused = await line([ids.fact]);
    expect([refused.status, refused.body.error?.details?.reason]).toEqual([422, 'outside_fact']);
    expect((await line([ids.owner])).status).toBe(200);
  });
});

describe('asking for it', () => {
  it('needs a named, claimed session; nothing outside in the answer marks nothing', async () => {
    expect((await search('q=jazz&outside=1', { token: P.C })).status).toBe(422);
    expect((await search('q=jazz&outside=1', chat('cse_made_up'))).body).toMatchObject({
      error: { code: 'session_required' },
    });
    expect((await search('q=calm&outside=1', chat())).status).toBe(200);
    expect((await briefOf(chat(), CHAT_SESSION, 'chat')).provenance).toBe('owner');
  });

  it('serves the words and marks the session: what it writes next is outside (recall, then a fact read)', async () => {
    const r = (await search('q=jazz&outside=1', chat())).body;
    expect(memoryHits(r).find((h) => h.ref === `fact:${ids.fact}`)?.snippet).toContain('festival');
    expect((await briefOf(chat(), CHAT_SESSION, 'chat')).provenance).toBe('outside');
    expect(await labelled(chat(), addOp([`msg:${said}`], { text: 'Plans to go to a jazz festival' }))).toBe('outside');
    // `th get /v1/memory/facts/:id outside=1`: a fresh, clean session is marked the same way.
    // The chat session lets go of the lease first (one chat session at a time).
    await apiJson('POST', '/v1/mind/status', { ...chat(), body: { state: 'stopping' } });
    const fresh = await freshSession(P.C, 'chat', 'cse_outside_fresh');
    const one = await apiJson<FactDetail>('GET', `/v1/memory/facts/${ids.fact}?outside=1`, chat(fresh));
    expect(one.body.fact.text).toBe('Hates jazz festivals');
    expect((await briefOf(chat(fresh), fresh, 'chat')).provenance).toBe('outside');
  });
});
