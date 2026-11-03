// `@muse` in the chat (HOME.md §6.5, MUSE-PROTOCOL.md). The owner's message with `mention: 'muse'`
// makes a `muse.request` under the owner's own authority (Muse orders ask by default, and this one
// still needs no card), linked to the message, which a system line answers with the order's id; each
// state the order reaches is one line in the conversation, done is Muse's own message with an Open
// chip, a failure says Muse's reason, and the owner's cancel says so. Refused: a mention from the
// mind, off the record, with files or over 500 characters; words holding a password make no order.
// An order the mind places says nothing in the chat. Muse's signed uploads gather into one task.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Message, TodayResponse } from '../../../shared/contract/api';
import type { WorkOrder } from '../../../shared/contract/work.ts';
import { uuidv7 } from '../../src/lib/ids';
import { DAY, MINUTE } from '../../src/lib/time';
import type { Core } from '../../src/objects/core';
import { offRecord } from '../held-helpers';
import { api, apiJson, core, coreSql, makeAgent } from '../helpers';
import { as, CHAT_SESSION, type Principals, principals } from '../memory-helpers';

let p: Principals;
let M = '';
const stub = () => core() as unknown as DurableObjectStub<Core>;
const watch = (now = Date.now()) => runInDurableObject(stub(), (o: Core) => o.tick(now));
const ask = (body: string, extra: object = {}, id = uuidv7()) =>
  apiJson<Message & { error?: { code: string; details: { path: string; issue: string }[] } }>(
    'PUT',
    `/v1/messages/${id}`,
    { token: p.D, body: { body, mention: 'muse', ...extra } },
  );
const orders = async () =>
  (await apiJson<{ items: WorkOrder[] }>('GET', '/v1/work/orders?status=all&limit=20', { token: p.D })).body.items;
const orderFor = async (messageId: string) => (await orders()).find((o) => o.message_id === messageId) as WorkOrder;
/** The conversation's lines about one order: [author, words, state]. */
const lines = async (id: string) =>
  (await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: p.D })).body.messages
    .filter((m) => (m.meta as { work?: { id: string } } | null)?.work?.id === id)
    .map((m) => [m.author, m.body, (m.meta as { work: { state: string } }).work.state]);
const claim = () => apiJson<{ order: WorkOrder }>('POST', '/v1/work/claim', { token: M, body: {} });
const ASKED = "Asked Muse. I'll tell you when it lands.";

beforeAll(async () => {
  p = await principals();
  M = await makeAgent(p.D, 'muse');
});

