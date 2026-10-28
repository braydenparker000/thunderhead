// Who is calling, and may they (API.md §3, §13). Default deny: every route outside PUBLIC_ROUTES
// carries an `allow(...)` guard naming its principals, and route-scopes.test.ts walks them all.
// The guard checks the token's prefix and checksum before any object call, then the isolate
// cache (60 s, positive results only), then Auth. Unknown routes never reach a guard, so they
// answer 404 before any token check.
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Principal } from '../areas/auth/account';
import { tokenHash } from '../areas/auth/crypto';
import { checkToken } from '../areas/auth/tokens';
import { authObject } from '../objects/auth';
import { ApiError } from './errors';

/** D device · C mind:chat · N mind:night · R mind:reflex · M muse · I ci (API.md §13). */
export type Who = 'D' | 'C' | 'N' | 'R' | 'M' | 'I';

export type AppEnv = {
  Bindings: Env;
  Variables: { principal?: Principal & { token_hash: string }; requestId: string };
};

/** `METHOD path` pairs reachable without a token. */
export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  'GET /v1/health',
  'GET /v1/auth/state',
  'POST /v1/auth/setup',
  'POST /v1/auth/login',
  'POST /v1/auth/recover',
]);

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
 * key whose TH-Role header names another role is refused too (the key's role is what counts). */
export function allow(...who: Who[]) {
  const mw = createMiddleware<AppEnv>(async (c, next) => {
    const p = await authenticate(c);
    if (!who.includes(whoOf(p))) throw new ApiError('forbidden');
    const role = c.req.header('TH-Role');
    if (role && p.kind === 'agent' && p.role.startsWith('mind:') && `mind:${role}` !== p.role)
      throw new ApiError('forbidden');
    c.set('principal', p);
    await next();
  });
  // Tagged so the route test can compare every guard with API.md §13.
  return Object.assign(mw, { who });
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
