// API.md §13, P1 rows, walked principal by principal: every registered route is in the table
// with exactly its principals; without a token each guarded route answers 401, every principal
// not listed gets 403 forbidden, every listed one gets through the guard; unknown routes are
// 404 before any token check.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorBody } from '../../../shared/contract/api';
import { app } from '../../src/app';
import { PUBLIC_ROUTES, type Who } from '../../src/http/auth';
import { uuidv7 } from '../../src/lib/ids';
import { api, apiJson, auth, makeAgent, rowsDuring, setupOwner } from '../helpers';

const ALL: Who[] = ['D', 'C', 'N', 'R', 'M', 'I'];
const P = 'P';

/** API.md §13, the P1 rows, one route per line. */
const TABLE: Record<string, Who[] | typeof P> = {
  'GET /v1/health': P,
  'GET /v1/auth/state': P,
  'POST /v1/auth/setup': P,
  'POST /v1/auth/login': P,
  'POST /v1/auth/recover': P,
  'GET /v1/ops/health/deep': ['D', 'C', 'N', 'R', 'I'],
  'POST /v1/auth/signout': ['D'],
  'POST /v1/auth/password': ['D'],
  'POST /v1/auth/recovery-code': ['D'],
  'POST /v1/auth/recovery-code/confirm': ['D'],
  'POST /v1/auth/breakglass/cancel': ['D'],
  'POST /v1/auth/notices/:id/ack': ['D'],
  'GET /v1/auth/sessions': ['D'],
  'PATCH /v1/auth/sessions/:id': ['D'],
  'DELETE /v1/auth/sessions/:id': ['D'],
  'GET /v1/auth/agents': ['D'],
  'POST /v1/auth/agents': ['D'],
  'DELETE /v1/auth/agents/:id': ['D'],
  'GET /v1/auth/me': ['D', 'C', 'N', 'R', 'M', 'I'],
  'POST /v1/auth/breakglass': ['C'],
  'GET /v1/settings': ['D', 'C', 'N', 'R'],
  'PATCH /v1/settings': ['D'],
  'POST /v1/ops/errors': ['D', 'C', 'N', 'R'],
  'GET /v1/ops/errors': ['D', 'C', 'N', 'R', 'I'],
  'GET /v1/ops/meter': ['D', 'C', 'N', 'R', 'I'],
  'POST /v1/ops/errors/:fp/resolve': ['D', 'C', 'R'],
  'POST /v1/ops/perf': ['D'],
};

type RouteEntry = { method: string; path: string; handler: { who?: Who[] } };
const entries = app.routes as RouteEntry[];
// Middleware registered with .use() shows up as method ALL; real routes have a verb.
const routes = [...new Set(entries.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`))];
const guarded = Object.entries(TABLE).filter(([, who]) => who !== P) as [string, Who[]][];
const fill = (path: string) => path.replace(/:[a-z_]+/g, () => uuidv7());
const call = (route: string, token?: string) => {
  const [method, path] = route.split(' ');
  return apiJson<ErrorBody | null>(method, fill(path), { token, body: method === 'GET' ? undefined : {} });
};

const tokens = {} as Record<Who, string>;
beforeAll(async () => {
  tokens.D = (await setupOwner()).token;
  tokens.C = await makeAgent(tokens.D, 'mind:chat');
  tokens.N = await makeAgent(tokens.D, 'mind:night');
  tokens.R = await makeAgent(tokens.D, 'mind:reflex');
  tokens.M = await makeAgent(tokens.D, 'muse');
  tokens.I = await makeAgent(tokens.D, 'ci');
});

describe('route table (API.md §13)', () => {
  it('registers exactly the documented P1 routes', () => {
    expect([...routes].sort()).toEqual(Object.keys(TABLE).sort());
  });

  it('has exactly the documented public routes', () => {
    expect([...PUBLIC_ROUTES].sort()).toEqual(
      Object.entries(TABLE)
        .filter(([, w]) => w === P)
        .map(([r]) => r)
        .sort(),
    );
  });

  it.each(guarded)('%s guards for exactly its principals', (route, who) => {
    const [method, path] = route.split(' ');
    const guards = entries.filter((e) => e.method === method && e.path === path && e.handler.who);
    expect(guards).toHaveLength(1);
    expect([...(guards[0].handler.who ?? [])].sort()).toEqual([...who].sort());
  });

  it.each(guarded)('%s answers 401 without a token', async (route) => {
    const { status, body } = await call(route);
    expect(status).toBe(401);
    expect(body?.error.code).toBe('unauthorized');
  });

  it.each(guarded)('%s answers 403 to every unlisted principal and lets listed ones through', async (route, who) => {
    for (const p of ALL) {
      const { status, body } = await call(route, tokens[p]);
      if (who.includes(p)) expect([401, 403], `${p}: ${JSON.stringify(body)}`).not.toContain(status);
      else {
        expect(status, `${p} on ${route}`).toBe(403);
        expect(body?.error.code).toBe('forbidden');
      }
    }
  });

  it('answers 404 for unknown routes before any token check', async () => {
    for (const path of ['/v1/nothing-here', '/v1/auth/signin', '/v1/auth/devices', '/']) {
      const { status, body } = await apiJson<ErrorBody>('GET', path);
      expect(status, path).toBe(404);
      expect(body.error.code).toBe('not_found');
    }
    expect((await api('POST', '/v1/auth/signout-all')).status).toBe(404);
  });

  it('refuses a token with a bad checksum without asking the Auth object', async () => {
    const t = tokens.D;
    const bad = t.slice(0, 10) + (t[10] === 'a' ? 'b' : 'a') + t.slice(11);
    const rows = await rowsDuring(auth(), async () => {
      expect((await api('GET', '/v1/auth/me', { token: bad })).status).toBe(401);
      expect((await api('GET', '/v1/auth/me', { token: `${t}x` })).status).toBe(401);
    });
    expect(rows).toEqual({ read: 0, written: 0 });
  });

  it('refuses a mind key whose TH-Role names another role', async () => {
    const ok = await api('GET', '/v1/auth/me', { token: tokens.C, headers: { 'TH-Role': 'chat' } });
    expect(ok.status).toBe(200);
    const res = await api('GET', '/v1/auth/me', { token: tokens.C, headers: { 'TH-Role': 'night' } });
    expect(res.status).toBe(403);
  });
});
