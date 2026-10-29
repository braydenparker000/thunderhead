// /v1/threads and /v1/messages (API.md §11.7). Handlers validate the shape and call one Core RPC;
// the rules live in ops.ts. An owner message that needs the mind fires a wake after the response.
import { Hono } from 'hono';
import type { Message, MessagesPage, Page, Thread, TodayResponse } from '../../../../shared/contract/api';
import { type AppEnv, guard } from '../../http/auth';
import { callerOf, idParam, reqHash } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { json, parse } from '../../http/validate';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fireWake } from '../mind/wakeup';
import * as s from './schema';

export const conversationRoutes = new Hono<AppEnv>()
  .get('/threads', guard('GET /v1/threads'), async (c) => {
    const q = parse(s.threadsQuery, c.req.query());
    const limit = q.limit ?? 50;
    const after = decodeCursor('threads', q.cursor) as [number, string] | null;
    const items = await coreObject(c.env).threads(q.status ?? null, limit, after);
    const last = items.at(-1);
    const next = items.length === limit && last ? encodeCursor('threads', [last.updated_at, last.id]) : null;
    return c.json({ items, next } satisfies Page<Thread>);
  })
  .get('/threads/today', guard('GET /v1/threads/today'), async (c) => {
    return c.json((await coreObject(c.env).today()) satisfies TodayResponse);
  })
  .get('/threads/:id', guard('GET /v1/threads/:id'), async (c) => {
    const t = await coreObject(c.env).thread(idParam(c));
    if (!t) throw new ApiError('not_found');
    return c.json(t satisfies Thread);
  })
  .get('/threads/:id/messages', guard('GET /v1/threads/:id/messages'), async (c) => {
    const id = idParam(c);
    const q = parse(s.messagesQuery, c.req.query());
    const limit = q.limit ?? 50;
    const items = await coreObject(c.env).messages(id, q.before_seq ?? null, q.after_seq ?? null, limit);
    // `next` is the seq to pass on: as before_seq when paging back, as after_seq going forward.
    const edge = items.at(-1);
    const next = items.length === limit && edge ? String(edge.seq) : null;
    return c.json({ items, next } satisfies MessagesPage);
  })
  .patch('/threads/:id', guard('PATCH /v1/threads/:id'), async (c) => {
    const id = idParam(c);
    const { title, summary } = await json(c, s.patchThread);
    return c.json(value(await coreObject(c.env).patchThread(id, title, summary)) satisfies Thread);
  })
  .post('/threads/:id/continue', guard('POST /v1/threads/:id/continue'), async (c) => {
    return c.json(value(await coreObject(c.env).continueThread(idParam(c))));
  })
  .put('/messages/:id', guard('PUT /v1/messages/:id'), async (c) => {
    const id = idParam(c);
    const body = await json(c, s.putMessage);
    const out = value(await coreObject(c.env).putMessage(callerOf(c), { ...body, id, req_sha256: reqHash(body) }));
    if (out.wake) c.executionCtx.waitUntil(fireWake(c.env, out.wake));
    if (out.stop) c.header('TH-Stop', '1');
    return c.json(out.message satisfies Message, out.created ? 201 : 200);
  })
  .patch('/messages/:id', guard('PATCH /v1/messages/:id'), async (c) => {
    const id = idParam(c);
    const { body, meta } = await json(c, s.patchMessage);
    return c.json(value(await coreObject(c.env).patchMessage(id, body, meta)) satisfies Message);
  });
