// /v1/verbs (API.md §11.11): agents queue, a signed-in phone takes, runs and reports. The verb
// vocabulary and its schemas are the contract's (shared/contract/verbs.ts).
import { Hono } from 'hono';
import * as z from 'zod/mini';
import type { PutVerbRequest, Verb, VerbResultRequest } from '../../../../shared/contract/api';
import { type AppEnv, deviceOf, guard } from '../../http/auth';
import { callerOf, idParam, reqHash } from '../../http/caller';
import { json } from '../../http/validate';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';

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

export const verbsRoutes = new Hono<AppEnv>()
  .put('/verbs/:id', guard('PUT /v1/verbs/:id'), async (c) => {
    const id = idParam(c);
    const body = await json(c, putBody);
    const out = value(await coreObject(c.env).putVerb(callerOf(c), id, body, reqHash(body)));
    return c.json(out.verb satisfies Verb, out.created ? 201 : 200);
  })
  .get('/verbs/pending', guard('GET /v1/verbs/pending'), async (c) => {
    return c.json({ items: (await coreObject(c.env).pendingVerbs(deviceOf(c).session_id)) satisfies Verb[] });
  })
  .post('/verbs/:id/claim', guard('POST /v1/verbs/:id/claim'), async (c) => {
    return c.json(value(await coreObject(c.env).claimVerb(idParam(c), deviceOf(c).session_id)) satisfies Verb);
  })
  .post('/verbs/:id/result', guard('POST /v1/verbs/:id/result'), async (c) => {
    const id = idParam(c);
    const body = await json(c, resultBody);
    return c.json(value(await coreObject(c.env).verbResult(id, deviceOf(c).session_id, body)) satisfies Verb);
  });
