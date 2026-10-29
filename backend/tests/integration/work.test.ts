// P4 stage G: Muse on work orders (MUSE.md §3–§5). The mind makes an order; Muse says hello,
// claims it, heartbeats and returns a result the Worker checks against the kind's schema (a field
// too many, a javascript: link or a token-shaped string is named and refused); a lease with no
// heartbeat lapses and the third lapse fails it; a deadline expires it; the owner can cancel one.
// The Board, Muse's thread and `muse.silent` are in board.test.ts.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorkHello, WorkOrder } from '../../../shared/contract/work.ts';
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
const research = (deadline = Date.now() + 6 * HOUR) => ({
  kind: 'research.brief',
  title: 'What changed in the bus timetable',
  spec: {
    v: 1,
    goal: 'Summarise the new bus timetable.',
    inputs: { topic: 'buses' },
    constraints: ['public sources only'],
    done_when: 'Two sources agree.',
  },
  deadline_at: deadline,
});
const RESULT = {
  v: 1,
  summary: 'Two routes changed.',
  findings: [{ claim: 'Route 4 now runs every 20 minutes.', sources: ['https://example.com/buses'] }],
};

beforeAll(async () => {
  p = await principals();
  M = await makeAgent(p.D, 'muse');
});

describe('work orders', () => {
  it('the mind makes one; Muse says hello, claims, heartbeats and returns a valid result', async () => {
    const id = uuidv7();
    expect((await api('PUT', `/v1/work/orders/${id}`, { token: p.D, body: research() })).status).toBe(403);
    const made = await apiJson<WorkOrder>('PUT', `/v1/work/orders/${id}`, {
      ...as(p.C, CHAT_SESSION),
      body: research(),
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ status: 'queued', kind: 'research.brief', origin: 'muse' });
    expect(
      (await apiJson<WorkOrder>('PUT', `/v1/work/orders/${id}`, { ...as(p.C, CHAT_SESSION), body: research() })).status,
    ).toBe(200);
    const hello = await apiJson<WorkHello>('GET', '/v1/work/hello', { token: M });
    expect(hello.body).toMatchObject({ agent: 'muse', board_brief_allowed: false });
    const first = await coreSql<{ what: string }>("SELECT what FROM ledger WHERE ref = 'work:hello'");
    expect(first).toEqual([{ what: 'Muse called the new Worker for the first time' }]);
    const c = await apiJson<{ order: WorkOrder }>('POST', '/v1/work/claim', { token: M, body: {} });
    expect(c.body.order).toMatchObject({ id, status: 'claimed', attempts: 1 });
    // One at a time: claiming again answers the same order.
    expect((await apiJson<{ order: WorkOrder }>('POST', '/v1/work/claim', { token: M, body: {} })).body.order.id).toBe(
      id,
    );
    expect(
      (
        await apiJson<{ lease_until: number }>('POST', `/v1/work/orders/${id}/heartbeat`, {
          token: M,
          body: { note: 'reading' },
        })
      ).status,
    ).toBe(200);
    const done = await api('PUT', `/v1/work/orders/${id}/result`, { token: M, body: { result: RESULT } });
    expect(done.status).toBe(200);
    expect((await order(id)).body).toMatchObject({ status: 'done', result_valid: true, result: RESULT });
    expect((await api('POST', '/v1/work/claim', { token: M, body: {} })).status).toBe(204);
    // Muse reads nothing else of the owner's.
    expect((await api('GET', '/v1/threads/today', { token: M })).status).toBe(403);
  });

  it('refuses a result that fails its schema or hygiene, naming each problem, and the order is rejected', async () => {
    for (const [bad, problem] of [
      [{ ...RESULT, extra: 1 }, 'extra: not a field here'],
      [
        { ...RESULT, findings: [{ claim: 'A link', sources: ['javascript:alert(1)'] }] },
        'findings[0].sources[0]: an https URL',
      ],
      [{ ...RESULT, summary: `The key is thm_${'a'.repeat(30)}` }, 'summary: looks like a token or key; leave it out'],
    ] as const) {
      const id = uuidv7();
      await api('PUT', `/v1/work/orders/${id}`, { ...as(p.C, CHAT_SESSION), body: research() });
      await api('POST', '/v1/work/claim', { token: M, body: {} });
      const r = await apiJson<{ error: { code: string; details: { issue: string }[] } }>(
        'PUT',
        `/v1/work/orders/${id}/result`,
        { token: M, body: { result: bad } },
      );
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('invalid_result');
      expect(r.body.error.details.map((d) => d.issue)).toContain(problem);
      expect((await order(id)).body).toMatchObject({ status: 'rejected', result_valid: false, result: null });
    }
  });

  it('a lapsed lease goes back to the queue; the third lapse fails it; a deadline expires it', async () => {
    const id = uuidv7();
    await api('PUT', `/v1/work/orders/${id}`, { ...as(p.C, CHAT_SESSION), body: research() });
    for (let n = 1; n <= 3; n++) {
      expect(
        (await apiJson<{ order: WorkOrder }>('POST', '/v1/work/claim', { token: M, body: {} })).body.order,
      ).toMatchObject({ id, attempts: n });
      await watch(Date.now() + 31 * MINUTE);
    }
    expect((await order(id)).body.status).toBe('failed');
    const late = uuidv7();
    await api('PUT', `/v1/work/orders/${late}`, { ...as(p.C, CHAT_SESSION), body: research(Date.now() + 10 * MINUTE) });
    await watch(Date.now() + 11 * MINUTE);
    expect((await order(late)).body.status).toBe('expired');
    const notes = await coreSql<{ what: string }>('SELECT what FROM ledger WHERE ref = ?', `work:${late}`);
    expect(notes.map((n) => n.what)).toEqual([
      '"What changed in the bus timetable" expired: not finished by its deadline',
    ]);
    // Cancelled by the owner: Muse never gets it.
    const gone = uuidv7();
    await api('PUT', `/v1/work/orders/${gone}`, { ...as(p.C, CHAT_SESSION), body: research() });
    expect(
      (await api('POST', `/v1/work/orders/${gone}/cancel`, { token: p.D, body: { why: 'not needed after all' } }))
        .status,
    ).toBe(200);
    expect((await api('POST', '/v1/work/claim', { token: M, body: {} })).status).toBe(204);
  });
});