describe('@muse in the chat', () => {
  it("makes a muse.request under the owner's authority, answered by a line naming it; the mind is not asked", async () => {
    // Muse orders stay at their default, ask: the owner's own asking needs no card.
    expect(
      (await apiJson<Record<string, unknown>>('GET', '/v1/settings', { token: p.D })).body['mind.permit.muse'],
    ).not.toBe('tell');
    const id = uuidv7();
    const r = await ask('@muse grab me three indie catalogs', {}, id);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ author: 'owner', meta: { mention: 'muse' } });
    expect(r.body.answered_at).not.toBeNull();
    const o = await orderFor(id);
    expect(o).toMatchObject({
      kind: 'muse.request',
      created_by: 'owner',
      title: 'grab me three indie catalogs',
      spec: { v: 1, words: 'grab me three indie catalogs', app: 'music' },
      state: 'asked',
      message_id: id,
    });
    expect(await lines(o.id)).toEqual([['system', ASKED, 'asked']]);
    const today = await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: p.D });
    expect(today.body.messages.find((m) => m.body === ASKED)?.reply_to).toBe(id);
    // The same message again is the same answer, and no second order.
    expect((await ask('@muse grab me three indie catalogs', {}, id)).status).toBe(200);
    expect((await orders()).filter((x) => x.message_id === id)).toHaveLength(1);
    // Nothing waits on the mind: the message is settled, and none before it.
    const before = uuidv7();
    await apiJson('PUT', `/v1/messages/${before}`, { token: p.D, body: { body: 'What is on tonight?' } });
    const later = uuidv7();
    await ask('@Muse, find a tab for an old folk song', {}, later);
    expect((await orderFor(later)).spec).toEqual({ v: 1, words: 'find a tab for an old folk song', app: 'guitar' });
    const waits = await coreSql<{ id: string }>(
      "SELECT id FROM messages WHERE author = 'owner' AND answered_at IS NULL",
    );
    expect(waits.map((m) => m.id)).toEqual([before]);
    // Done for the next tests: none of these is left for Muse to claim.
    for (const x of await orders())
      if (x.state === 'asked')
        await api('POST', `/v1/work/orders/${x.id}/cancel`, { token: p.D, body: { why: 'clearing the queue' } });
  });

  it("tells the conversation each state once; done is Muse's own line with an Open chip", async () => {
    const id = uuidv7();
    await ask('@muse add three calm piano albums', {}, id);
    const o = await orderFor(id);
    expect((await claim()).body.order.id).toBe(o.id);
    const progress = (body: string) =>
      api('POST', '/v1/work/thread/messages', { token: M, body: { id: uuidv7(), body, order_id: o.id } });
    expect((await progress('Found the albums.')).status).toBe(201);
    expect((await progress('Uploading the second.')).status).toBe(201);
    const result = {
      added: { songs: 41, artists: 3 },
      ids: ['r2_native_example'],
      note: 'Three albums, tagged calm.',
      open: { app: 'music', path: '/music/' },
    };
    expect((await api('PUT', `/v1/work/orders/${o.id}/result`, { token: M, body: { result } })).status).toBe(200);
    expect(await lines(o.id)).toEqual([
      ['system', ASKED, 'asked'],
      ['system', 'Muse picked it up.', 'picked_up'],
      ['system', 'Muse is working on it.', 'working'],
      ['muse', 'Muse added 41 songs from 3 artists. Three albums, tagged calm.', 'done'],
    ]);
    const today = await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: p.D });
    const done = today.body.messages.find((m) => m.author === 'muse') as Message;
    expect(done).toMatchObject({ origin: 'muse', reply_to: id });
    expect((done.meta as { chip: unknown }).chip).toEqual({ label: 'Open in Music', app: 'music', path: '/music/' });
    // A done result with no place to open takes the words' app, at its root.
    const tab = uuidv7();
    await ask('@muse find a tab for that song', {}, tab);
    const t = await orderFor(tab);
    await claim();
    const files = { added: { files: 1 }, ids: [], note: '' };
    await api('PUT', `/v1/work/orders/${t.id}/result`, { token: M, body: { result: files } });
    const last = (await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: p.D })).body.messages.at(-1);
    expect([last?.body, (last?.meta as { chip?: unknown } | undefined)?.chip]).toEqual([
      'Muse added 1 file.',
      { label: 'Open in Guitar', app: 'guitar', path: '/guitar/' },
    ]);
  });

  it('an order the mind places says nothing in the chat', async () => {
    await api('PATCH', '/v1/settings', { token: p.D, body: { 'mind.permit.muse': 'tell' } });
    const id = uuidv7();
    const body = {
      kind: 'muse.request',
      title: 'Subtitles',
      spec: { v: 1, words: 'Subtitles for the film night.', app: 'media' },
      deadline_at: Date.now() + DAY,
    };
    expect((await api('PUT', `/v1/work/orders/${id}`, { ...as(p.C, CHAT_SESSION), body })).status).toBe(201);
    const count = async () => (await coreSql<{ n: number }>('SELECT count(*) AS n FROM messages'))[0].n;
    const before = await count();
    await claim();
    await api('PUT', `/v1/work/orders/${id}/result`, {
      token: M,
      body: { result: { added: { files: 1 }, ids: [], note: '' } },
    });
    expect((await apiJson<WorkOrder>('GET', `/v1/work/orders/${id}`, { token: p.D })).body.state).toBe('done');
    expect(await count()).toBe(before);
  });
  it('is refused from the mind, off the record, with files or past 500 characters; a password makes no order', async () => {
    const mind = await apiJson<{ error: { details: { path: string }[] } }>('PUT', `/v1/messages/${uuidv7()}`, {
      ...as(p.C, CHAT_SESSION),
      body: { body: '@muse grab a catalog', mention: 'muse' },
    });
    expect([mind.status, mind.body.error.details[0].path]).toEqual([422, 'mention']);
    const long = await ask(`@muse ${'x'.repeat(501)}`);
    expect([long.status, long.body.error?.details[0].issue]).toEqual([422, 'at most 500 characters for Muse']);
    const otr = await offRecord(p.D);
    const hidden = await ask('@muse grab a catalog', { thread_id: otr.id });
    expect([hidden.status, hidden.body.error?.details[0].issue]).toEqual([422, 'not off the record']);
    const n = (await orders()).length;
    const pw = uuidv7();
    const r = await ask('@muse log in with my password is hunter2', {}, pw);
    expect(r.status).toBe(201);
    expect(r.body.answered_at).not.toBeNull();
    expect((await orders()).length).toBe(n);
    const today = await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: p.D });
    expect(today.body.messages.find((m) => m.reply_to === pw)?.body).toBe(
      "I didn't ask Muse: that looks like a password or a key, and those stay here.",
    );
  });

  it("a failure is a plain line with Muse's reason; an order past its deadline says so; the owner cancels one", async () => {
    const failing = uuidv7();
    await ask('@muse find the lost demo tapes', {}, failing);
    const f = await orderFor(failing);
    await claim();
    await api('POST', `/v1/work/orders/${f.id}/fail`, { token: M, body: { reason: 'Nothing matched those words' } });
    expect((await lines(f.id)).at(-1)).toEqual([
      'system',
      "Muse couldn't do it: Nothing matched those words.",
      'failed',
    ]);
    const cancelled = uuidv7();
    await ask('@muse fetch the subtitles for a film', {}, cancelled);
    const c = await orderFor(cancelled);
    expect(
      (await api('POST', `/v1/work/orders/${c.id}/cancel`, { token: p.D, body: { why: 'The owner cancelled it.' } }))
        .status,
    ).toBe(200);
    expect(await lines(c.id)).toEqual([
      ['system', ASKED, 'asked'],
      ['system', "Cancelled. Muse won't do it.", 'cancelled'],
    ]);
    const slow = uuidv7();
    await ask('@muse put this chapter into Study', {}, slow);
    const s = await orderFor(slow);
    await watch(Date.now() + 8 * DAY);
    expect((await lines(s.id)).at(-1)).toEqual(['system', "Muse didn't get to it in time.", 'failed']);
  });
});

