// /v1/astra (ASTRA.md §4.4, §5; API.md §11.21; SECURITY.md §8.2; owner rulings 2026-11-18): the
// film's direct address for Astra, for the owner's device only (agent keys get 403 from the route
// table). POST /play tries TorBox with the owner's key (direct.ts); when TorBox says for certain the
// film is not cached, that is the answer (503), since following the add-on's link is how an add-on
// adds an uncached torrent. Otherwise it answers no address and the page plays the add-on's own link
// itself: an add-on may tie a link to the connection that asked for the stream list, so the Worker
// opening it can get an error clip and spoil the link (the owner's phone, 2026-11-18). Following the
// forward here (follow.ts) is kept for a later try, only with the Worker variable ASTRA_FOLLOW "on".
// Mode "ahead" never adds to TorBox and never follows a link. GET /torbox says whether the key is
// set and taken. Addresses, hashes, file names and the key travel only in the request body,
// upstream calls and the answer: never a path, a query, a log line or stored row; notes and reasons
// are fixed sentences (words.ts). Counted per isolate in memory like dictation (no object written):
// taps and GET /torbox 30 a minute, then 429; presses ("ahead") 60 a minute on their own count, then
// no address, so presses never starve a tap.
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
import { direct, NOT_CACHED, READY } from './direct';
import { follow } from './follow';
import { account } from './torbox';
import { mark, relayFor } from './upstream';
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

type Minute = { start: number; n: number };
let taps: Minute = { start: 0, n: 0 };
let presses: Minute = { start: 0, n: 0 };
/** For tests: a fresh minute for both counts. */
export function forgetMinute(): void {
  taps = { start: 0, n: 0 };
  presses = { start: 0, n: 0 };
}
/** Seconds until this count takes another request; 0 when it takes this one now. */
function waitFor(m: Minute, max: number, now = Date.now()): number {
  if (now - m.start >= 60_000) Object.assign(m, { start: now, n: 0 });
  return ++m.n <= max ? 0 : Math.max(1, Math.ceil((m.start + 60_000 - now) / 1000));
}
/** A tap or GET /torbox past its count is 429, with the seconds until the next one. */
function capTap(): void {
  const retry_after = waitFor(taps, L.per_minute);
  if (retry_after) throw new ApiError('rate_limited', { reason: REASON.tooMany }, { retry_after, scope: 'account' });
}
const NONE = { url: null, via: null, size: null, type: null, readable: null, ready: false } as const;

export const astraRoutes = new Hono<AppEnv>()
  .post('/astra/play', guard('POST /v1/astra/play'), async (c) => {
    const body = await json(c, playBody);
    const started = Date.now();
    const answer = (a: Omit<AstraPlayResponse, 'steps' | 'total_ms'>, steps: AstraPlayResponse['steps']) =>
      c.json({ ...a, steps, total_ms: Date.now() - started } satisfies AstraPlayResponse);
    // A press past its own count gets no address, as when it finds nothing: never a 429.
    if (body.mode === 'ahead' && waitFor(presses, L.ahead_per_minute)) return answer(NONE, []);
    if (body.mode === 'play') capTap();
    const r = relayFor(c);
    const found = await direct(r, r.key, {
      hash: body.hash?.toLowerCase() ?? null,
      mode: body.mode,
      fileIndex: body.fileIndex ?? null,
      fileName: body.fileName ?? null,
      fileSize: body.fileSize ?? null,
    });
    if (found && 'url' in found) return answer({ ...found, via: 'torbox', readable: null, ready: false }, r.steps);
    // Before a tap nothing that could add to TorBox is followed: no address yet (ready: TorBox has it).
    if (body.mode === 'ahead') return answer({ ...NONE, ready: found === READY }, r.steps);
    // Not on TorBox, for certain: following the add-on would let it add an uncached torrent.
    if (found === NOT_CACHED) throw new ApiError('unavailable', { reason: REASON.notOnTorbox, steps: r.steps });
    if (c.env.ASTRA_FOLLOW !== 'on') {
      mark(r, 'follow', false, Date.now(), NOTE.followOff);
      return answer(NONE, r.steps);
    }
    const f = await follow(r, body.link);
    if (!f.ok) throw new ApiError(f.code, { reason: f.reason, steps: r.steps });
    return answer(
      { url: f.url, via: 'follow', size: f.size, type: f.type, readable: f.readable, ready: false },
      r.steps,
    );
  })
  .get('/astra/torbox', guard('GET /v1/astra/torbox'), async (c) => {
    capTap();
    const r = relayFor(c);
    if (!r.key)
      return c.json({ configured: false, ok: null, plan: null, note: NOTE.noKey } satisfies AstraTorboxResponse);
    return c.json({ configured: true, ...(await account(r, r.key)) } satisfies AstraTorboxResponse);
  });
