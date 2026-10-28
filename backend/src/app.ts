// The Hono app, in API.md §10's order: request id and response headers → CORS (origin check,
// preflights) → client version → body limits → per-route guard (auth, then scope) → route →
// onError. Unknown routes fall through to 404 before any token check.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { authRoutes } from './areas/auth/routes';
import { opsRoutes } from './areas/ops/routes';
import type { AppEnv } from './http/auth';
import { cachedMinClient, clientVersion } from './http/client-version';
import { cors } from './http/cors';
import { ApiError, notFound, onError } from './http/errors';
import { uuidv7 } from './lib/ids';

const tooLarge = (): never => {
  throw new ApiError('too_large');
};

export const app = new Hono<AppEnv>()
  .use(async (c, next) => {
    const id = c.req.header('CF-Ray') ?? uuidv7();
    c.set('requestId', id);
    await next();
    // Private JSON: never cached, sniffed, indexed or embedded; no referrer (SECURITY.md §8).
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    c.header('Cross-Origin-Resource-Policy', 'same-origin');
    c.header('TH-Request-Id', id);
    c.header('TH-Server', c.env.VERSION.id);
    c.header('TH-Min-Client', String(cachedMinClient()));
  })
  .use(cors)
  .use('/v1/*', clientVersion)
  // Sign-in bodies are tiny; anything bigger is refused before it is parsed.
  .use('/v1/auth/*', bodyLimit({ maxSize: 4 * 1024, onError: tooLarge }))
  .use('/v1/*', bodyLimit({ maxSize: 64 * 1024, onError: tooLarge }))
  .route('/v1', opsRoutes)
  .route('/v1/auth', authRoutes)
  .notFound(notFound)
  .onError(onError);
