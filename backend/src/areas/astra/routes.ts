// /v1/astra (ASTRA.md §4.4, §5; API.md §11.21; SECURITY.md §8.2; owner rulings 2026-11-18): the
// film's direct address for Astra, for the owner's device only (agent keys get 403 from the route
// table). POST /play tries TorBox with the owner's key (direct.ts), then, in mode "play", follows
// the add-on's forward (follow.ts); mode "ahead" never adds to TorBox and never follows a link.
// GET /torbox says whether the key is set and taken. Addresses, hashes, file names and the key
// travel only in the request body, upstream calls and the answer: never a path, a query, a log line
// or stored row; notes and reasons are fixed sentences (words.ts). One isolate takes at most 30
// requests a minute, counted in memory like dictation (no object is written).
import { Hono } from 'hono';
import * as z from 'zod/mini';
import {
  ASTRA_MODES,
  type AstraPlayResponse,
  type AstraTorboxResponse,
  ASTRA_LIMITS as L,
} from '../../../../shared/contract/astra.ts';
import { type AppEnv, guard } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { json } from '../../http/validate';
import { present } from '../../lib/secrets';
import { direct } from './direct';
import { follow } from './follow';
import { account } from './torbox';
import { relayFor } from './upstream';
import { NOTE, REASON } from './words';

/** Optional, and `null` is the same as leaving it out. */
const maybe = <T extends z.ZodMiniType>(s: T) => z.optional(z.nullable(s));
const playBody = z.object({
  link: z.string().check(z.minLength(1), z.maxLength(L.link_chars)),
  hash: maybe(z.string().check(z.regex(/^[0-9a-fA-F]{40}$/))),
  fileIndex: maybe(z.number().check(z.int(), z.gte(0), z.lte(1_000_000))),
  fileName: maybe(z.string().check(z.minLength(1), z.maxLength(L.name_chars))),
  fileSize: maybe(z.number().check(z.int(), z.gte(0), z.lte(Number.MAX_SAFE_INTEGER))),
  mode: z.enum(ASTRA_MODES),
});

let minute = { start: 0, n: 0 };
/** For tests: a fresh minute. */
export function forgetMinute(): void {
  minute = { start: 0, n: 0 };
}
/** 429 past this isolate's requests for the minute, with the seconds until the next one. */
function cap(now = Date.now()): void {
  if (now - minute.start >= 60_000) minute = { start: now, n: 0 };
  if (++minute.n <= L.per_minute) return;
  const retry_after = Math.max(1, Math.ceil((minute.start + 60_000 - now) / 1000));
  throw new ApiError('rate_limited', { reason: REASON.tooMany }, { retry_after, scope: 'account' });
}

export const astraRoutes = new Hono<AppEnv>()
  .post('/astra/play', guard('POST /v1/astra/play'), async (c) => {
    cap();
    const body = await json(c, playBody);
    const r = relayFor(c);
    const found = await direct(r, present(c.env.TORBOX_KEY), {
      hash: body.hash?.toLowerCase() ?? null,
      mode: body.mode,
      fileIndex: body.fileIndex ?? null,
      fileName: body.fileName ?? null,
      fileSize: body.fileSize ?? null,
    });
    const answer = (a: Omit<AstraPlayResponse, 'steps'>) =>
      c.json({ ...a, steps: r.steps } satisfies AstraPlayResponse);
    if (found) return answer({ ...found, via: 'torbox', readable: null });
    // Before a tap nothing that could add to TorBox is followed: no address yet.
    if (body.mode === 'ahead') return answer({ url: null, via: null, size: null, type: null, readable: null });
    const f = await follow(r, body.link);
    if (!f.ok) throw new ApiError(f.code, { reason: f.reason, steps: r.steps });
    return answer({ url: f.url, via: 'follow', size: f.size, type: f.type, readable: f.readable });
  })
  .get('/astra/torbox', guard('GET /v1/astra/torbox'), async (c) => {
    cap();
    const key = present(c.env.TORBOX_KEY);
    if (!key)
      return c.json({ configured: false, ok: null, plan: null, note: NOTE.noKey } satisfies AstraTorboxResponse);
    return c.json({ configured: true, ...(await account(relayFor(c), key)) } satisfies AstraTorboxResponse);
  });
