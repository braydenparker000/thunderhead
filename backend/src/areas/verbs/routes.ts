// /v1/verbs (API.md §11.11): agents queue (a Worker-side verb runs at once), a signed-in phone takes,
// runs and reports; an app asks for its own pending intents with `?app=`. The verb vocabulary and its
// schemas are the contract's (shared/contract/verbs.ts). GET /v1/music/mixes lists the mixes
// `music.mix_save` kept.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import type {
  JsonObject,
  MusicMixesResponse,
  Permitted,
  PutVerbRequest,
  Verb,
  VerbResultRequest,
} from '../../../../shared/contract/api';
import { APP_IDS } from '../../../../shared/contract/feed.ts';
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
const putBody = z.strictObject({
  verb: z.string().check(z.regex(/^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/)),
  schema: z.number().check(z.int(), z.gte(1), z.lte(99)),
  args,
  why: z.string().check(z.minLength(8), z.maxLength(200)),
  ref: z.optional(z.string().check(z.maxLength(200))),
  device_id: z.optional(z.string().check(z.maxLength(40))),
  expires_at: z.optional(z.number().check(z.int())),
  proposal_id: z.optional(z.string().check(z.maxLength(40))),
}) satisfies z.ZodMiniType<PutVerbRequest>;
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
async function prepare(env: Env, body: PutVerbRequest): Promise<Prepared> {
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
    const out = value(await coreObject(c.env).putVerb(callerOf(c), id, body, reqHash(body), prepared));
    const answer: Permitted<Verb> = out.permit ? { ...out.verb, permit: out.permit } : out.verb;
    return c.json(answer, out.created ? 201 : 200);
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
  });
