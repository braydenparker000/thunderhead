// /v1/memory (API.md §11.13): facts, the profile, batches of memory ops, day notes and open
// threads. Handlers check the envelope and call one Core RPC; each op is validated on its own in
// the object (validate.ts), so one bad op never sinks a night's batch.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import type {
  DayNote,
  Fact,
  FactDetail,
  MemoryOpsResponse,
  OpenThread,
  Page,
  PatchOpenThreadRequest,
  ProfileResponse,
  PutDayNoteRequest,
  PutOpenThreadRequest,
} from '../../../../shared/contract/api';
import { FACT_KIND_NAMES, MEMORY_LIMITS } from '../../../../shared/contract/memory.ts';
import { type AppEnv, guard } from '../../http/auth';
import { callerOf, idParam, reqHash } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { json, parse } from '../../http/validate';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const bool = z.optional(z.enum(['true', 'false', '1', '0']));
const factsQuery = z.object({
  kind: z.optional(z.enum(FACT_KIND_NAMES)),
  subject: z.optional(z.string().check(z.maxLength(64))),
  include_superseded: bool,
  limit: z.optional(z.coerce.number().check(z.int(), z.gte(1), z.lte(200))),
  cursor: z.optional(z.string().check(z.maxLength(200))),
});
const opsBody = z.strictObject({
  batch_id: z.string().check(z.regex(UUID)),
  ops: z.array(z.unknown()).check(z.minLength(1), z.maxLength(MEMORY_LIMITS.ops_per_batch)),
});
const daysQuery = z.object({
  from: z.optional(z.string().check(z.regex(DAY))),
  to: z.optional(z.string().check(z.regex(DAY))),
});
const dayBody = z.strictObject({
  summary: z.string().check(
    z.minLength(1),
    z.maxLength(1_200),
    z.refine((t) => t.trim().split(/\s+/).length <= MEMORY_LIMITS.day_note_words, 'at most 150 words'),
  ),
  decisions: z
    .array(z.string().check(z.minLength(1), z.maxLength(200)))
    .check(z.maxLength(MEMORY_LIMITS.decisions_max)),
  importance: z.number().check(z.int(), z.gte(1), z.lte(10)),
}) satisfies z.ZodMiniType<PutDayNoteRequest>;
const refs = z.array(z.string().check(z.maxLength(240))).check(z.maxLength(20));
const tags = z.array(z.string().check(z.regex(/^[a-z][a-z0-9_-]{0,23}$/))).check(z.maxLength(MEMORY_LIMITS.tags_max));
const why = z.optional(z.string().check(z.minLength(1), z.maxLength(200)));
const threadBody = z.strictObject({
  text: z.string().check(z.minLength(1), z.maxLength(MEMORY_LIMITS.thread_text)),
  owner: z.enum(['mind', 'owner']),
  due_at: z.optional(z.number().check(z.int(), z.gte(0))),
  evidence: refs,
  tags: z.optional(tags),
  status: z.optional(z.enum(['open', 'done', 'dropped'])),
  why,
}) satisfies z.ZodMiniType<PutOpenThreadRequest>;
const patchBody = z.strictObject({
  status: z.enum(['done', 'dropped']),
  why,
}) satisfies z.ZodMiniType<PatchOpenThreadRequest>;
const threadsQuery = z.object({ status: z.optional(z.enum(['open', 'all'])) });

function dayParam(day: string | undefined): string {
  if (!day || !DAY.test(day)) throw new ApiError('validation', [{ path: 'day', issue: 'YYYY-MM-DD' }]);
  return day;
}

export const memoryRoutes = new Hono<AppEnv>()
  .get('/memory/facts', guard('GET /v1/memory/facts'), async (c) => {
    const q = parse(factsQuery, c.req.query());
    const limit = q.limit ?? 50;
    const before = (decodeCursor('facts', q.cursor)?.[0] as number | undefined) ?? null;
    const filter = {
      kind: q.kind ?? null,
      subject: q.subject ?? null,
      includeSuperseded: q.include_superseded === 'true' || q.include_superseded === '1',
    };
    const { items, last } = await fresh(coreObject(c.env).facts(filter, before, limit));
    const next = items.length === limit && last !== null ? encodeCursor('facts', [last]) : null;
    return c.json({ items, next } satisfies Page<Fact>);
  })
  .get('/memory/facts/:id', guard('GET /v1/memory/facts/:id'), async (c) => {
    const id = c.req.param('id') ?? '';
    if (!UUID.test(id)) throw new ApiError('validation', [{ path: 'id', issue: 'a lowercase UUID' }]);
    const found = await fresh(coreObject(c.env).factDetail(id));
    if (!found) throw new ApiError('not_found');
    return c.json(found satisfies FactDetail);
  })
  .get('/memory/profile', guard('GET /v1/memory/profile'), async (c) => {
    return c.json((await fresh(coreObject(c.env).profile())) satisfies ProfileResponse);
  })
  .post('/memory/ops', guard('POST /v1/memory/ops'), async (c) => {
    const body = await json(c, opsBody);
    const out = value(await fresh(coreObject(c.env).memoryOps(callerOf(c), body.batch_id, body.ops, reqHash(body))));
    return c.json(out satisfies MemoryOpsResponse);
  })
  .get('/memory/day-notes', guard('GET /v1/memory/day-notes'), async (c) => {
    const q = parse(daysQuery, c.req.query());
    return c.json({
      items: (await fresh(coreObject(c.env).dayNotes(q.from ?? null, q.to ?? null))) satisfies DayNote[],
    });
  })
  .put('/memory/day-notes/:day', guard('PUT /v1/memory/day-notes/:day'), async (c) => {
    const day = dayParam(c.req.param('day'));
    const body = await json(c, dayBody);
    return c.json(value(await fresh(coreObject(c.env).putDayNote(callerOf(c), day, body))) satisfies DayNote);
  })
  .get('/memory/open-threads', guard('GET /v1/memory/open-threads'), async (c) => {
    const q = parse(threadsQuery, c.req.query());
    return c.json({ items: (await fresh(coreObject(c.env).openThreads(q.status ?? 'open'))) satisfies OpenThread[] });
  })
  .put('/memory/open-threads/:id', guard('PUT /v1/memory/open-threads/:id'), async (c) => {
    const id = idParam(c);
    const body = await json(c, threadBody);
    return c.json(value(await fresh(coreObject(c.env).putOpenThread(callerOf(c), id, body))) satisfies OpenThread);
  })
  .patch('/memory/open-threads/:id', guard('PATCH /v1/memory/open-threads/:id'), async (c) => {
    const id = idParam(c);
    const body = await json(c, patchBody);
    return c.json(value(await fresh(coreObject(c.env).patchOpenThread(callerOf(c), id, body))) satisfies OpenThread);
  });
