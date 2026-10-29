// /v1/mind (API.md §11.8): the typing pre-warm from the phone, and the session routes the `th` CLI
// calls. The key's role is what counts; a body `role` that differs is 403 (RUNTIME.md §4.3). The
// night shift's run (`th night`) and its input, a closed day in parts (`th day`), are night-only.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import type {
  BriefResponse,
  DayStats,
  MindNightRequest,
  MindNightResponse,
  Page,
  PendingResponse,
  WakeItem,
} from '../../../../shared/contract/api';
import {
  NIGHT_CURSOR_MAX,
  NIGHT_DAY_PARTS,
  NIGHT_PAGE_MAX,
  type NightDayPart,
} from '../../../../shared/contract/night.ts';
import { type AppEnv, guard } from '../../http/auth';
import { callerOf } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { json, parse } from '../../http/validate';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';
import { fireWake } from './wakeup';

const ROLE = { C: 'chat', N: 'night', R: 'reflex' } as const;
const text = (max: number) => z.string().check(z.minLength(1), z.maxLength(max));

const briefBody = z.strictObject({
  claim: z.boolean(),
  session_id: z.string().check(z.regex(/^[A-Za-z0-9_.:-]{1,120}$/)),
  role: z.enum(['chat', 'night', 'reflex']),
  constitution_sha256: z.string().check(z.regex(/^[0-9a-f]{64}$|^none$/)),
  th_version: text(40),
});
const statusBody = z.strictObject({
  state: z.enum(['working', 'listening', 'stopping', 'limited']),
  thread_id: z.optional(z.string().check(z.maxLength(40))),
  note: z.optional(text(140)),
  error: z.optional(text(60)),
});
const noteBody = z.strictObject({
  id: z.string().check(z.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)),
  thread_id: z.optional(z.string().check(z.maxLength(40))),
  body: text(1_200).check(z.refine((b) => b.trim().split(/\s+/).length <= 120, 'at most 120 words')),
  open_items: z
    .array(z.strictObject({ text: text(200), ref: z.optional(z.string().check(z.maxLength(200))) }))
    .check(z.maxLength(10)),
});
const taintBody = z.strictObject({ source: text(40), ref_kind: z.optional(z.enum(['url', 'file', 'comment'])) });
const wakesQuery = z.object({ limit: z.optional(z.coerce.number().check(z.int(), z.gte(1), z.lte(200))) });
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const nightBody = z.strictObject({
  day: z.string().check(z.regex(DAY)),
  action: z.enum(['start', 'step_done', 'cursor', 'done']),
  step: z.optional(z.number().check(z.int(), z.gte(0), z.lte(99))),
  cursor: z.optional(z.string().check(z.minLength(1), z.maxLength(NIGHT_CURSOR_MAX))),
  partial: z.optional(z.boolean()),
}) satisfies z.ZodMiniType<MindNightRequest>;
const dayQuery = z.object({
  part: z.enum(NIGHT_DAY_PARTS),
  cursor: z.optional(z.string().check(z.maxLength(400))),
  limit: z.optional(z.coerce.number().check(z.int(), z.gte(1), z.lte(NIGHT_PAGE_MAX))),
});

/** A day part's cursor key, checked: `[seq]` (messages), `[at, seq]` (ledger), `[created_at, id]`
 * (notes). The stats have none. */
function cursorKey(part: NightDayPart, k: unknown[] | null): (number | string)[] | null {
  if (!k) return null;
  const n = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
  const ok =
    part === 'messages'
      ? k.length === 1 && n(k[0])
      : part === 'ledger'
        ? k.length === 2 && n(k[0]) && n(k[1])
        : part === 'notes' && k.length === 2 && n(k[0]) && typeof k[1] === 'string' && k[1].length <= 64;
  if (!ok) throw new ApiError('bad_request');
  return k as (number | string)[];
}

export const mindRoutes = new Hono<AppEnv>()
  .post('/mind/typing', guard('POST /v1/mind/typing'), async (c) => {
    const wake = await coreObject(c.env).typing();
    if (wake) c.executionCtx.waitUntil(fireWake(c.env, wake));
    return c.body(null, 204);
  })
  .get('/mind/wakes', guard('GET /v1/mind/wakes'), async (c) => {
    const q = parse(wakesQuery, c.req.query());
    const items = await coreObject(c.env).wakes(q.limit ?? 50, null);
    return c.json({ items, next: null } satisfies Page<WakeItem>);
  })
  .post('/mind/brief', guard('POST /v1/mind/brief'), async (c) => {
    const who = callerOf(c);
    const body = await json(c, briefBody);
    if (ROLE[who.who as keyof typeof ROLE] !== body.role) throw new ApiError('forbidden');
    const out = value(await coreObject(c.env).brief({ ...who, session_id: body.session_id }, body));
    return c.json(out satisfies BriefResponse);
  })
  .post('/mind/status', guard('POST /v1/mind/status'), async (c) => {
    const out = await coreObject(c.env).mindStatus(callerOf(c), await json(c, statusBody));
    if (out.stop) c.header('TH-Stop', '1');
    return c.body(null, 204);
  })
  .post('/mind/stop', guard('POST /v1/mind/stop'), async (c) => {
    await coreObject(c.env).stop();
    return c.body(null, 204);
  })
  .post('/mind/notes', guard('POST /v1/mind/notes'), async (c) => {
    value(await coreObject(c.env).mindNote(callerOf(c), await json(c, noteBody)));
    return c.body(null, 201);
  })
  .post('/mind/taint', guard('POST /v1/mind/taint'), async (c) => {
    const { source } = await json(c, taintBody);
    value(await coreObject(c.env).mindTaint(callerOf(c), source));
    return c.json({ tainted: true });
  })
  .get('/mind/pending', guard('GET /v1/mind/pending'), async (c) => {
    return c.json((await coreObject(c.env).mindPending(callerOf(c))) satisfies PendingResponse);
  })
  .post('/mind/night', guard('POST /v1/mind/night'), async (c) => {
    const body = await json(c, nightBody);
    return c.json(value(await fresh(coreObject(c.env).night(callerOf(c), body))) satisfies MindNightResponse);
  })
  .get('/mind/day/:day', guard('GET /v1/mind/day/:day'), async (c) => {
    const day = c.req.param('day') ?? '';
    if (!DAY.test(day)) throw new ApiError('validation', [{ path: 'day', issue: 'YYYY-MM-DD' }]);
    const q = parse(dayQuery, c.req.query());
    // A cursor names its day and part, so one from another day or part is refused (400).
    const route = `day:${day}:${q.part}`;
    const after = cursorKey(q.part, decodeCursor(route, q.cursor));
    const out = value(
      await fresh(coreObject(c.env).nightDay({ day, part: q.part, after, limit: q.limit ?? NIGHT_PAGE_MAX })),
    );
    if (!('items' in out)) return c.json(out satisfies DayStats);
    return c.json({ items: out.items, next: out.last ? encodeCursor(route, out.last) : null } satisfies Page<unknown>);
  });
