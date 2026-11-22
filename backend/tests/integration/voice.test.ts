// The voice page (shared/contract/voice.ts, areas/voice): read by the owner and every mind role,
// written by the owner and, with a why, by the chat mind from a clean claimed session; the mind's
// edit is a ledger row whose undo brings back the version before, and a card in today's thread;
// an owner's edit writes no message; restore adds a version; the briefing carries the page right
// after "Now". Synthetic data only.
import { beforeAll, describe, expect, it } from 'vitest';
import type { BriefResponse, Message, TodayResponse } from '../../../shared/contract/api';
import { VOICE_DEFAULT, type VoiceResponse, type VoiceVersion } from '../../../shared/contract/voice.ts';
import { api, apiJson, coreSql, makeAgent } from '../helpers';
import { as, brief, CHAT_SESSION, NIGHT_SESSION, type Principals, principals } from '../memory-helpers';

let P: Principals;
let R: string;
const chat = (s = CHAT_SESSION) => as(P.C, s);
type Answer = VoiceResponse & { error?: { code: string; details?: { path: string; issue: string }[] } };
const read = (call: object) => apiJson<Answer>('GET', '/v1/mind/voice', call);
const put = (call: object, body: object) => apiJson<Answer>('PUT', '/v1/mind/voice', { ...call, body });

beforeAll(async () => {
  P = await principals();
  R = await makeAgent(P.D, 'mind:reflex');
  await apiJson('PATCH', '/v1/settings', { token: P.D, body: { 'owner.tz': 'UTC' } });
});

