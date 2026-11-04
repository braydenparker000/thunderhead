// Replies that show their work and the island line (HOME.md §4.13, §12.1; API.md §11.7, §11.11):
// the chips the chat session gave while working on the owner's message become the reply's
// `meta.using` and leave the presence; a mind never writes `meta.using` itself; `island.show` is
// one sentence of at most 80 characters, never a question, under the phrase lint, undone by the
// phone's `island.clear`.
import { beforeAll, describe, expect, it } from 'vitest';
import type { LedgerEntry, Message, MindPresence, Settings, UndoResponse, Verb } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson, makeAgent, setupOwner } from '../helpers';

let D = '';
let C = '';
const S = 'cse_show0123456789ab';
const as = (token: string) => ({ token, headers: { 'TH-Session': S } });
const say = (body: string) => apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, { token: D, body: { body } });
const reply = (body: Record<string, unknown>, id = uuidv7()) =>
  apiJson<Message>('PUT', `/v1/messages/${id}`, { ...as(C), body });
const status = (body: Record<string, unknown>) => apiJson('POST', '/v1/mind/status', { ...as(C), body });
const presence = async () =>
  ((await apiJson<Settings>('GET', '/v1/settings', { token: D })).body as Record<string, unknown>)[
    'mind.status'
  ] as MindPresence;
/** A fresh set of chips: another state first, since the same state inside 3 s changes nothing. */
const working = async (using: unknown[]) => {
  expect((await status({ state: 'listening' })).status).toBe(204);
  expect((await status({ state: 'working', title: 'Looking through your music', using })).status).toBe(204);
};
const using = [
  { kind: 'fact', id: '0192f0c4-0000-7000-8000-000000000001', label: 'Likes calm music in the evening' },
  { kind: 'song', id: '/music/#pl=evening01', label: 'Evening' },
  { kind: 'file', id: '0192f0c4-0000-7000-8000-0000000000f1', label: 'The packing list' },
  { kind: 'day', id: '2026-11-02', label: 'Monday' },
  { kind: 'search', label: 'Songs for a slow evening' },
];

beforeAll(async () => {
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
  await apiJson('POST', '/v1/mind/brief', {
    ...as(C),
    body: { claim: true, session_id: S, role: 'chat', constitution_sha256: 'none', th_version: '0.1.0' },
  });
});

describe('"How I got this": the reply keeps the chips', () => {
  it('copies the chips given since the owner message into meta.using and clears them', async () => {
    const first = (await say('What should I play tonight?')).body;
    const second = (await say('And something for tomorrow morning?')).body;
    await working(using);
    const r = await reply({ body: 'Something slow from last week.', reply_to: first.id });
    expect(r.status).toBe(201);
    expect(r.body.meta).toMatchObject({ using });
    // The next message waits with none of them; the state and the live line stay.
    const after = await presence();
    expect(after.state).toBe('working');
    expect(after.using ?? []).toEqual([]);
    expect(after.title ?? null).toBeNull();
    const next = await reply({ body: 'A brighter one in the morning.', reply_to: second.id });
    expect(next.body.meta?.using).toBeUndefined();
  });

  it('only a reply to the owner takes them: not a progress line, not a post with no reply_to', async () => {
    const q = (await say('Is the evening list still there?')).body;
    await working(using.slice(0, 1));
    const progress = await reply({ body: 'Checking the list.', kind: 'progress', reply_to: q.id });
    expect(progress.body.meta?.using).toBeUndefined();
    const loose = await reply({ body: 'One moment.' });
    expect(loose.body.meta?.using).toBeUndefined();
    expect((await presence()).using ?? []).toEqual([]);
  });

  it('a mind never sets meta.using itself, and an amended reply keeps the Worker’s', async () => {
    const q = (await say('Which songs did you look at?')).body;
    const own = await reply({ body: 'These.', reply_to: q.id, meta: { using } });
    expect(own.status).toBe(422);
    await working(using.slice(0, 2));
    const r = await reply({ body: 'Two of them.', reply_to: q.id });
    expect(r.body.meta?.using).toHaveLength(2);
    const patch = (meta: Record<string, unknown>) =>
      apiJson<Message>('PATCH', `/v1/messages/${r.body.id}`, { ...as(C), body: { meta } });
    expect((await patch({ using })).status).toBe(422);
    const amended = await patch({ followups: ['Play them now'] });
    expect(amended.status).toBe(200);
    expect(amended.body.meta).toMatchObject({ followups: ['Play them now'], using: using.slice(0, 2) });
  });

  it('checks the new kinds: a file by its id, a day by its date, a search with none', async () => {
    await status({ state: 'listening' });
    const bad = [
      [{ kind: 'day', id: 'monday', label: 'Monday' }],
      [{ kind: 'file', id: 'packing.txt', label: 'The list' }],
      [{ kind: 'search', id: 'evening', label: 'Evening songs' }],
    ];
    for (const u of bad) expect((await status({ state: 'working', using: u })).status, JSON.stringify(u)).toBe(422);
  });
});

