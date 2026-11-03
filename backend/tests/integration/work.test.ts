// Muse on work orders (MUSE-PROTOCOL.md). The mind places a `muse.request` (gated: set to tell
// here); Muse says hello, claims it, posts a progress line naming it and returns a result the Worker
// checks against the kind's schema: a field too many, a javascript: link, a token-shaped string or
// an Open path outside its app is named, the order stays Muse's to send again, and the third such
// result rejects it. A failure is final unless Muse says to retry; a lease with no word lapses and
// the third lapse fails it; a deadline expires it; the owner can cancel one. A Board-era row reads
// as `legacy` and is never handed out. The owner's `@muse` and the lines in the chat are in
// muse-chat.test.ts; Muse's thread in muse.test.ts.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { MuseNote, WorkHello, WorkOrder } from '../../../shared/contract/work.ts';
import { uuidv7 } from '../../src/lib/ids';
import { HOUR, MINUTE } from '../../src/lib/time';
import type { Core } from '../../src/objects/core';
import { api, apiJson, core, coreSql, makeAgent } from '../helpers';
import { as, CHAT_SESSION, type Principals, principals } from '../memory-helpers';

let p: Principals;
let M = '';
const stub = () => core() as unknown as DurableObjectStub<Core>;
const watch = (now = Date.now()) => runInDurableObject(stub(), (o: Core) => o.tick(now));
const order = (id: string) => apiJson<WorkOrder>('GET', `/v1/work/orders/${id}`, { token: p.D });
const request = (deadline = Date.now() + 6 * HOUR, words = 'Find three calm piano albums from the seventies.') => ({
  kind: 'muse.request',
  title: 'Calm piano albums',
  spec: { v: 1, words, app: 'music' },
  deadline_at: deadline,
});
const place = async (body = request()) => {
  const id = uuidv7();
  const r = await apiJson<WorkOrder>('PUT', `/v1/work/orders/${id}`, { ...as(p.C, CHAT_SESSION), body });
  expect(r.status).toBe(201);
  return id;
};
const claim = () => apiJson<{ order: WorkOrder }>('POST', '/v1/work/claim', { token: M, body: {} });
const send = (id: string, result: unknown) =>
  apiJson<{ error: { code: string; details: { issue: string }[] } }>('PUT', `/v1/work/orders/${id}/result`, {
    token: M,
    body: { result },
  });
const RESULT = {
  added: { songs: 41, artists: 3 },
  ids: ['r2_native_example-1', 'r2_native_example-2'],
  note: 'Three albums, tagged calm.',
  open: { app: 'music', path: '/music/' },
};

beforeAll(async () => {
  p = await principals();
  M = await makeAgent(p.D, 'muse');
  // Muse orders ask first by default (a standing permission, permits.test.ts); these tests are
  // about the orders themselves, so the owner lets the mind make them and say so.
  await api('PATCH', '/v1/settings', { token: p.D, body: { 'mind.permit.muse': 'tell' } });
});

