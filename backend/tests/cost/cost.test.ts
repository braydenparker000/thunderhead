// Cost (TESTING.md §6): rows read and written per endpoint, from the objects' own cursor meters,
// against tests/cost/budgets.json. These are the units the free plan bills (5M read, 100k written
// a day). An endpoint without a budget fails; a budget rises only with DATA.md §8.2 and
// PERFORMANCE.md §4. The budgets are the numbers measured in local workerd (MEASUREMENTS.md §2).
import { describe, expect, it } from 'vitest';
import type { SignedIn, SignedInWithCode } from '../../../shared/contract/api';
import {
  api,
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
  it('measures every P1 endpoint against its budget', async () => {
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
