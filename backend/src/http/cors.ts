// CORS for the site, which lives on another site entirely (Azure static website vs workers.dev),
// per API.md §4: exact origins from SITE_ORIGINS, never credentials. A request whose Origin is
// present and not allowed (preflights included) gets 403 origin_not_allowed with no CORS
// headers, before any object call. Requests with no Origin (CLI, Actions) rely on the token.
import { cors as honoCors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './auth';
import { ApiError, errorResponse } from './errors';

export const PREFLIGHT_MAX_AGE = 7200;
export const ALLOW_HEADERS = [
  'Authorization',
  'Content-Type',
  'TH-Client',
  'TH-File-Name',
  'TH-Sha256',
  // A voice memo's length, with its upload (HOME.md §4.6).
  'TH-Seconds',
  'If-None-Match',
  'Range',
  'If-Range',
];
export const EXPOSE_HEADERS = [
  'TH-Request-Id',
  'TH-Server',
  'TH-Min-Client',
  'Retry-After',
  'ETag',
  // A podcast episode streamed in byte ranges (PODCASTS.md §4.4).
  'Content-Range',
  'Accept-Ranges',
];

const parsed = new Map<string, Set<string>>();

/** The allowlist from a comma-separated var, parsed once per isolate. */
export function allowedOrigins(list: string): Set<string> {
  let set = parsed.get(list);
  if (!set) {
    set = new Set(
      list
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    parsed.set(list, set);
  }
  return set;
}

export const cors = createMiddleware<AppEnv>((c, next) => {
  const origin = c.req.header('Origin');
  if (origin !== undefined && !allowedOrigins(c.env.SITE_ORIGINS).has(origin))
    return Promise.resolve(errorResponse(c, new ApiError('origin_not_allowed')));
  return honoCors({
    origin: (o) => o,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowHeaders: ALLOW_HEADERS,
    exposeHeaders: EXPOSE_HEADERS,
    maxAge: PREFLIGHT_MAX_AGE,
    credentials: false,
  })(c, next);
});
