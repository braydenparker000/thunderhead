// /v1/reminders (HOME.md §6.2): the owner's reminders, set, listed and taken back. The phone sets
// one from the + sheet; the chat mind sets one when the owner asks in words, naming that message.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import type { PutReminderRequest, ReminderResponse, RemindersResponse } from '../../../../shared/contract/reminders.ts';
import { type AppEnv, guard } from '../../http/auth';
import { callerOf, idParam, reqHash } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { json } from '../../http/validate';
import { UUIDV7 } from '../../lib/ids';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';

// The words are checked once trimmed (ops.ts); this only bounds what is read.
const putBody = z.strictObject({
  text: z.string().check(z.maxLength(1_000)),
  at: z.number().check(z.int(), z.gte(0)),
  source_message_id: z.optional(z.string().check(z.regex(UUIDV7))),
}) satisfies z.ZodMiniType<PutReminderRequest>;

export const remindersRoutes = new Hono<AppEnv>()
  .put('/reminders/:id', guard('PUT /v1/reminders/:id'), async (c) => {
    const id = idParam(c);
    const body = await json(c, putBody);
    const out = value(await fresh(coreObject(c.env).putReminder(callerOf(c), id, body, reqHash(body))));
    return c.json({ reminder: out.reminder } satisfies ReminderResponse, out.created ? 201 : 200);
  })
  .get('/reminders', guard('GET /v1/reminders'), async (c) =>
    c.json((await fresh(coreObject(c.env).reminders())) satisfies RemindersResponse),
  )
  .delete('/reminders/:id', guard('DELETE /v1/reminders/:id'), async (c) => {
    const id = idParam(c);
    const source = c.req.query('source_message_id');
    if (source !== undefined && !UUIDV7.test(source))
      throw new ApiError('validation', [{ path: 'source_message_id', issue: 'a message id' }]);
    const reminder = value(await fresh(coreObject(c.env).cancelReminder(callerOf(c), id, source)));
    return c.json({ reminder } satisfies ReminderResponse);
  });
