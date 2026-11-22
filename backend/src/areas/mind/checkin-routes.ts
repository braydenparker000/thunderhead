// POST /v1/mind/checkin (checkin-session.ts): a check-in session's one message (`say`) and its end
// (`done`, with an optional why for saying nothing). The night key only; Core checks the claim.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import { UUID7 } from '../../../../shared/contract/verb-spec.ts';
import { type AppEnv, guard } from '../../http/auth';
import { callerOf } from '../../http/caller';
import { json } from '../../http/validate';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';

const checkinBody = z.union([
  z.strictObject({
    action: z.literal('say'),
    id: z.string().check(z.regex(UUID7)),
    body: z.string().check(z.minLength(1), z.maxLength(4_000)),
  }),
  z.strictObject({
    action: z.literal('done'),
    nothing: z.optional(z.string().check(z.minLength(1), z.maxLength(200))),
  }),
]);

export const checkinRoutes = new Hono<AppEnv>().post('/mind/checkin', guard('POST /v1/mind/checkin'), async (c) => {
  const body = await json(c, checkinBody);
  const core = coreObject(c.env);
  if (body.action === 'say') return c.json(value(await core.checkinSay(callerOf(c), { id: body.id, body: body.body })));
  return c.json(value(await core.checkinDone(callerOf(c), body.nothing ?? null)));
});
