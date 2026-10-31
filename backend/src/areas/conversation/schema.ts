// Request shapes for the conversation routes (zod/mini), checked against the shared contract.
import * as z from 'zod/mini';
import type { PatchMessageRequest, PatchThreadRequest, PutMessageRequest, ThreadTitleRequest } from '../../../../shared/contract/api';
import { MESSAGE_KINDS } from '../../../../shared/contract/feed.ts';

export const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const limit = z.optional(z.coerce.number().check(z.int(), z.gte(1), z.lte(200)));
const seq = z.optional(z.coerce.number().check(z.int(), z.gte(0)));
const meta = z.optional(
  z.record(z.string(), z.json()).check(z.refine((m) => JSON.stringify(m).length <= 8_192, 'at most 8 KB')),
);

// A body may be empty only beside attachments (an owner's photo without words); ops.ts keeps that
// to owner messages and checks the refs (areas/files/ops.ts).
export const putMessage = z
  .strictObject({
    body: z.string().check(z.maxLength(16_000)),
    kind: z.optional(z.enum(MESSAGE_KINDS)),
    meta,
    reply_to: z.optional(z.string().check(z.regex(UUID7))),
    thread_id: z.optional(z.literal('system')),
    attachments: z.optional(z.array(z.string().check(z.maxLength(200))).check(z.maxLength(10))),
  })
  .check(
    z.refine((p) => p.body.length > 0 || (p.attachments?.length ?? 0) > 0, {
      error: 'empty: a message has words or attachments',
      path: ['body'],
    }),
  ) satisfies z.ZodMiniType<PutMessageRequest & { attachments?: string[] }>;

export const patchMessage = z
  .strictObject({ body: z.optional(z.string().check(z.minLength(1), z.maxLength(16_000))), meta })
  .check(
    z.refine((p) => p.body !== undefined || p.meta !== undefined, 'body or meta'),
  ) satisfies z.ZodMiniType<PatchMessageRequest>;

/** The owner's name for a thread, up to 60 characters; empty gives naming back to the mind. */
export const threadTitle = z.strictObject({ title: z.string().check(z.maxLength(60)) }) satisfies z.ZodMiniType<ThreadTitleRequest>;

export const patchThread = z
  .strictObject({
    title: z.optional(z.string().check(z.minLength(1), z.maxLength(80))),
    summary: z.optional(z.string().check(z.minLength(1), z.maxLength(400))),
  })
  .check(
    z.refine((p) => p.title !== undefined || p.summary !== undefined, 'title or summary'),
  ) satisfies z.ZodMiniType<PatchThreadRequest>;

export const threadsQuery = z.object({
  status: z.optional(z.enum(['open', 'filed'])),
  limit,
  cursor: z.optional(z.string().check(z.maxLength(300))),
});

export const messagesQuery = z.object({ before_seq: seq, after_seq: seq, limit });