describe('what reaches Muse', () => {
  it('nothing never stored, and nothing at all from a session that read outside content', async () => {
    const brief = {
      focus: 'The week, briefly.',
      interests: [{ topic: 'Weather', priority: 'high' }],
      depth: 'headlines',
      stories: { min: 1, max: 3 },
      lookbackHours: 24,
    };
    const pw = await apiJson<{ error: { details: { issue: string }[] } }>('PUT', '/v1/board/brief', {
      ...as(p.C, CHAT_SESSION),
      body: { version: 0, brief: { ...brief, notes: 'My password is hunter2' } },
    });
    expect(pw.status).toBe(422);
    expect(pw.body.error.details[0].issue).toBe('never_stored');
    const leak = { ...research(), spec: { ...research().spec, inputs: { card: '4111 1111 1111 1111' } } };
    expect((await api('PUT', `/v1/work/orders/${uuidv7()}`, { ...as(p.C, CHAT_SESSION), body: leak })).status).toBe(
      422,
    );
    expect(
      (await api('PUT', `/v1/work/orders/${uuidv7()}`, { ...as(p.C, 'cse_never_claimed'), body: research() })).status,
    ).toBe(403);
    await apiJson('POST', '/v1/mind/taint', {
      ...as(p.C, CHAT_SESSION),
      body: { source: 'WebFetch', ref_kind: 'url' },
    });
    const tainted = await apiJson<{ error: { code: string } }>('PUT', `/v1/work/orders/${uuidv7()}`, {
      ...as(p.C, CHAT_SESSION),
      body: research(),
    });
    expect([tainted.status, tainted.body.error.code]).toEqual([403, 'session_tainted']);
    expect(
      (await api('PUT', '/v1/board/brief', { ...as(p.C, CHAT_SESSION), body: { version: 0, brief } })).status,
    ).toBe(403);
    // The owner's own device may always.
    expect((await api('PUT', '/v1/board/brief', { token: p.D, body: { version: 0, brief } })).status).toBe(200);
  });
});