describe('the voice page', () => {
  it('is the default until written, read by the owner and every mind role, not signed out', async () => {
    for (const call of [{ token: P.D }, chat(), as(P.N, NIGHT_SESSION), { token: R }]) {
      const r = await read(call);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ text: VOICE_DEFAULT, last: null, versions: [] });
    }
    expect((await api('GET', '/v1/mind/voice')).status).toBe(401);
    expect((await put({}, { text: 'Hi' })).status).toBe(401);
    expect((await put(as(P.N, NIGHT_SESSION), { text: 'Short and dry.', why: 'the night tried' })).status).toBe(403);
    expect((await put({ token: R }, { text: 'Short and dry.', why: 'reflex tried this' })).status).toBe(403);
  });

  it('holds its limits: 1 to 4,000 characters, newlines only, a why of 8 to 200 from the mind', async () => {
    const issue = (r: { body: Answer }) => r.body.error?.details?.[0]?.issue ?? '';
    expect(issue(await put({ token: P.D }, { text: '   ' }))).toContain('1 to 4,000');
    const long = await put({ token: P.D }, { text: 'x'.repeat(4_001) });
    expect(long.status).toBe(422);
    expect(issue(long)).toContain('at most 4,000');
    expect(issue(await put({ token: P.D }, { text: 'Tab\there' }))).toContain('control');
    expect(issue(await put(chat(), { text: 'Shorter, please.' }))).toContain('8 to 200');
    expect(issue(await put(chat(), { text: 'Shorter.', why: 'x'.repeat(201) }))).toContain('8 to 200');
    expect((await coreSql('SELECT id FROM voice_versions')).length).toBe(0);
  });

  it("the owner's edit adds a version and writes no message", async () => {
    const before = (await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: P.D })).body.messages.length;
    const r = await put({ token: P.D }, { text: 'Plain and warm.\nShort answers.' });
    expect(r.status).toBe(200);
    expect(r.body.text).toBe('Plain and warm.\nShort answers.');
    expect(r.body.last).toMatchObject({ by: 'owner', why: null, chars: 30 });
    expect(r.body.versions.map((v) => v.by)).toEqual(['owner']);
    expect(r.body.versions[0]).not.toHaveProperty('text');
    expect((await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: P.D })).body.messages.length).toBe(
      before,
    );
    const one = await apiJson<VoiceVersion>('GET', `/v1/mind/voice/${r.body.last?.id}`, chat());
    expect(one.body.text).toBe('Plain and warm.\nShort answers.');
  });

  it("the mind's edit is told in the chat, and its undo brings back the version before", async () => {
    const owner = (await read({ token: P.D })).body.last?.id;
    const r = await put(chat(), { text: 'Plain and warm.\nShorter answers.', why: 'you asked for shorter answers' });
    expect(r.status).toBe(200);
    expect(r.body.last).toMatchObject({ by: 'mind', why: 'you asked for shorter answers' });
    const [row] = await coreSql<{ id: string; actor: string; undoable: number }>(
      "SELECT id, actor, undoable FROM ledger WHERE topic_key = 'mind.voice'",
    );
    expect(row).toMatchObject({ actor: 'mind:chat', undoable: 1 });
    const msgs = (await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: P.D })).body.messages as Message[];
    const card = msgs.find((m) => m.body === 'I changed how I talk: you asked for shorter answers');
    expect(card).toMatchObject({ author: 'mind', kind: 'card' });
    expect(card?.meta).toMatchObject({ settings: 'mind', lines: [{ ledger: row.id, undo: true }] });
    // The owner taps Undo: the owner's version is the page again, as a new version.
    expect((await api('POST', `/v1/ledger/${row.id}/undo`, { token: P.D, body: {} })).status).toBe(200);
    const now = (await read({ token: P.D })).body;
    expect(now.text).toBe('Plain and warm.\nShort answers.');
    expect(now.versions.map((v) => v.by)).toEqual(['owner', 'mind', 'owner']);
    expect(now.versions.at(-1)?.id).toBe(owner);
  });

  it('a later edit stands against an older undo', async () => {
    const r = await put(chat(), { text: 'Warm, quick.', why: 'you said the replies dragged' });
    const [row] = await coreSql<{ id: string }>(
      "SELECT id FROM ledger WHERE topic_key = 'mind.voice' AND status = 'done' ORDER BY seq DESC LIMIT 1",
    );
    expect(r.status).toBe(200);
    await put({ token: P.D }, { text: 'Warm, quick, a joke now and then.' });
    expect((await api('POST', `/v1/ledger/${row.id}/undo`, { token: P.D, body: {} })).status).toBe(409);
  });

  it('restore makes an earlier version the page again (owner only); nothing is deleted', async () => {
    const all = (await read({ token: P.D })).body.versions;
    const first = all.at(-1) as VoiceResponse['versions'][number];
    expect((await apiJson('POST', '/v1/mind/voice/restore', { ...chat(), body: { id: first.id } })).status).toBe(403);
    const r = await apiJson<Answer>('POST', '/v1/mind/voice/restore', { token: P.D, body: { id: first.id } });
    expect(r.status).toBe(200);
    expect(r.body.text).toBe('Plain and warm.\nShort answers.');
    expect(r.body.versions.length).toBe(all.length + 1);
    expect(
      (
        await apiJson('POST', '/v1/mind/voice/restore', {
          token: P.D,
          body: { id: '0190f0f0-0000-7000-8000-000000000000' },
        })
      ).status,
    ).toBe(404);
  });

  it('the briefing carries the page right after Now', async () => {
    const b = await brief(P.C, CHAT_SESSION, 'chat');
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    const core = (b.body as BriefResponse).core;
    const at = core.indexOf('## How you talk\nPlain and warm.\nShort answers.');
    expect(at).toBeGreaterThan(core.indexOf('## 1. Now'));
    expect(at).toBeLessThan(core.indexOf('## 2. '));
    expect((b.body as BriefResponse).full).toContain('## How you talk\nPlain and warm.');
  });

  it('is refused from a chat session that read outside text', async () => {
    // The last test: the suite's chat session reads a web page.
    await apiJson('POST', '/v1/mind/taint', { ...chat(), body: { source: 'WebFetch', ref_kind: 'url' } });
    const r = await put(chat(), { text: 'Loud and long.', why: 'a web page said so' });
    expect(r.status).toBe(403);
    expect(r.body.error?.code).toBe('session_tainted');
  });
});
