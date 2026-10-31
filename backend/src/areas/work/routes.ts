// /v1/work (API.md §11.21, MUSE.md §4): the mind makes and cancels work orders; Muse, server to
// server with its own key, says hello, claims one order at a time, heartbeats it, returns its
// result (checked against the kind's schema; 422 names each problem) or a failure, and keeps notes
// in its own thread. The sandbox has none of it.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import * as z from 'zod/mini';
import type { Page } from '../../../../shared/contract/api';
import { type MuseNote, WORK_KIND_NAMES, WORK_LIMITS, type WorkOrder } from '../../../../shared/contract/work.ts';
import { type AppEnv, guard, principalOf, whoOf } from '../../http/auth';
import { callerOf } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { inSandbox } from '../../http/sandbox';
import { json, parse } from '../../http/validate';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';

const ID = z.string().check(z.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
const line = (max: number, min = 1) => z.string().check(z.minLength(min), z.maxLength(max));
const putBody = z.strictObject({
  kind: z.enum(WORK_KIND_NAMES as [string, ...string[]]),
  title: line(WORK_LIMITS.title),
  spec: z.strictObject({
    v: z.literal(1),
    goal: line(300),
    inputs: z.record(z.string(), z.unknown()),
    constraints: z.array(line(300)).check(z.maxLength(20)),
    done_when: line(300),
    sources_policy: z.optional(line(300)),
  }),
  deadline_at: z.number().check(z.int()),
});
const listQuery = z.object({
  status: z.optional(z.enum(['queued', 'claimed', 'done', 'rejected', 'failed', 'expired', 'cancelled', 'all'])),
  limit: z.optional(z.coerce.number().check(z.int(), z.minimum(1), z.maximum(100))),
});
const noteBody = z.strictObject({ id: ID, body: line(WORK_LIMITS.note_body) });
const tooLarge = (): never => {
  throw new ApiError('too_large');
};

const noSandbox = () => {
  if (inSandbox()) throw new ApiError('validation', [{ path: 'TH-Sandbox', issue: 'the sandbox has no work orders' }]);
};
const idOf = (raw: string) => {
  const r = ID.safeParse(raw);
  if (!r.success) throw new ApiError('not_found');
  return r.data;
};

export const workRoutes = new Hono<AppEnv>()
  // --- the mind and the owner ---------------------------------------------------------------
  .put('/work/orders/:id', guard('PUT /v1/work/orders/:id'), async (c) => {
    noSandbox();
    const id = idOf(c.req.param('id'));
    const body = await json(c, putBody);
    const r = value(await fresh(coreObject(c.env).workCreate(callerOf(c), id, body as never))) as {
      order: WorkOrder;
      created: boolean;
    };
    return c.json(r.order satisfies WorkOrder, r.created ? 201 : 200);
  })
  .post('/work/orders/:id/cancel', guard('POST /v1/work/orders/:id/cancel'), async (c) => {
    noSandbox();
    const id = idOf(c.req.param('id'));
    await json(c, z.strictObject({ why: line(140, 8) }));
    return c.json(value(await fresh(coreObject(c.env).workCancel(callerOf(c), id))));
  })
  .get('/work/orders', guard('GET /v1/work/orders'), async (c) => {
    noSandbox();
    const q = parse(listQuery, c.req.query());
    const items = (await fresh(
      coreObject(c.env).workList(q.limit ?? 30, q.status === 'all' ? undefined : q.status),
    )) as WorkOrder[];
    return c.json({ items, next: null } satisfies Page<WorkOrder>);
  })
  .get('/work/orders/:id', guard('GET /v1/work/orders/:id'), async (c) => {
    noSandbox();
    const o = (await fresh(coreObject(c.env).workOrder(idOf(c.req.param('id'))))) as WorkOrder | null;
    if (!o) throw new ApiError('not_found');
    return c.json(o);
  })
  // --- Muse ---------------------------------------------------------------------------------
  .get('/work/hello', guard('GET /v1/work/hello'), async (c) => c.json(await fresh(coreObject(c.env).workHello())))
  .post('/work/claim', guard('POST /v1/work/claim'), async (c) => {
    await json(c, z.strictObject({}));
    const o = (await fresh(coreObject(c.env).workClaim())) as WorkOrder | null;
    return o ? c.json({ order: o }) : c.body(null, 204);
  })
  .post('/work/orders/:id/heartbeat', guard('POST /v1/work/orders/:id/heartbeat'), async (c) => {
    const { note } = await json(c, z.strictObject({ note: z.optional(line(WORK_LIMITS.heartbeat_note, 0)) }));
    return c.json(value(await fresh(coreObject(c.env).workHeartbeat(idOf(c.req.param('id')), note ?? null))));
  })
  .put(
    '/work/orders/:id/result',
    guard('PUT /v1/work/orders/:id/result'),
    bodyLimit({ maxSize: WORK_LIMITS.result_bytes + 1_024, onError: tooLarge }),
    async (c) => {
      const { result } = await json(
        c,
        z.strictObject({ result: z.unknown(), files: z.optional(z.array(z.unknown()).check(z.maxLength(0))) }),
      );
      const r = value(await fresh(coreObject(c.env).workResult(idOf(c.req.param('id')), result))) as
        | { ok: true }
        | { ok: false; problems: string[] };
      if (!r.ok)
        throw new ApiError(
          'invalid_result',
          r.problems.map((issue) => ({ path: issue.split(':')[0], issue })),
        );
      return c.json({ status: 'done' });
    },
  )
  .post('/work/orders/:id/fail', guard('POST /v1/work/orders/:id/fail'), async (c) => {
    const { reason } = await json(c, z.strictObject({ reason: line(WORK_LIMITS.fail_reason) }));
    return c.json(value(await fresh(coreObject(c.env).workFail(idOf(c.req.param('id')), reason))));
  })
  .get('/work/thread', guard('GET /v1/work/thread'), async (c) => {
    const after = Number(c.req.query('after') ?? 0);
    if (!Number.isInteger(after) || after < 0) throw new ApiError('validation', [{ path: 'after', issue: 'a seq' }]);
    const items = (await fresh(coreObject(c.env).museNotes(after, 100))) as MuseNote[];
    return c.json({ items, next: items.length === 100 ? String(items.at(-1)?.seq) : null } satisfies Page<MuseNote>);
  })
  .post('/work/thread/messages', guard('POST /v1/work/thread/messages'), async (c) => {
    const { id, body } = await json(c, noteBody);
    const who = whoOf(principalOf(c));
    const author = who === 'M' ? 'muse' : who === 'D' ? 'owner' : 'mind';
    return c.json(value(await fresh(coreObject(c.env).museNote(id, author, body))), 201);
  });
