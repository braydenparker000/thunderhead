// /v1/surfaces (API.md §11.12): what the mind placed on a screen, by app and slot. Kinds and
// their payload schemas are the contract's (shared/contract/surfaces.ts).
import { Hono } from 'hono';
import * as z from 'zod/mini';
import type { PutSurfaceRequest, Surface, SurfacesResponse } from '../../../../shared/contract/api';
import { type AppEnv, guard } from '../../http/auth';
import { callerOf } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { json, parse } from '../../http/validate';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';

const NAME = /^[a-z][a-z0-9_]{0,23}$/;
const SLOT = /^[a-z][a-z0-9_]{0,23}(\.[a-z0-9_]{1,12})?$/;
const putBody = z.strictObject({
  kind: z.string().check(z.regex(NAME)),
  schema: z.number().check(z.int(), z.gte(1), z.lte(99)),
  payload: z.record(z.string(), z.json()).check(z.refine((p) => JSON.stringify(p).length <= 16_384, 'at most 16 KB')),
  why: z.string().check(z.minLength(8), z.maxLength(200)),
  topic_key: z.string().check(z.regex(/^[a-z0-9][a-z0-9._-]{0,63}$/)),
  ref: z.optional(z.string().check(z.maxLength(200))),
  expires_at: z.optional(z.number().check(z.int())),
}) satisfies z.ZodMiniType<PutSurfaceRequest>;
const listQuery = z.object({ since_seq: z.optional(z.coerce.number().check(z.int(), z.gte(0))) });

function place(app: string | undefined, slot: string | undefined): [string, string] {
  if (!app || !slot || !NAME.test(app) || !SLOT.test(slot)) throw new ApiError('not_found');
  return [app, slot];
}

export const surfacesRoutes = new Hono<AppEnv>()
  .get('/surfaces', guard('GET /v1/surfaces'), async (c) => {
    const q = parse(listQuery, c.req.query());
    return c.json((await coreObject(c.env).surfaces(q.since_seq ?? 0)) satisfies SurfacesResponse);
  })
  .put('/surfaces/:app/:slot', guard('PUT /v1/surfaces/:app/:slot'), async (c) => {
    const [app, slot] = place(c.req.param('app'), c.req.param('slot'));
    const body = await json(c, putBody);
    return c.json(value(await coreObject(c.env).putSurface(callerOf(c), app, slot, body)) satisfies Surface);
  })
  .delete('/surfaces/:app/:slot', guard('DELETE /v1/surfaces/:app/:slot'), async (c) => {
    const [app, slot] = place(c.req.param('app'), c.req.param('slot'));
    value(await coreObject(c.env).deleteSurface(callerOf(c), app, slot));
    return c.body(null, 204);
  });
