// Cost (TESTING.md §6): rows read and written per endpoint, from the objects' own cursor meters,
// against tests/cost/budgets.json. These are the units the free plan bills (5M read, 100k written
// a day). An endpoint without a budget fails; a budget rises only with DATA.md §8.2 and
// PERFORMANCE.md §4. The budgets are the numbers measured in local workerd (MEASUREMENTS.md §2).
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type {
  Message,
  NewAgentResponse,
  SignedIn,
  SignedInWithCode,
  TodayResponse,
} from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import type { Core } from '../../src/objects/core';
import {
  api,
  apiJson,
  auth,
  authSql,
  core,
  DEVICE,
  login,
  makeAgent,
  PASSWORD,
  type Rows,
  rowsDuring,
  SETUP_CODE,
  USERNAME,
} from '../helpers';
import budgets from './budgets.json';
import { importCalls } from './import-calls';
import { libraryCalls } from './library-calls';
import { memoryCalls } from './memory-calls';
import { proposalCalls } from './proposal-calls';

type Budget = { rows_read_max: number; rows_written_max: number };
const measured: Record<string, Rows> = {};
type Stub = Parameters<typeof rowsDuring>[0];

async function cost(name: string, fn: () => Promise<Response>, status: number, stub: Stub = auth()): Promise<void> {
  let got = 0;
  measured[name] = await rowsDuring(stub, async () => {
    got = (await fn()).status;
  });
  expect(got, name).toBe(status);
}

const wrong = (ip: string) =>
  api('POST', '/v1/auth/login', { ip, body: { username: USERNAME, password: 'not the password, no', device: DEVICE } });
const grant = async (ip: string, password = PASSWORD) => (await (await login(ip, password)).json()) as SignedIn;