describe('work orders', () => {
  it('the mind places one; Muse says hello, claims, posts progress and returns a valid result', async () => {
    const id = uuidv7();
    expect((await api('PUT', `/v1/work/orders/${id}`, { token: p.D, body: request() })).status).toBe(403);
    // The Board's kinds are gone.
    const old = { ...request(), kind: 'research.brief' };
    expect((await api('PUT', `/v1/work/orders/${id}`, { ...as(p.C, CHAT_SESSION), body: old })).status).toBe(422);
    const made = await apiJson<WorkOrder>('PUT', `/v1/work/orders/${id}`, {
      ...as(p.C, CHAT_SESSION),
      body: request(),
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ status: 'queued', state: 'asked', kind: 'muse.request', origin: 'muse' });
    expect(made.body.message_id).toBeNull();
    expect(
      (await apiJson<WorkOrder>('PUT', `/v1/work/orders/${id}`, { ...as(p.C, CHAT_SESSION), body: request() })).status,
    ).toBe(200);
    const hello = await apiJson<WorkHello>('GET', '/v1/work/hello', { token: M });
    expect(hello.body).toMatchObject({ agent: 'muse', scopes: ['work.claim', 'work.result', 'work.thread'] });
    const first = await coreSql<{ what: string }>("SELECT what FROM ledger WHERE ref = 'work:hello'");
    expect(first).toEqual([{ what: 'Muse called the new Worker for the first time' }]);
    const c = await claim();
    expect(c.body.order).toMatchObject({ id, status: 'claimed', state: 'picked_up', attempts: 1 });
    expect(c.body.order.spec).toEqual({
      v: 1,
      words: 'Find three calm piano albums from the seventies.',
      app: 'music',
    });
    // One at a time: claiming again answers the same order.
    expect((await claim()).body.order.id).toBe(id);
    // A progress line names the order: it is working, and the line is in its thread.
    const line = { id: uuidv7(), body: 'Found the albums; uploading.', order_id: id };
    expect((await api('POST', '/v1/work/thread/messages', { token: M, body: line })).status).toBe(201);
    expect((await order(id)).body).toMatchObject({ state: 'working', heartbeat_note: 'Found the albums; uploading.' });
    const notes = await apiJson<{ items: MuseNote[] }>('GET', `/v1/work/thread?order=${id}`, { token: p.D });
    expect(notes.body.items.map((n) => [n.author, n.body, n.order_id])).toEqual([
      ['muse', 'Found the albums; uploading.', id],
    ]);
    // Only Muse names an order, and only one it holds.
    const mine = { id: uuidv7(), body: 'How is it going?', order_id: id };
    expect((await api('POST', '/v1/work/thread/messages', { token: p.D, body: mine })).status).toBe(422);
    expect(
      (await api('POST', `/v1/work/orders/${id}/heartbeat`, { token: M, body: { note: 'still going' } })).status,
    ).toBe(200);
    const done = await api('PUT', `/v1/work/orders/${id}/result`, { token: M, body: { result: RESULT } });
    expect(done.status).toBe(200);
    expect((await order(id)).body).toMatchObject({ status: 'done', state: 'done', result_valid: true, result: RESULT });
    expect((await claim()).status).toBe(204);
    const late = { id: uuidv7(), body: 'One more thing.', order_id: id };
    expect((await api('POST', '/v1/work/thread/messages', { token: M, body: late })).status).toBe(409);
    // Muse reads nothing else of the owner's.
    expect((await api('GET', '/v1/threads/today', { token: M })).status).toBe(403);
  });

  it('a result that fails its checks is named and stays Muse to fix; the third rejects the order', async () => {
    const id = await place();
    await claim();
    for (const [bad, problem] of [
      [{ ...RESULT, extra: 1 }, 'extra: not a field here'],
      [{ ...RESULT, open: { app: 'music', path: '/podcasts/' } }, "open.path: a path inside music's folder"],
      [{ ...RESULT, note: `The key is thm_${'a'.repeat(30)}` }, 'note: looks like a token or key; leave it out'],
      [{ ...RESULT, note: 'javascript:alert(1)' }, 'note: javascript: and data: links are refused'],
    ] as const) {
      const r = await send(id, bad);
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('invalid_result');
      expect(r.body.error.details.map((d) => d.issue)).toContain(problem);
      // Back to fixing: each claim takes three results that fail.
      await coreSql('UPDATE work_orders SET invalid = 0 WHERE id = ?', id);
    }
    expect((await order(id)).body).toMatchObject({ status: 'claimed', result_valid: false, result: null });
    expect((await send(id, RESULT)).status).toBe(200);
    expect((await order(id)).body).toMatchObject({ status: 'done', result_valid: true });
    // Three that fail in one claim: rejected, and a fourth is too late.
    const again = await place();
    await claim();
    for (let k = 0; k < 3; k++) expect((await send(again, { ...RESULT, extra: k })).status).toBe(422);
    expect((await order(again)).body).toMatchObject({ status: 'rejected', state: 'failed', result_valid: false });
    expect((await send(again, RESULT)).status).toBe(409);
  });

  it('a failure is final unless Muse says to retry; a lapsed lease requeues, the third fails; a deadline expires', async () => {
    const id = await place();
    await claim();
    const retry = await apiJson<{ status: string }>('POST', `/v1/work/orders/${id}/fail`, {
      token: M,
      body: { reason: 'The store was down.', retry: true },
    });
    expect(retry.body.status).toBe('queued');
    expect((await order(id)).body).toMatchObject({ state: 'asked', heartbeat_note: 'The store was down.' });
    await claim();
    const final = await apiJson<{ status: string }>('POST', `/v1/work/orders/${id}/fail`, {
      token: M,
      body: { reason: 'No such albums exist.' },
    });
    expect(final.body.status).toBe('failed');
    expect((await order(id)).body.state).toBe('failed');
    const lapsing = await place();
    for (let n = 1; n <= 3; n++) {
      expect((await claim()).body.order).toMatchObject({ id: lapsing, attempts: n });
      await watch(Date.now() + 31 * MINUTE);
    }
    expect((await order(lapsing)).body.status).toBe('failed');
    const late = await place(request(Date.now() + 10 * MINUTE));
    await watch(Date.now() + 11 * MINUTE);
    expect((await order(late)).body).toMatchObject({ status: 'expired', state: 'failed' });
    const notes = await coreSql<{ what: string }>('SELECT what FROM ledger WHERE ref = ?', `work:${late}`);
    expect(notes.map((n) => n.what)).toEqual(['"Calm piano albums" expired: not finished by its deadline']);
    // Cancelled by the owner: Muse never gets it.
    const gone = await place();
    expect(
      (await api('POST', `/v1/work/orders/${gone}/cancel`, { token: p.D, body: { why: 'not needed after all' } }))
        .status,
    ).toBe(200);
    expect((await order(gone)).body.state).toBe('cancelled');
    expect((await claim()).status).toBe(204);
  });

  it('a Board-era order reads as legacy and is never handed to Muse', async () => {
    const id = uuidv7();
    await coreSql(
      `INSERT INTO work_orders (id, kind, assignee, title, spec_json, personal, deadline_at, status, created_by, created_at)
       VALUES (?, 'research.brief', 'muse', 'An old brief', '{"v":1}', 0, ?, 'queued', 'cse_old', ?)`,
      id,
      Date.now() + HOUR,
      Date.now() - HOUR,
    );
    expect((await order(id)).body).toMatchObject({ kind: 'legacy', schema: {}, state: 'asked', message_id: null });
    const list = await apiJson<{ items: WorkOrder[] }>('GET', '/v1/work/orders?status=all&limit=20', { token: p.D });
    expect(list.body.items.find((o) => o.id === id)).toMatchObject({ kind: 'legacy' });
    expect((await claim()).status).toBe(204);
    expect((await api('POST', `/v1/work/orders/${id}/heartbeat`, { token: M, body: {} })).status).toBe(404);
    await watch(Date.now() + 2 * HOUR);
    expect((await order(id)).body.status).toBe('expired');
  });
});

