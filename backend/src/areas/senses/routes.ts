// /v1/senses (API.md §11.14): the phone's sealed batches of what the owner does (device only; the
// same batch again is stored once, other bytes under its id are a conflict) and the agents' fixed
// questions about them. The events' day is the owner's logical day, in the owner's zone. The eval
// sandbox has no senses (its Core is a scratch one; the owner's events never reach a fixture).
import { Hono } from 'hono';
import * as z from 'zod/mini';
import {
  SENSE_LIMITS,
  type SenseBatchResponse,
  type SenseEvent,
  type SenseQueryResponse,
} from '../../../../shared/contract/senses.ts';
import { type AppEnv, guard, principalOf } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { inSandbox } from '../../http/sandbox';
import { json } from '../../http/validate';
import { coreObject } from '../../objects/core';
import { musicObject } from '../../objects/music';
import { fresh } from '../../objects/rpc';
import { sensesObject } from '../../objects/senses';
import { sha256 } from '../import/vault';
import { SONG_ID } from '../music/shapes';
import { check } from './queries';
import { checkEvent } from './validate';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const queryBody = z.strictObject({
  name: z.string().check(z.maxLength(40)),
  params: z.record(z.string(), z.unknown()),
});
const TZ_MS = 10 * 60_000;
const noSandbox = () => {
  if (inSandbox()) throw new ApiError('validation', [{ path: 'TH-Sandbox', issue: 'the sandbox has no senses' }]);
};
let zone: { tz: string; until: number } | null = null;

/** The batch's song ratings (`music.rate`, ref `music:<id>`, `data.rating` 0–5) that pass the same
 * check the Senses object makes (a uuidv7, a time within the window, sensitivity 0), checked again
 * on every pass: the same batch sent again is answered from its record without its rejections, so
 * an event refused the first time (a time out of the window) must not slip in on a retry. A
 * rating's time is never later than now, so a phone's clock ahead can't pin it. */
function ratingsOf(events: unknown[], now: number): { id: string; rating: number; at: number }[] {
  return events.flatMap((e) => {
    const c = checkEvent(e as SenseEvent, now);
    if (typeof c === 'string' || c.type !== 'music.rate' || c.sensitivity !== 0 || !c.ref?.startsWith('music:'))
      return [];
    const id = c.ref.slice(6);
    const rating = (JSON.parse(c.data_json ?? '{}') as { rating?: unknown }).rating;
    return SONG_ID.test(id) && Number.isInteger(rating) && (rating as number) >= 0 && (rating as number) <= 5
      ? [{ id, rating: rating as number, at: Math.min(c.at, now) }]
      : [];
  });
}

/** The owner's zone (Core's private setting), kept 10 minutes in this isolate. */
async function ownerTz(env: Env): Promise<string> {
  if (zone && zone.until > Date.now()) return zone.tz;
  const s = (await coreObject(env).settings()) as { 'owner.tz'?: string };
  zone = { tz: s['owner.tz'] || env.OWNER_TZ || 'UTC', until: Date.now() + TZ_MS };
  return zone.tz;
}

export const sensesRoutes = new Hono<AppEnv>()
  .put('/senses/batches/:id', guard('PUT /v1/senses/batches/:id'), async (c) => {
    const id = c.req.param('id');
    if (!ID.test(id)) throw new ApiError('validation', [{ path: 'id', issue: 'a uuidv7' }]);
    const text = await c.req.text();
    let body: { events?: unknown };
    try {
      body = JSON.parse(text) as { events?: unknown };
    } catch {
      throw new ApiError('bad_request');
    }
    const events = body?.events;
    if (!Array.isArray(events) || events.length < 1 || events.length > SENSE_LIMITS.batch_events)
      throw new ApiError('validation', [{ path: 'events', issue: `1 to ${SENSE_LIMITS.batch_events} events` }]);
    const p = principalOf(c);
    const device = p.kind === 'device' ? p.session_id : 'agent';
    const r = await fresh(
      sensesObject(c.env).putBatch(
        id,
        await sha256(new TextEncoder().encode(text)),
        device,
        events as SenseEvent[],
        await ownerTz(c.env),
      ),
    );
    if ('conflict' in r) throw new ApiError('conflict');
    // The owner's ratings are kept for good in Music (MUSIC.md §10.5): a song rated 1 stays out of
    // find after the senses' 90 days. The same batch again hands them over again, which changes
    // nothing (the newest rating of each song wins); a failure here answers 5xx, and the phone's
    // retry of the sealed batch hands them over then.
    const rated = ratingsOf(events, Date.now());
    if (rated.length) await fresh(musicObject(c.env).putRatings(rated));
    return c.json(r satisfies SenseBatchResponse);
  })
  .post('/senses/query', guard('POST /v1/senses/query'), async (c) => {
    noSandbox();
    const { name, params } = await json(c, queryBody);
    const args = check(name, params);
    const r = (await fresh(sensesObject(c.env).query(name, args))) as SenseQueryResponse;
    return c.json(r satisfies SenseQueryResponse);
  });
