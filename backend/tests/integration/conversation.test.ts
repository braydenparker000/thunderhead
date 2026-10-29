// The conversation (API.md §11.7): one daily thread made on the day's first message, author and
// origin from the token, idempotent PUTs, the mind's reply settling owner messages, the phrase
// lint and the action chip, night/reflex limited to error posts, search with «» snippets, and the
// change feed seeing every write.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ChangesResponse, Message, SearchResponse, Thread, TodayResponse } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson, makeAgent, setupOwner } from '../helpers';

let D = '';
let C = '';
let N = '';
const mind = (token: string, session = 'cse_test_session_1') => ({ token, headers: { 'TH-Session': session } });

beforeAll(async () => {
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
  N = await makeAgent(D, 'mind:night');
});

const say = (token: string, body: object, id = uuidv7(), extra = {}) =>
  apiJson<Message & { error?: { code: string } }>('PUT', `/v1/messages/${id}`, { token, body, ...extra });

describe('the daily thread', () => {
  it('is null before the first message, then made by it; author and origin come from the token', async () => {
    const before = await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: D });
    expect(before.body.thread).toBeNull();
    const { status, body } = await say(D, { body: 'Hello there' });
    expect(status).toBe(201);
    expect(body).toMatchObject({ author: 'owner', origin: 'owner_device', kind: 'text', body: 'Hello there' });
    const today = await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: C });
    expect(today.body.thread?.id).toBe(body.thread_id);
    expect(today.body.messages.map((m) => m.id)).toContain(body.id);
  });

  it('is idempotent by id: same body 200, other body 409', async () => {
    const id = uuidv7();
    expect((await say(D, { body: 'once' }, id)).status).toBe(201);
    expect((await say(D, { body: 'once' }, id)).status).toBe(200);
    const clash = await say(D, { body: 'twice' }, id);
    expect(clash.status).toBe(409);
    expect(clash.body.error?.code).toBe('conflict');
  });

  it('owners write text or voice; agents may not set the author', async () => {
    expect((await say(D, { body: 'x', kind: 'card' })).status).toBe(422);
    expect((await say(D, { body: 'x', author: 'mind' })).status).toBe(422);
  });

  it("the mind's reply answers the owner message and earlier unanswered ones", async () => {
    const a = (await say(D, { body: 'first question' })).body;
    const b = (await say(D, { body: 'second question' })).body;
    const r = await say(C, { body: 'Both answered.', reply_to: b.id }, uuidv7(), mind(C));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ author: 'mind', origin: 'mind', reply_to: b.id });
    const page = await apiJson<{ items: Message[] }>(
      'GET',
      `/v1/threads/${a.thread_id}/messages?after_seq=0&limit=200`,
      {
        token: D,
      },
    );
    for (const id of [a.id, b.id]) expect(page.body.items.find((m) => m.id === id)?.answered_at).not.toBeNull();
  });

  it('lints the mind (banned phrases, emoji) but never the owner', async () => {
    expect((await say(C, { body: 'Great question. Here it is.' }, uuidv7(), mind(C))).status).toBe(422);
    expect((await say(C, { body: 'Done 🎉' }, uuidv7(), mind(C))).status).toBe(422);
    expect((await say(C, { body: 'Fixed. ```\nsay "great question"\n```' }, uuidv7(), mind(C))).status).toBe(201);
    expect((await say(D, { body: 'Great question! 🎉' })).status).toBe(201);
  });

  it('accepts one well-formed action chip and refuses any other shape', async () => {
    const chip = (c: object) => say(C, { body: 'It is in Music.', meta: { chip: c } }, uuidv7(), mind(C));
    expect((await chip({ label: 'Open in Music', app: 'music', path: '/music/' })).status).toBe(201);
    expect((await chip({ label: 'Open', app: 'music', path: '/guitar/' })).status).toBe(422);
    expect((await chip({ label: 'Open', app: 'mail', path: '/mail/' })).status).toBe(422);
    expect((await chip({ label: 'Open Study', app: 'study', path: '/study/' })).status).toBe(422); // P7
    expect((await chip({ label: 'x'.repeat(29), app: 'music', path: '/music/' })).status).toBe(422);
    expect((await chip({ label: 'Open', app: 'music', path: '/music/', extra: 1 })).status).toBe(422);
  });

  it('night and reflex post only kind error to the system thread', async () => {
    expect((await say(N, { body: 'Night step 3 failed.', kind: 'error', thread_id: 'system' })).status).toBe(201);
    expect((await say(N, { body: 'hello', kind: 'text' })).status).toBe(403);
    expect((await say(C, { body: 'x', kind: 'error', thread_id: 'system' }, uuidv7(), mind(C))).status).toBe(422);
  });

  it('the mind amends only its own posts', async () => {
    const own = (await say(C, { body: 'Working on it.', kind: 'progress' }, uuidv7(), mind(C))).body;
    const patched = await apiJson<Message>('PATCH', `/v1/messages/${own.id}`, {
      token: C,
      body: { body: 'Done. It is live.' },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.body).toBe('Done. It is live.');
    const owners = (await say(D, { body: 'mine' })).body;
    expect((await apiJson('PATCH', `/v1/messages/${owners.id}`, { token: C, body: { body: 'changed' } })).status).toBe(
      404,
    );
  });
});

describe('threads, search and the feed', () => {
  it('titles a thread, refuses continuing an open one, lists threads', async () => {
    const t = (await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: D })).body.thread as Thread;
    const named = await apiJson<Thread>('PATCH', `/v1/threads/${t.id}`, {
      token: C,
      body: { title: 'Getting started' },
    });
    expect(named.body).toMatchObject({ title: 'Getting started', title_source: 'mind' });
    expect((await apiJson('POST', `/v1/threads/${t.id}/continue`, { token: D })).status).toBe(422);
    const list = await apiJson<{ items: Thread[] }>('GET', '/v1/threads?status=open', { token: D });
    expect(list.body.items.map((x) => x.id)).toContain(t.id);
  });

  it('finds messages by word, accent-folded, with the match marked', async () => {
    await say(D, { body: 'The café on Thursday was quiet' });
    const r = await apiJson<SearchResponse>('GET', `/v1/search?q=${encodeURIComponent('cafe thursday')}`, { token: C });
    expect(r.status).toBe(200);
    expect(r.body.items[0]).toMatchObject({ source: 'messages' });
    expect(r.body.items[0].snippet).toMatch(/«café»/);
    expect(r.body.items[0].ref).toMatch(/^msg:/);
    expect((await apiJson('GET', '/v1/search?q=x&sources=nope', { token: C })).status).toBe(422);
    expect((await apiJson('GET', '/v1/search?q=%22%20OR%20*', { token: D })).status).toBe(200);
  });

  it('records every write in the change feed, oldest first, with kinds', async () => {
    const all = await apiJson<ChangesResponse>('GET', '/v1/changes?after=0&limit=500', { token: D });
    const kinds = new Set(all.body.items.map((c) => c.kind));
    expect(kinds.has('message')).toBe(true);
    expect(kinds.has('thread')).toBe(true);
    const seqs = all.body.items.map((c) => c.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    const tail = await apiJson<ChangesResponse>('GET', `/v1/changes?after=${all.body.next_after}`, { token: D });
    expect(tail.body).toMatchObject({ items: [], more: false });
  });
});
