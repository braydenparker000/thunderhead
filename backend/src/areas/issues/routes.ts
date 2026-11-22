// /v1/issues (shared/contract/issues.ts): the list for the builder. The owner's devices list, add,
// edit, mark done and reopen; the chat mind files an item naming the owner's message and adds notes;
// the night and reflex keys, the ci key and the builders' tools read it.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import {
  ISSUE_KINDS,
  ISSUE_STATES,
  type IssueNoteRequest,
  type IssueResponse,
  type IssuesResponse,
  type PatchIssueRequest,
  type PutIssueRequest,
} from '../../../../shared/contract/issues.ts';
import { type AppEnv, guard } from '../../http/auth';
import { callerOf, idParam, reqHash } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { json } from '../../http/validate';
import { UUIDV7 } from '../../lib/ids';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';

// The words are checked once trimmed (ops.ts); this only bounds what is read.
const text = (max: number) => z.string().check(z.maxLength(max));
const putBody = z.strictObject({
  title: text(1_000),
  what: text(4_000),
  where: z.optional(text(1_000)),
  kind: z.optional(z.enum(ISSUE_KINDS)),
  from_message_id: z.optional(z.string().check(z.regex(UUIDV7))),
}) satisfies z.ZodMiniType<PutIssueRequest>;
const patchBody = z.strictObject({
  title: z.optional(text(1_000)),
  what: z.optional(text(4_000)),
  where: z.optional(z.nullable(text(1_000))),
  kind: z.optional(z.enum(ISSUE_KINDS)),
  state: z.optional(z.enum(ISSUE_STATES)),
}) satisfies z.ZodMiniType<PatchIssueRequest>;
const noteBody = z.strictObject({ text: text(4_000) }) satisfies z.ZodMiniType<IssueNoteRequest>;

export const issuesRoutes = new Hono<AppEnv>()
  .get('/issues', guard('GET /v1/issues'), async (c) => {
    const state = c.req.query('state') ?? 'open';
    if (state !== 'all' && !(ISSUE_STATES as readonly string[]).includes(state))
      throw new ApiError('validation', [{ path: 'state', issue: 'open, done or all' }]);
    const out = await fresh(coreObject(c.env).issues(state === 'all' ? null : (state as 'open' | 'done')));
    return c.json(out satisfies IssuesResponse);
  })
  .get('/issues/:id', guard('GET /v1/issues/:id'), async (c) => {
    const id = idParam(c);
    return c.json({ issue: value(await fresh(coreObject(c.env).issue(id))) } satisfies IssueResponse);
  })
  .put('/issues/:id', guard('PUT /v1/issues/:id'), async (c) => {
    const id = idParam(c);
    const body = await json(c, putBody);
    const release = c.env.VERSION.tag || null;
    const out = value(await fresh(coreObject(c.env).putIssue(callerOf(c), id, body, reqHash(body), release)));
    return c.json({ issue: out.issue } satisfies IssueResponse, out.created ? 201 : 200);
  })
  .patch('/issues/:id', guard('PATCH /v1/issues/:id'), async (c) => {
    const id = idParam(c);
    const body = await json(c, patchBody);
    return c.json({
      issue: value(await fresh(coreObject(c.env).patchIssue(callerOf(c), id, body))),
    } satisfies IssueResponse);
  })
  .post('/issues/:id/notes', guard('POST /v1/issues/:id/notes'), async (c) => {
    const id = idParam(c);
    const body = await json(c, noteBody);
    return c.json({
      issue: value(await fresh(coreObject(c.env).noteIssue(callerOf(c), id, body))),
    } satisfies IssueResponse);
  });
