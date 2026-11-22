// /v1/mind/voice (shared/contract/voice.ts): the voice page, read by the owner's devices and every
// mind role, written by the owner and (with a why, from a clean claimed session) the chat mind,
// and an earlier version brought back by the owner.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import type {
  PutVoiceRequest,
  RestoreVoiceRequest,
  VoiceResponse,
  VoiceVersion,
} from '../../../../shared/contract/voice.ts';
import { type AppEnv, guard } from '../../http/auth';
import { callerOf, idParam } from '../../http/caller';
import { json } from '../../http/validate';
import { UUIDV7 } from '../../lib/ids';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';

// The page and the why are checked by their limits in ops.ts (one line naming the limit); this
// only bounds what is read.
const putBody = z.strictObject({
  text: z.string().check(z.maxLength(16_000)),
  why: z.optional(z.string().check(z.maxLength(1_000))),
}) satisfies z.ZodMiniType<PutVoiceRequest>;
const restoreBody = z.strictObject({
  id: z.string().check(z.regex(UUIDV7)),
}) satisfies z.ZodMiniType<RestoreVoiceRequest>;

export const voiceRoutes = new Hono<AppEnv>()
  .get('/mind/voice', guard('GET /v1/mind/voice'), async (c) =>
    c.json((await fresh(coreObject(c.env).voice())) satisfies VoiceResponse),
  )
  .get('/mind/voice/:id', guard('GET /v1/mind/voice/:id'), async (c) => {
    const id = idParam(c);
    return c.json(value(await fresh(coreObject(c.env).voiceVersion(id))) satisfies VoiceVersion);
  })
  .put('/mind/voice', guard('PUT /v1/mind/voice'), async (c) => {
    const body = await json(c, putBody);
    return c.json(value(await fresh(coreObject(c.env).putVoice(callerOf(c), body))) satisfies VoiceResponse);
  })
  .post('/mind/voice/restore', guard('POST /v1/mind/voice/restore'), async (c) => {
    const body = await json(c, restoreBody);
    return c.json(value(await fresh(coreObject(c.env).restoreVoice(callerOf(c), body.id))) satisfies VoiceResponse);
  });
