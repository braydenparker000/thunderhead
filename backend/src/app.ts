// The Hono app, in API.md §10's order: request id and response headers → CORS (origin check,
// preflights) → client version → body limits → per-route guard (auth, then scope) → route →
// onError. Unknown routes fall through to 404 before any token check.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { FILE_LIMITS } from '../../shared/contract/files.ts';
import { IMPORT_PART_BYTES } from '../../shared/contract/imports.ts';
import { LIBRARY_LIMITS } from '../../shared/contract/library.ts';
import { authRoutes } from './areas/auth/routes';
import { backupsRoutes } from './areas/backups/routes';
import { briefingRoutes } from './areas/briefing/routes';
import { conversationRoutes } from './areas/conversation/routes';
import { evalsRoutes } from './areas/evals/routes';
import { feedRoutes } from './areas/feed/routes';
import { filesRoutes } from './areas/files/routes';
import { guitarRoutes } from './areas/guitar/routes';
import { importRoutes } from './areas/import/routes';
import { insightRoutes } from './areas/insight/routes';
import { ledgerRoutes } from './areas/ledger/routes';
import { ingestRoutes } from './areas/library/ingest';
import { libraryRoutes } from './areas/library/routes';
import { scriptureRoutes } from './areas/library/scripture';
import { memoryRoutes } from './areas/memory/routes';
import { mindRoutes } from './areas/mind/routes';
import { musicRoutes } from './areas/music/routes';
import { BIG_OPS, UPLOAD_LIMITS, uploadRoutes } from './areas/music/upload';
import { opsRoutes } from './areas/ops/routes';
import { podcastsRoutes } from './areas/podcasts/routes';
import { predictionsRoutes } from './areas/predictions/routes';
import { proposalsRoutes } from './areas/proposals/routes';
import { pushRoutes } from './areas/push/routes';
import { remindersRoutes } from './areas/reminders/routes';
import { searchRoutes } from './areas/search/routes';
import { sensesRoutes } from './areas/senses/routes';
import { surfacesRoutes } from './areas/surfaces/routes';
import { verbsRoutes } from './areas/verbs/routes';
import { watchdogsRoutes } from './areas/watchdogs/routes';
import { workRoutes } from './areas/work/routes';
import type { AppEnv } from './http/auth';
import { cachedMinClient, clientVersion } from './http/client-version';
import { cors } from './http/cors';
import { ApiError, notFound, onError } from './http/errors';
import { uuidv7 } from './lib/ids';

const tooLarge = (): never => {
  throw new ApiError('too_large');
};
const small = bodyLimit({ maxSize: 64 * 1024, onError: tooLarge });
// The old export's parts (≤ 25 MiB each, checked again in the route) and its manifest are the
// only big bodies.
const part = bodyLimit({ maxSize: IMPORT_PART_BYTES, onError: tooLarge });
const manifest = bodyLimit({ maxSize: 1024 * 1024, onError: tooLarge });
// The music upload tools' audio, art and batch operations (areas/music/upload.ts, which checks
// each against its signed size too).
const [audio, art, batch] = [UPLOAD_LIMITS.audio, UPLOAD_LIMITS.art, UPLOAD_LIMITS.batch].map((maxSize) =>
  bodyLimit({ maxSize, onError: tooLarge }),
);
const UPLOADS = '/v1/music/uploads/';
// A batch of sense events (API.md §8).
const batchOfEvents = bodyLimit({ maxSize: 256 * 1024, onError: tooLarge });
// A book's upload part (streamed, its exact size checked in the route) and a batch of 50 pages.
const bookPart = bodyLimit({ maxSize: LIBRARY_LIMITS.part_bytes, onError: tooLarge });
const pages = bodyLimit({ maxSize: 16 * 1024 * 1024, onError: tooLarge });
const BOOK_PART = /^\/v1\/library\/books\/[^/]+\/parts\/[^/]+$/;
const BOOK_PAGES = /^\/v1\/library\/books\/[^/]+\/pages$/;
// The private scripture table and one book's verse text (checked again in the route).
const scripture = bodyLimit({ maxSize: LIBRARY_LIMITS.text_bytes, onError: tooLarge });
// A chat file (HOME.md §4.6), one upload; GET has no body.
const chatFile = bodyLimit({ maxSize: FILE_LIMITS.bytes, onError: tooLarge });
const limitFor = (path: string) =>
  path.startsWith('/v1/files/')
    ? chatFile
    : path === '/v1/ops/import/parts'
      ? part
      : path.startsWith('/v1/ops/import/manifest/')
        ? manifest
        : path.startsWith(`${UPLOADS}audio/`)
          ? audio
          : path.startsWith(`${UPLOADS}art/`)
            ? art
            : path.startsWith(UPLOADS) && BIG_OPS.has(path.slice(UPLOADS.length))
              ? batch
              : path.startsWith('/v1/senses/batches/')
                ? batchOfEvents
                : BOOK_PART.test(path)
                  ? bookPart
                  : BOOK_PAGES.test(path)
                    ? pages
                    : path.startsWith('/v1/library/scripture')
                      ? scripture
                      : small;

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
  .use('/v1/*', (c, next) => limitFor(c.req.path)(c, next))
  .route('/v1', opsRoutes)
  .route('/v1/auth', authRoutes)
  // Each area mounts its own routes; the contract (shared/contract/routes.ts) names them all.
  .route('/v1', feedRoutes)
  .route('/v1', conversationRoutes)
  .route('/v1', searchRoutes)
  .route('/v1', mindRoutes)
  .route('/v1', ledgerRoutes)
  .route('/v1', verbsRoutes)
  .route('/v1', surfacesRoutes)
  .route('/v1', memoryRoutes)
  .route('/v1', importRoutes)
  .route('/v1', proposalsRoutes)
  .route('/v1', evalsRoutes)
  .route('/v1', predictionsRoutes)
  .route('/v1', insightRoutes)
  .route('/v1', watchdogsRoutes)
  .route('/v1', backupsRoutes)
  .route('/v1', workRoutes)
  .route('/v1', briefingRoutes)
  .route('/v1', musicRoutes)
  .route('/v1', uploadRoutes)
  .route('/v1', sensesRoutes)
  .route('/v1', guitarRoutes)
  .route('/v1', podcastsRoutes)
  .route('/v1', pushRoutes)
  .route('/v1', remindersRoutes)
  .route('/v1', filesRoutes)
  .route('/v1', libraryRoutes)
  .route('/v1', ingestRoutes)
  .route('/v1', scriptureRoutes)
  .notFound(notFound)
  .onError(onError);
