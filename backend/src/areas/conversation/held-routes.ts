// Held conversations' routes (API.md §11.7, held.ts): a conversation off the record under the
// phone's id, Delete, Restore and Recently deleted. Device only (shared/contract/routes.ts), and
// held.ts checks the caller again, so no agent key can reach them even through a route mix-up.
// Mounted before conversationRoutes, so `/threads/deleted` is never read as a thread id.
import { Hono } from 'hono';
import type { DeletedThreadsResponse, RestoredThread, Thread, ThreadDeleted } from '../../../../shared/contract/api';
import { type AppEnv, guard } from '../../http/auth';
import { callerOf, idParam } from '../../http/caller';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';

export const heldRoutes = new Hono<AppEnv>()
  .get('/threads/deleted', guard('GET /v1/threads/deleted'), async (c) => {
    return c.json({ items: await coreObject(c.env).deletedThreads() } satisfies DeletedThreadsResponse);
  })
  .put('/threads/:id/off-record', guard('PUT /v1/threads/:id/off-record'), async (c) => {
    const out = value(await coreObject(c.env).offRecord(callerOf(c), idParam(c)));
    return c.json(out.thread satisfies Thread, out.created ? 201 : 200);
  })
  .delete('/threads/:id', guard('DELETE /v1/threads/:id'), async (c) => {
    return c.json(value(await coreObject(c.env).deleteThread(callerOf(c), idParam(c))) satisfies ThreadDeleted);
  })
  .post('/threads/:id/restore', guard('POST /v1/threads/:id/restore'), async (c) => {
    return c.json(value(await coreObject(c.env).restoreThread(callerOf(c), idParam(c))) satisfies RestoredThread);
  });