describe('island.show: one sentence in the capsule', () => {
  const show = (text: string, id = uuidv7()) =>
    apiJson<Verb>('PUT', `/v1/verbs/${id}`, {
      ...as(C),
      body: { verb: 'island.show', schema: 1, args: { text }, why: 'a word about what plays' },
    });

  it('refuses a question, more than 80 characters, two sentences, the phrase lint and emoji', async () => {
    for (const text of [
      'Is this one too slow?',
      'x'.repeat(81),
      'This one is slow. The next is faster',
      'Great question, this one is slow',
      'A slow one for the evening 🌙',
      'A slow one\nfor the evening',
      '',
    ])
      expect((await show(text)).status, text).toBe(422);
    expect((await show('y'.repeat(80))).status).toBe(201);
  });

  it('the speech setting at silent holds it back like a tile', async () => {
    const speech = (v: string) => apiJson('PATCH', '/v1/settings', { token: D, body: { 'mind.speech': v } });
    expect((await speech('silent')).status).toBe(200);
    const held = await show('A slow one for the evening.');
    expect([held.status, (held.body as unknown as { error: { code: string } }).error.code]).toEqual([
      422,
      'speech_budget',
    ]);
    expect((await speech('as_needed')).status).toBe(200);
  });

  it('island.clear is only ever its undo; the phone reports it and the undo queues it', async () => {
    const tap = await apiJson('PUT', `/v1/verbs/${uuidv7()}`, {
      ...as(C),
      body: { verb: 'island.clear', schema: 1, args: { line: 'line-0001' }, why: 'take the line away' },
    });
    expect(tap.status).toBe(422);
    const id = uuidv7();
    expect((await show('A slower one for the drive home.', id)).status).toBe(201);
    await apiJson('POST', `/v1/verbs/${id}/claim`, { token: D });
    const done = await apiJson<Verb>('POST', `/v1/verbs/${id}/result`, {
      token: D,
      body: {
        ok: true,
        result: { app: 'music', line: 'line-0001' },
        undo: { verb: 'island.clear', schema: 1, args: { line: 'line-0001' } },
      },
    });
    expect(done.body.status).toBe('done');
    const rows = (await apiJson<{ items: LedgerEntry[] }>('GET', '/v1/ledger?limit=10', { token: D })).body.items;
    const ran = rows.find((r) => r.what === 'island.show done') as LedgerEntry;
    expect(ran.undoable).toBe(true);
    expect((await apiJson<UndoResponse>('POST', `/v1/ledger/${ran.id}/undo`, { token: D })).body.status).toBe('queued');
    const pending = (await apiJson<{ items: Verb[] }>('GET', '/v1/verbs/pending', { token: D })).body.items;
    expect(pending.find((v) => v.verb === 'island.clear')?.args).toEqual({ line: 'line-0001' });
  });
});
