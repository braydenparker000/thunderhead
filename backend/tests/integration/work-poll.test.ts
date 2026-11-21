// Muse's poll is cheap and held to 5 minutes (MUSE-PROTOCOL.md §2): a claim with nothing to take
// opens no write in Core; every 204 says `Retry-After: 300`; a claim within 5 minutes of an empty
// answer is answered by the Worker with the seconds left, without Core, and an order placed in that
// wait is taken at the first claim after it.
import { runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkOrder } from '../../../shared/contract/work.ts';
import { forgetPolls } from '../../src/areas/work/poll';
import { uuidv7 } from '../../src/lib/ids';
import { HOUR, MINUTE } from '../../src/lib/time';
import type { Core } from '../../src/objects/core';
import { api, apiJson, core, makeAgent } from '../helpers';
import { as, CHAT_SESSION, type Principals, principals } from '../memory-helpers';

let p: Principals;
let M = '';
const stub = () => core() as unknown as DurableObjectStub<Core>;
const claim = () => apiJson<{ order: WorkOrder }>('POST', '/v1/work/claim', { token: M, body: {} });
const place = async () => {
  const id = uuidv7();
  const body = {
    kind: 'muse.request',
    title: 'Calm piano albums',
    spec: { v: 1, words: 'Find three calm piano albums from the seventies.', app: 'music' },
    deadline_at: Date.now() + 6 * HOUR,
  };
  expect((await api('PUT', `/v1/work/orders/${id}`, { ...as(p.C, CHAT_SESSION), body })).status).toBe(201);
  return id;
};
/** Core's claim, counting the transactions it opens. */
const claimInCore = () =>
  runInDurableObject(stub(), (o: Core, state) => {
    const spy = vi.spyOn(state.storage, 'transactionSync');
    try {
      return { order: o.workClaim(), writes: spy.mock.calls.length };
    } finally {
      spy.mockRestore();
    }
  });

beforeAll(async () => {
  p = await principals();
  M = await makeAgent(p.D, 'muse');
  await api('PATCH', '/v1/settings', { token: p.D, body: { 'mind.permit.muse': 'tell' } });
  expect((await api('GET', '/v1/work/hello', { token: M })).status).toBe(200);
});
beforeEach(() => forgetPolls());
afterEach(() => vi.useRealTimers());

describe("Muse's poll", () => {
  it('a claim with nothing queued and nothing held opens no write; one with an order does', async () => {
    expect(await claimInCore()).toEqual({ order: null, writes: 0 });
    const id = await place();
    const taken = await claimInCore();
    expect(taken.order?.id).toBe(id);
    expect(taken.writes).toBe(1);
    // Held: claiming again hands back the same order.
    expect((await claimInCore()).order?.id).toBe(id);
    await api('POST', `/v1/work/orders/${id}/fail`, { token: M, body: { reason: 'Not today.' } });
  });

  it('every 204 says Retry-After: 300', async () => {
    const r = await api('POST', '/v1/work/claim', { token: M, body: {} });
    expect(r.status).toBe(204);
    expect(r.headers.get('Retry-After')).toBe('300');
  });

  it('a claim within 5 minutes of an empty answer waits the rest without Core; the order comes after', async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], now: t0 });
    expect((await claim()).status).toBe(204);
    const id = await place();
    vi.setSystemTime(t0 + 2 * MINUTE);
    const early = await api('POST', '/v1/work/claim', { token: M, body: {} });
    // Core would have handed out the order: this answer never asked it.
    expect(early.status).toBe(204);
    expect(early.headers.get('Retry-After')).toBe('180');
    vi.setSystemTime(t0 + 5 * MINUTE);
    const due = await claim();
    expect(due.status).toBe(200);
    expect(due.body.order.id).toBe(id);
  });
});
