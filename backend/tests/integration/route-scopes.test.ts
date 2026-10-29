// API.md §13 walked principal by principal, from the shared route table (shared/contract/
// routes.ts), so the table, the guards and this test cannot drift: every registered route is a
// built row with exactly its principals; without a token each guarded route answers 401, every
// principal not listed gets 403 forbidden, every listed one gets through the guard (on a keyed
// route an agent only as the key of that name: any other key of its role is 403); unknown routes
// are 404 before any token check; the ticket-only socket refuses anything but a ticket.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorBody } from '../../../shared/contract/api';
import { builtRoutes, type RouteSpec } from '../../../shared/contract/routes.ts';
import { app } from '../../src/app';
import { PUBLIC_ROUTES, type Who } from '../../src/http/auth';
import { uuidv7 } from '../../src/lib/ids';
import { api, apiJson, auth, makeAgent, rowsDuring, setupOwner } from '../helpers';

const ALL: Who[] = ['D', 'C', 'N', 'R', 'M', 'I'];
const P = 'P';

const BUILT = builtRoutes() as [string, RouteSpec][];
/** The built rows: principals, or P for public, or T for the ticket-only socket. */
const TABLE: Record<string, Who[] | typeof P | 'T'> = Object.fromEntries(
  BUILT.map(([k, r]) => [k, r.auth === 'ticket' ? 'T' : r.who === 'P' ? P : [...r.who]]),
);

type RouteEntry = { method: string; path: string; handler: { who?: Who[]; key?: string; named?: string } };
const entries = app.routes as RouteEntry[];
// Middleware registered with .use() shows up as method ALL; real routes have a verb.
const routes = [...new Set(entries.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`))];
const guarded = Object.entries(TABLE).filter(([, who]) => Array.isArray(who)) as [string, Who[]][];
/** Keyed rows (RouteSpec.key): an agent must be the key of exactly that name. */
const KEYED = Object.fromEntries(BUILT.filter(([, r]) => r.key).map(([k, r]) => [k, r.key as string]));
const fill = (path: string) => path.replace(/:[a-z_]+/g, () => uuidv7());
const call = (route: string, token?: string) => {
  const [method, path] = route.split(' ');
  return apiJson<ErrorBody | null>(method, fill(path), { token, body: method === 'GET' ? undefined : {} });
};

const tokens = {} as Record<Who, string>;
/** A Mind · chat key with each keyed row's name (all `import-once` today). */
const named = {} as Record<string, string>;
const tokenFor = (route: string, p: Who) => (KEYED[route] && p !== 'D' ? named[KEYED[route]] : tokens[p]);
beforeAll(async () => {
  tokens.D = (await setupOwner()).token;
  tokens.C = await makeAgent(tokens.D, 'mind:chat');
  for (const name of new Set(Object.values(KEYED))) named[name] = await makeAgent(tokens.D, 'mind:chat', name);
  tokens.N = await makeAgent(tokens.D, 'mind:night');
  tokens.R = await makeAgent(tokens.D, 'mind:reflex');
  tokens.M = await makeAgent(tokens.D, 'muse');
  tokens.I = await makeAgent(tokens.D, 'ci');
});

describe('route table (API.md §13)', () => {
  it('registers exactly the built rows of the shared route table', () => {
    expect([...routes].sort()).toEqual(Object.keys(TABLE).sort());
  });

  it("names each guard's own route", () => {
    for (const e of entries.filter((e) => e.handler.key)) expect(e.handler.key).toBe(`${e.method} ${e.path}`);
    expect(entries.filter((e) => e.handler.key).length).toBe(guarded.length);
  });

  it('the live socket takes only a ticket: 400 without an upgrade, 401 with a bad or used ticket', async () => {
    expect((await api('GET', `/v1/live?ticket=thw_${'0'.repeat(22)}`)).status).toBe(400);
    const upgrade = { Upgrade: 'websocket' };
    expect((await api('GET', '/v1/live', { headers: upgrade })).status).toBe(401);
    expect((await api('GET', `/v1/live?ticket=thw_${'0'.repeat(22)}`, { headers: upgrade })).status).toBe(401);
    expect((await api('GET', '/v1/live?ticket=x', { token: tokens.D, headers: upgrade })).status).toBe(401);
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
    expect(guards[0].handler.named).toBe(KEYED[route]);
  });

  it.each(guarded)('%s answers 401 without a token', async (route) => {
    const { status, body } = await call(route);
    expect(status).toBe(401);
    expect(body?.error.code).toBe('unauthorized');
  });

  it.each(guarded)('%s answers 403 to every unlisted principal and lets listed ones through', async (route, who) => {
    for (const p of ALL) {
      const { status, body } = await call(route, who.includes(p) ? tokenFor(route, p) : tokens[p]);
      if (who.includes(p)) expect([401, 403], `${p}: ${JSON.stringify(body)}`).not.toContain(status);
      else {
        expect(status, `${p} on ${route}`).toBe(403);
        expect(body?.error.code).toBe('forbidden');
      }
    }
  });

  it('a keyed route refuses every other key of its roles (the routine chat key on the import)', async () => {
    expect(Object.keys(KEYED).sort()).toEqual([
      'POST /v1/import/runs',
      'POST /v1/ops/import/parts',
      'PUT /v1/ops/import/manifest/:run_id',
    ]);
    for (const route of Object.keys(KEYED)) {
      const { status, body } = await call(route, tokens.C);
      expect([status, body?.error.code], route).toEqual([403, 'forbidden']);
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
