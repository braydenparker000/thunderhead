// /v1/verbs (API.md §11.11): agents queue (a Worker-side verb runs at once, or with `fire_at` at that
// time) and post plans, a signed-in phone takes, runs and reports; an app asks for its own pending
// intents with `?app=`; the owner and the mind list and cancel what is scheduled. The verb vocabulary and its
// schemas are the contract's (shared/contract/verbs.ts). GET /v1/music/mixes lists the mixes
// `music.mix_save` kept.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import type {
  JsonObject,
  MusicMixesResponse,
  MusicMixSongs,
  PlanAnswer,
  PostPlanRequest,
  PutVerbRequest,
  ScheduledResponse,
  Verb,
  VerbAnswer,
  VerbResultRequest,
} from '../../../../shared/contract/api';
import { APP_IDS } from '../../../../shared/contract/feed.ts';
import { FIRE_AT, PLAN_LIMITS } from '../../../../shared/contract/schedules.ts';
import { type AppEnv, deviceOf, guard } from '../../http/auth';
import { callerOf, idParam, reqHash } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { inSandbox } from '../../http/sandbox';
import { json } from '../../http/validate';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { musicObject } from '../../objects/music';
import { fresh } from '../../objects/rpc';
import { sensesObject } from '../../objects/senses';
import { parseFind } from '../music/find';
import type { Prepared } from './ops';

const args = z.record(z.string(), z.json());
const verbName = z.string().check(z.regex(/^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/));
const schema = z.number().check(z.int(), z.gte(1), z.lte(99));
const why = z.string().check(z.minLength(8), z.maxLength(200));
const ref = z.optional(z.string().check(z.maxLength(200)));
const deviceId = z.optional(z.string().check(z.maxLength(40)));
const proposalId = z.optional(z.string().check(z.maxLength(40)));
const fireAt = z.optional(z.string().check(z.regex(FIRE_AT)));
const putBody = z.strictObject({
  verb: verbName,
  schema,
  args,
  why,
  ref,
  device_id: deviceId,
  expires_at: z.optional(z.number().check(z.int())),
  proposal_id: proposalId,
  fire_at: fireAt,
}) satisfies z.ZodMiniType<PutVerbRequest>;
const planBody = z.strictObject({
  id: z.string().check(z.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)),
  steps: z
    .array(z.strictObject({ verb: verbName, schema, args, device_id: deviceId }))
    .check(z.minLength(PLAN_LIMITS.min_steps), z.maxLength(PLAN_LIMITS.max_steps)),
  why,
  what: z.string().check(z.minLength(1), z.maxLength(PLAN_LIMITS.what)),
  ref,
  fire_at: fireAt,
  proposal_id: proposalId,
}) satisfies z.ZodMiniType<PostPlanRequest>;
const resultBody = z.strictObject({
  ok: z.boolean(),
  result: z.optional(z.json()),
  undo: z.optional(
    z.strictObject({ verb: z.string().check(z.maxLength(60)), schema: z.optional(z.number().check(z.int())), args }),
  ),
  error: z.optional(
    z.strictObject({
      code: z.string().check(z.maxLength(60)),
      message: z.optional(z.string().check(z.maxLength(300))),
    }),
  ),
}) satisfies z.ZodMiniType<VerbResultRequest>;

/** A `music.play_mix` that asks for a find: its songs, from the Music object, before Core's commit
 * (which validates the args again and refuses a find that picked nothing). The songs' tags never
 * reach the mind here, so this read taints nothing; the sandbox has no music. */
async function prepare(env: Env, body: Pick<PutVerbRequest, 'verb' | 'args'>): Promise<Prepared> {
  const find = body.verb === 'music.play_mix' ? (body.args as JsonObject).find : undefined;
  if (!find || typeof find !== 'object' || Array.isArray(find)) return {};
  if (inSandbox()) throw new ApiError('validation', [{ path: 'args.find', issue: 'the sandbox has no music' }]);
  const f = find as Record<string, unknown>;
  const q = parseFind({
    moods: Array.isArray(f.moods) ? f.moods.join(',') : undefined,
    occasion: typeof f.occasion === 'string' ? f.occasion : undefined,
    energy: typeof f.energy === 'string' ? f.energy : undefined,
    like: typeof f.like === 'string' ? f.like : undefined,
    limit: typeof f.limit === 'number' ? String(f.limit) : undefined,
  });
  if ('issues' in q)
    throw new ApiError(
      'validation',
      q.issues.map((i) => ({ ...i, path: `args.find.${i.path}` })),
    );
  const now = Date.now();
  const [skips, never] = await Promise.all([
    fresh(sensesObject(env).earlySkips(now)),
    fresh(coreObject(env).musicNever(now)),
  ]);
  const r = await fresh(musicObject(env).find(q, skips, never, now));
  if (!r) throw new ApiError('not_found', { reason: 'like names a song the catalog does not hold' });
  return { refs: r.items.map((i) => `music:${i.id}`) };
}

