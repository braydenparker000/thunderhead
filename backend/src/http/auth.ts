// Who is calling, and may they (API.md §3, §13). Default deny: every route outside PUBLIC_ROUTES
// carries a `guard('<METHOD> <path>')` that takes its principals from the shared route table
// (shared/contract/routes.ts), and route-scopes.test.ts walks them all.
// The guard checks the token's prefix and checksum before any object call, then the isolate
// cache (60 s, positive results only), then Auth. Unknown routes never reach a guard, so they
// answer 404 before any token check.
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { ROUTES, type RouteKey, type RouteSpec, type Who } from '../../../shared/contract/routes.ts';
import type { Principal } from '../areas/auth/account';
import { tokenHash } from '../areas/auth/crypto';
import { checkToken } from '../areas/auth/tokens';
import { authObject } from '../objects/auth';
import { coreObject } from '../objects/core';
import { ApiError } from './errors';
import { inScope, NOT_ATTEMPTS, SANDBOX_HEADER } from './sandbox';

export type { Who };

export type AppEnv = {
  Bindings: Env;
  Variables: { principal?: Principal & { token_hash: string }; requestId: string };
};

/** `METHOD path` pairs reachable without a token: the contract's `P` rows. */
export const PUBLIC_ROUTES: ReadonlySet<string> = new Set(
  Object.entries(ROUTES)
    .filter(([, r]) => r.who === 'P')
    .map(([k]) => k),
);

const LETTER: Record<string, Who> = { 'mind:chat': 'C', 'mind:night': 'N', 'mind:reflex': 'R', muse: 'M', ci: 'I' };

export function whoOf(p: Principal): Who {
  return p.kind === 'device' ? 'D' : LETTER[p.role];
}

export const PRINCIPAL_CACHE_MS = 60_000;
const CACHE_LIMIT = 64;
const cache = new Map<string, { principal: Principal; until: number }>();

/** Drops cached principals in this isolate: the given session or agent ids, or all of them. */
export function forget(ids?: string[]): void {
  if (!ids) {
    cache.clear();
    return;
  }
  const set = new Set(ids);
  for (const [hash, { principal: p }] of cache)
    if (set.has(p.kind === 'device' ? p.session_id : p.agent_id)) cache.delete(hash);
}

export function country(c: Context<AppEnv>): string | null {
  return (c.req.raw.cf as { country?: string } | undefined)?.country ?? null;
}

async function authenticate(c: Context<AppEnv>): Promise<Principal & { token_hash: string }> {
  const m = /^Bearer (\S+)$/.exec(c.req.header('Authorization') ?? '');
  const prefix = m ? checkToken(m[1]) : null;
  // Malformed tokens and bad checksums are refused here, before they cost an object request.
  if (!m || !prefix) throw new ApiError('unauthorized');
  const hash = tokenHash(m[1]);
  const now = Date.now();
  const hit = cache.get(hash);
  if (hit && hit.until > now) return { ...hit.principal, token_hash: hash };
  const result = await authObject(c.env).verify(hash, prefix !== 'th1', country(c));
  if (!result.ok) {
    cache.delete(hash);
    const reason = result.details && !Array.isArray(result.details) ? result.details : undefined;
    throw new ApiError(result.code, reason);
  }
  const { ok: _ok, ...principal } = result;
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(hash, { principal, until: now + PRINCIPAL_CACHE_MS });
  return { ...principal, token_hash: hash };
}

/** The route guard: 401 without a valid token, 403 forbidden for a principal not listed. A mind
 * key whose TH-Role header names another role is refused too (the key's role is what counts).
 * With `name` (RouteSpec.key), an agent must also be the key of exactly that name; a device is
 * the owner and needs no name. */
export function allow(who: readonly Who[], name?: string, key?: string) {
  const mw = createMiddleware<AppEnv>(async (c, next) => {
    const p = await authenticate(c);
    if (!who.includes(whoOf(p))) throw new ApiError('forbidden');
    if (name !== undefined && p.kind === 'agent' && p.name !== name) throw new ApiError('forbidden');
    const role = c.req.header('TH-Role');
    if (role && p.kind === 'agent' && p.role.startsWith('mind:') && `mind:${role}` !== p.role)
      throw new ApiError('forbidden');
    c.set('principal', p);
    const sandbox = c.req.header(SANDBOX_HEADER);
    if (sandbox === undefined) return next();
    // The eval sandbox (http/sandbox.ts): chat and night keys only, never a named key's route.
    if (
      sandbox !== 'eval' ||
      name !== undefined ||
      p.kind !== 'agent' ||
      (p.role !== 'mind:chat' && p.role !== 'mind:night')
    )
      throw new ApiError('forbidden');
    await inScope(async () => {
      try {
        await next();
      } finally {
        if (key && c.req.method !== 'GET' && !NOT_ATTEMPTS.has(key))
          c.executionCtx.waitUntil(
            coreObject(c.env)
              .evalAttempt(key, c.res?.status ?? 500)
              .catch(() => {}),
          );
      }
    });
  });
  // Tagged so the route test can compare every guard with API.md §13.
  return Object.assign(mw, { who, named: name });
}

/** The guard for one row of the shared route table: its principals come from the contract, so
 * the table and the Worker cannot drift. The key is checked against the registered path by the
 * route-scope test. */
export function guard(key: RouteKey) {
  const spec: RouteSpec = ROUTES[key];
  if (spec.who === 'P' || spec.auth) throw new Error(`${key} has no bearer guard`);
  return Object.assign(allow(spec.who, spec.key, key), { key });
}

/** The principal of a guarded route. */
export function principalOf(c: { get(key: 'principal'): AppEnv['Variables']['principal'] }) {
  const p = c.get('principal');
  if (!p) throw new ApiError('unauthorized');
  return p;
}

/** The device session of a device-only route. */
export function deviceOf(c: { get(key: 'principal'): AppEnv['Variables']['principal'] }) {
  const p = principalOf(c);
  if (p.kind !== 'device') throw new ApiError('forbidden');
  return p;
}
