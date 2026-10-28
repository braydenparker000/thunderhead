// Client skew (API.md §5, ARCHITECTURE.md §6): a site build below the Core setting `min_client`
// may read but not write (426 client_outdated). The setting is cached per isolate for 60 s, so
// a write costs at most one Core read a minute; health and the TH-Min-Client header report the
// cached value without any object call.
import { createMiddleware } from 'hono/factory';
import { coreObject } from '../objects/core';
import type { AppEnv } from './auth';
import { ApiError } from './errors';

export const MIN_CLIENT_CACHE_MS = 60_000;
const WRITES = new Set(['PUT', 'POST', 'PATCH', 'DELETE']);
/** `<build>.<sha7>` from the site; `th/…`, `ci/…` and `muse/…` clients are not site builds. */
const SITE_CLIENT = /^(\d{1,9})\.[0-9a-f]{7}$/;

let cache: { value: number; until: number } | null = null;

export function cachedMinClient(): number {
  return cache?.value ?? 0;
}

export function rememberMinClient(value: number): void {
  cache = { value, until: Date.now() + MIN_CLIENT_CACHE_MS };
}

export async function minClient(env: Env): Promise<number> {
  if (cache && cache.until > Date.now()) return cache.value;
  const value = await coreObject(env).minClient();
  rememberMinClient(value);
  return value;
}

/** The site build in a TH-Client header, or null for other clients and a missing header. */
export function siteBuild(header: string | undefined): number | null {
  const m = SITE_CLIENT.exec(header ?? '');
  return m ? Number(m[1]) : null;
}

export const clientVersion = createMiddleware<AppEnv>(async (c, next) => {
  const build = WRITES.has(c.req.method) ? siteBuild(c.req.header('TH-Client')) : null;
  if (build !== null) {
    const min = await minClient(c.env);
    if (build < min) throw new ApiError('client_outdated', { min_client: min });
  }
  await next();
});