describe('rows per endpoint', () => {
  it('measures every P1 endpoint', async () => {
    await cost('GET /v1/auth/state', () => api('GET', '/v1/auth/state'), 200);
    let owner = {} as SignedInWithCode;
    await cost(
      'POST /v1/auth/setup',
      async () => {
        const res = await api('POST', '/v1/auth/setup', {
          body: { setup_code: SETUP_CODE, username: USERNAME, password: PASSWORD, device: DEVICE },
        });
        owner = (await res.clone().json()) as SignedInWithCode;
        return res;
      },
      201,
    );

    // Login: right (a second device, so one new_device notice), wrong, refused while backing off.
    await cost('POST /v1/auth/login (ok, 1 other session)', () => login('192.0.2.200'), 200);
    await cost('POST /v1/auth/login (wrong)', () => wrong('192.0.2.201'), 401);
    for (let i = 0; i < 6; i++) await wrong('192.0.2.202');
    await cost('POST /v1/auth/login (429)', () => wrong('192.0.2.202'), 429);

    // The auth check: a cache miss asks Auth once; then the isolate cache answers.
    const g = await grant('192.0.2.203');
    await cost(
      'GET /v1/auth/sessions (token not cached, 3 sessions)',
      () => api('GET', '/v1/auth/sessions', { token: g.token }),
      200,
    );
    await cost(
      'GET /v1/auth/sessions (token cached, 3 sessions)',
      () => api('GET', '/v1/auth/sessions', { token: g.token }),
      200,
    );
    await cost('GET /v1/auth/me (device, cached)', () => api('GET', '/v1/auth/me', { token: g.token }), 200);

    // The hourly renewal of last_seen_at, on top of a sign-out.
    const h = await grant('192.0.2.204');
    await authSql('UPDATE sessions SET last_seen_at = 0 WHERE id = ?', h.session_id);
    await cost(
      'POST /v1/auth/signout this (not cached, renewal due)',
      () => api('POST', '/v1/auth/signout', { token: h.token, body: { scope: 'this' } }),
      204,
    );
    const a = await grant('192.0.2.205');
    await cost(
      'POST /v1/auth/signout this (not cached)',
      () => api('POST', '/v1/auth/signout', { token: a.token, body: { scope: 'this' } }),
      204,
    );

    // Agent keys, a device revoke and "sign out the others", from the owner's (cached) session.
    await api('GET', '/v1/auth/me', { token: owner.token });
    await cost(
      'POST /v1/auth/agents',
      () =>
        api('POST', '/v1/auth/agents', {
          token: owner.token,
          body: { name: 'ci', role: 'ci', current_password: PASSWORD },
        }),
      201,
    );
    const ci = await makeAgent(owner.token, 'mind:chat');
    await cost('GET /v1/auth/me (agent, not cached)', () => api('GET', '/v1/auth/me', { token: ci }), 200);
    const b = await grant('192.0.2.206');
    await cost(
      'DELETE /v1/auth/sessions/:id (cached)',
      () => api('DELETE', `/v1/auth/sessions/${b.session_id}`, { token: owner.token }),
      204,
    );
    await cost(
      'POST /v1/auth/signout others (cached)',
      () => api('POST', '/v1/auth/signout', { token: owner.token, body: { scope: 'others' } }),
      204,
    );

    // Recovery.
    const body = {
      username: USERNAME,
      code: 'AAAAAAAAAAAAAAAAAAAAAAAAA',
      new_password: `${PASSWORD} new`,
      device: DEVICE,
    };
    await cost(
      'POST /v1/auth/recover (wrong)',
      () => api('POST', '/v1/auth/recover', { ip: '192.0.2.210', body }),
      401,
    );
    await cost(
      'POST /v1/auth/recover (ok, 1 session)',
      () => api('POST', '/v1/auth/recover', { ip: '192.0.2.211', body: { ...body, code: owner.recovery_code } }),
      200,
    );

    // Ops and settings.
    await cost('GET /v1/health', () => api('GET', '/v1/health'), 200);
    const c = await grant('192.0.2.220', `${PASSWORD} new`);
    await api('GET', '/v1/auth/me', { token: c.token });
    await cost(
      'GET /v1/ops/health/deep (Core)',
      () => api('GET', '/v1/ops/health/deep', { token: c.token }),
      200,
      core(),
    );
    const report = { items: [{ source: 'client', code: 'x', message: 'y', build: 1, at: Date.now() }] };
    await cost(
      'POST /v1/ops/errors, 1 item (Core)',
      () => api('POST', '/v1/ops/errors', { token: c.token, body: report }),
      204,
      core(),
    );
    await cost('GET /v1/settings (Core)', () => api('GET', '/v1/settings', { token: c.token }), 200, core());
    await cost(
      'PATCH /v1/settings, 1 key (Core)',
      () => api('PATCH', '/v1/settings', { token: c.token, body: { 'owner.tz': 'UTC' } }),
      200,
      core(),
    );
  });

  // P2: the paths the phone and the mind use all day (DATA.md §8.2). A daily thread of 20
  // messages, a mind session holding the lease, and an unconnected trigger (no fire).
  it('measures every P2 endpoint against its budget', async () => {
    const pw = `${PASSWORD} new`;
    const d = await grant('192.0.2.230', pw);
    const made = await apiJson<NewAgentResponse>('POST', '/v1/auth/agents', {
      token: d.token,
      body: { name: 'chat-cost', role: 'mind:chat', current_password: pw },
    });
    const m = { token: made.body.token, headers: { 'TH-Session': 'cse_cost_session' } };
    await api('GET', '/v1/auth/me', { token: d.token });
    await api('GET', '/v1/auth/me', m);
    const say = (body: string, call: { token: string; headers?: Record<string, string> } = d) =>
      apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, { ...call, body: { body } });
    for (let i = 0; i < 19; i++) await say(`message number ${i}`);
    const k = core();

    await cost(
      'PUT /v1/messages/:id (owner, no session) (Core)',
      () => api('PUT', `/v1/messages/${uuidv7()}`, { token: d.token, body: { body: 'what is on today' } }),
      201,
      k,
    );
    await cost('GET /v1/threads/today (20 messages) (Core)', () => api('GET', '/v1/threads/today', d), 200, k);
    const seq = (await apiJson<TodayResponse>('GET', '/v1/threads/today', d)).body.seq;
    await cost('GET /v1/changes (nothing new) (Core)', () => api('GET', `/v1/changes?after=${seq}`, d), 200, k);
    await cost('POST /v1/live/ticket (Core)', () => api('POST', '/v1/live/ticket', d), 200, k);
    await cost('POST /v1/mind/typing (unconnected) (Core)', () => api('POST', '/v1/mind/typing', d), 204, k);
    const brief = {
      claim: true,
      session_id: 'cse_cost_session',
      role: 'chat',
      constitution_sha256: 'none',
      th_version: '0.1.0',
    };
    await cost(
      'POST /v1/mind/brief (claim, 20 messages) (Core)',
      () => api('POST', '/v1/mind/brief', { ...m, body: brief }),
      200,
      k,
    );
    await cost(
      'GET /v1/live/wait (nothing new, 1 s) (Core)',
      () => api('GET', `/v1/live/wait?after=${seq + 50}&timeout=1`, m),
      200,
      k,
    );
    const status = { state: 'working', thread_id: 'x' };
    await cost(
      'POST /v1/mind/status working (Core)',
      () => api('POST', '/v1/mind/status', { ...m, body: status }),
      204,
      k,
    );
    const q = await say('one owner question');
    await cost(
      'PUT /v1/messages/:id (mind reply) (Core)',
      () => api('PUT', `/v1/messages/${uuidv7()}`, { ...m, body: { body: 'The answer.', reply_to: q.body.id } }),
      201,
      k,
    );
    await cost('GET /v1/search (messages) (Core)', () => api('GET', '/v1/search?q=message', d), 200, k);
    const verb = {
      verb: 'shell.appearance',
      schema: 1,
      args: { mode: 'night' },
      why: 'the owner asked for night mode',
    };
    await cost('PUT /v1/verbs/:id (Core)', () => api('PUT', `/v1/verbs/${uuidv7()}`, { ...m, body: verb }), 201, k);
    await cost('GET /v1/verbs/pending (1 verb) (Core)', () => api('GET', '/v1/verbs/pending', d), 200, k);
    const line = {
      kind: 'line',
      schema: 1,
      payload: { text: 'Good morning.' },
      why: 'a short morning greeting',
      topic_key: 'greeting',
    };
    await cost(
      'PUT /v1/surfaces/home/:slot (Core)',
      () => api('PUT', '/v1/surfaces/home/line.1', { ...m, body: line }),
      200,
      k,
    );
    await cost('GET /v1/surfaces (1 surface) (Core)', () => api('GET', '/v1/surfaces', d), 200, k);
    const tick = async () => {
      await runInDurableObject(k as unknown as DurableObjectStub<Core>, (o: Core) => o.tick());
      return new Response(null, { status: 204 });
    };
    await cost('cron tick, the daily prune pass (Core)', tick, 204, k);
    await cost('cron tick, nothing due (Core)', tick, 204, k);
  });

  // P3: memory on a Core that already holds the P2 rows above (memory-calls.ts).
  it('measures every P3 memory endpoint against its budget', () => memoryCalls(cost, grant));

  // P3 stage D: the import (import-calls.ts).
  it('measures the import against its budget', () => importCalls(cost, grant));

  // P4 stage A: decision cards (proposal-calls.ts).
  it('measures the decision cards against their budget', () => proposalCalls(cost, grant));

  // P7: Study's library (library-calls.ts).
  it('measures the library against its budget', () => libraryCalls(cost as never, grant));

  it('every endpoint has a budget and stays within it', () => {
    const lines = Object.entries(measured).map(([k, v]) => `| ${k} | ${v.read} | ${v.written} |`);
    console.log(['| Call | Rows read | Rows written |', '|---|---|---|', ...lines].join('\n'));
    const table = budgets as Record<string, Budget>;
    expect(Object.keys(measured).sort()).toEqual(Object.keys(table).sort());
    for (const [name, rows] of Object.entries(measured)) {
      expect(rows.read, `${name} rows read`).toBeLessThanOrEqual(table[name].rows_read_max);
      expect(rows.written, `${name} rows written`).toBeLessThanOrEqual(table[name].rows_written_max);
    }
  });
});