describe("Muse's uploads as tasks", () => {
  it('gather into one upload batch, never claimed, closed 30 minutes after the last', async () => {
    await runInDurableObject(stub(), async (o: Core) => {
      o.workUploaded(['r2_native_a', 'r2_native_b'], ['artist-one', 'artist-two']);
      o.workUploaded(['r2_native_c'], ['artist-one']);
    });
    const open = (await orders()).filter((o) => o.kind === 'muse.upload_batch');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      title: 'Songs Muse uploaded',
      state: 'working',
      created_by: 'muse',
      message_id: null,
      result: {
        added: { songs: 3, artists: 2 },
        ids: ['r2_native_a', 'r2_native_b', 'r2_native_c'],
        note: '',
        open: { app: 'music', path: '/music/' },
      },
    });
    expect((await claim()).status).toBe(204);
    expect((await api('POST', `/v1/work/orders/${open[0].id}/heartbeat`, { token: M, body: {} })).status).toBe(404);
    await watch(Date.now() + 31 * MINUTE);
    expect((await apiJson<WorkOrder>('GET', `/v1/work/orders/${open[0].id}`, { token: p.D })).body).toMatchObject({
      status: 'done',
      state: 'done',
      result_valid: true,
    });
    await runInDurableObject(stub(), async (o: Core) => o.workUploaded(['r2_native_d'], []));
    expect((await orders()).filter((o) => o.kind === 'muse.upload_batch')).toHaveLength(2);
  });
});