export const verbsRoutes = new Hono<AppEnv>()
  .put('/verbs/:id', guard('PUT /v1/verbs/:id'), async (c) => {
    const id = idParam(c);
    const body = await json(c, putBody);
    const prepared = await prepare(c.env, body);
    const core = coreObject(c.env);
    const out = value(
      body.fire_at === undefined
        ? await core.putVerb(callerOf(c), id, body, reqHash(body), prepared)
        : await fresh(core.scheduleVerb(callerOf(c), id, body, reqHash(body), prepared)),
    );
    const answer: VerbAnswer = {
      ...out.verb,
      ...(out.permit ? { permit: out.permit } : {}),
      ...(out.shifted !== undefined ? { shifted: out.shifted } : {}),
    };
    return c.json(answer, out.created ? 201 : 200);
  })
  .post('/verbs/plan', guard('POST /v1/verbs/plan'), async (c) => {
    const body = await json(c, planBody);
    // Each step's find runs first, in the Music object (as a verb's does).
    const prepared = await Promise.all(body.steps.map((s) => prepare(c.env, s)));
    const out = value(await fresh(coreObject(c.env).postPlan(callerOf(c), body, reqHash(body), prepared)));
    const answer: PlanAnswer = {
      ...out.plan,
      ...(out.permit ? { permit: out.permit } : {}),
      ...(out.shifted !== undefined ? { shifted: out.shifted } : {}),
    };
    return c.json(answer, out.created ? 201 : 200);
  })
  .get('/verbs/scheduled', guard('GET /v1/verbs/scheduled'), async (c) => {
    return c.json((await fresh(coreObject(c.env).scheduledVerbs())) satisfies ScheduledResponse);
  })
  .post('/verbs/:id/cancel', guard('POST /v1/verbs/:id/cancel'), async (c) => {
    const id = idParam(c);
    await json(c, z.strictObject({}));
    return c.json(value(await fresh(coreObject(c.env).cancelVerb(callerOf(c), id))) satisfies Verb);
  })
  .get('/verbs/pending', guard('GET /v1/verbs/pending'), async (c) => {
    // `?app=`: that app's pending intents (verbs.ts `intent`), which it applies as it opens.
    const app = c.req.query('app');
    if (app !== undefined && !(APP_IDS as readonly string[]).includes(app))
      throw new ApiError('validation', [{ path: 'app', issue: 'an app id' }]);
    return c.json({ items: (await coreObject(c.env).pendingVerbs(deviceOf(c).session_id, app)) satisfies Verb[] });
  })
  .post('/verbs/:id/claim', guard('POST /v1/verbs/:id/claim'), async (c) => {
    return c.json(value(await coreObject(c.env).claimVerb(idParam(c), deviceOf(c).session_id)) satisfies Verb);
  })
  .post('/verbs/:id/result', guard('POST /v1/verbs/:id/result'), async (c) => {
    const id = idParam(c);
    const body = await json(c, resultBody);
    return c.json(value(await coreObject(c.env).verbResult(id, deviceOf(c).session_id, body)) satisfies Verb);
  })
  .get('/music/mixes', guard('GET /v1/music/mixes'), async (c) => {
    return c.json({ items: await fresh(coreObject(c.env).musicMixes()) } satisfies MusicMixesResponse);
  })
  // One mix's songs, for the owner's tap on Music's "tonight" (the mix the mind placed there).
  .get('/music/mixes/:id', guard('GET /v1/music/mixes/:id'), async (c) => {
    const mix = await fresh(coreObject(c.env).musicMix(idParam(c)));
    if (!mix) throw new ApiError('not_found');
    return c.json(mix satisfies MusicMixSongs);
  });
