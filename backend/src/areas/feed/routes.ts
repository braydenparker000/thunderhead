// /v1/live, /v1/live/ticket, /v1/live/wait and /v1/changes (API.md §11.5, §11.6, §12). The phone
// trades its bearer token for a 30-second single-use ticket and opens the socket with it; the
// mind's wait is a take, then (if nothing was there) one held wait behind the seam in wait.ts,
// then a second take.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import type { ChangesResponse, LiveTicket, LiveWaitResponse } from '../../../../shared/contract/api';
import { type AppEnv, deviceOf, guard } from '../../http/auth';
import { callerOf } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { parse } from '../../http/validate';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { tokenHash } from '../auth/crypto';
import { newLiveTicket } from '../auth/tokens';
import { waitForChange } from './wait';

const TICKET_MS = 30_000;
const TICKET = /^thw_[0-9A-Za-z]{22}$/;

const waitQuery = z.object({
  after: z.coerce.number().check(z.int(), z.gte(0)),
  timeout: z.optional(z.coerce.number().check(z.int(), z.gte(1))),
});
const changesQuery = z.object({
  after: z.coerce.number().check(z.int(), z.gte(0)),
  limit: z.optional(z.coerce.number().check(z.int(), z.gte(1), z.lte(500))),
});

export const feedRoutes = new Hono<AppEnv>()
  .post('/live/ticket', guard('POST /v1/live/ticket'), async (c) => {
    const ticket = newLiveTicket();
    const expires_at = Date.now() + TICKET_MS;
    await coreObject(c.env).liveTicket(tokenHash(ticket), deviceOf(c).session_id, expires_at);
    return c.json({ ticket, expires_at } satisfies LiveTicket);
  })
  // The socket's only proof is the ticket (contract row `auth: 'ticket'`), never a bearer token.
  .get('/live', async (c) => {
    if (c.req.header('Upgrade') !== 'websocket') throw new ApiError('bad_request');
    const ticket = c.req.query('ticket') ?? '';
    if (!TICKET.test(ticket)) throw new ApiError('unauthorized');
    const core = coreObject(c.env);
    const session = await core.consumeTicket(tokenHash(ticket));
    if (!session) throw new ApiError('unauthorized');
    return core.fetch('https://core/live', { headers: { Upgrade: 'websocket', 'TH-Live-Session': session } });
  })
  .get('/live/wait', guard('GET /v1/live/wait'), async (c) => {
    const q = parse(waitQuery, c.req.query());
    const ms = Math.min(q.timeout ?? 25, 25) * 1000;
    const core = coreObject(c.env);
    const who = callerOf(c);
    let take = await core.liveTake(who, q.after);
    if (!take.changed && take.signals.length === 0 && (await waitForChange(c.env, take.seq, ms)) === 'changed')
      take = await core.liveTake(who, take.seq);
    return c.json(take satisfies LiveWaitResponse);
  })
  .get('/changes', guard('GET /v1/changes'), async (c) => {
    const q = parse(changesQuery, c.req.query());
    return c.json(value(await coreObject(c.env).changes(q.after, q.limit ?? 200)) satisfies ChangesResponse);
  });