describe('what reaches Muse', () => {
  it('nothing never stored, and nothing at all from a session that read outside content', async () => {
    const pw = await apiJson<{ error: { details: { issue: string }[] } }>('PUT', `/v1/work/orders/${uuidv7()}`, {
      ...as(p.C, CHAT_SESSION),
      body: request(undefined, 'Check this. My password is hunter2'),
    });
    expect(pw.status).toBe(422);
    expect(pw.body.error.details[0].issue).toBe('never_stored');
    const leak = request(undefined, 'Pay with 4111 1111 1111 1111');
    expect((await api('PUT', `/v1/work/orders/${uuidv7()}`, { ...as(p.C, CHAT_SESSION), body: leak })).status).toBe(
      422,
    );
    const long = request(undefined, 'x'.repeat(501));
    expect((await api('PUT', `/v1/work/orders/${uuidv7()}`, { ...as(p.C, CHAT_SESSION), body: long })).status).toBe(
      422,
    );
    expect(
      (await api('PUT', `/v1/work/orders/${uuidv7()}`, { ...as(p.C, 'cse_never_claimed'), body: request() })).status,
    ).toBe(403);
    await apiJson('POST', '/v1/mind/taint', {
      ...as(p.C, CHAT_SESSION),
      body: { source: 'WebFetch', ref_kind: 'url' },
    });
    const tainted = await apiJson<{ error: { code: string } }>('PUT', `/v1/work/orders/${uuidv7()}`, {
      ...as(p.C, CHAT_SESSION),
      body: request(),
    });
    expect([tainted.status, tainted.body.error.code]).toEqual([403, 'session_tainted']);
  });
});
