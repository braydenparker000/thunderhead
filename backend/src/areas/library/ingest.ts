// /v1/library/ingest and the pages (STUDY.md §3.3): the mind reads the owner's books in its own
// session, never in Actions. It claims the oldest waiting book (leased an hour, renewed by each
// call), downloads its PDF through the Worker (the run's holder only: no signed link, so ingestion
// doesn't need the signing token or the bucket's S3 host), posts pages in batches of 50 (pages, FTS
// and refs in one transaction each, idempotent per page), and reports its state. The pages count
// against the bulk lane's rows a day (DATA.md §8.3): when it is used up, 429 with the hour the lane
// opens again, and the mind pauses the run. The eval sandbox has no library.
import { Hono } from 'hono';
import { refOf } from '../../../../frontend/apps/study/scripture/parse.js';
import { LIBRARY_LIMITS as L, type PagesResponse } from '../../../../shared/contract/library.ts';
import { type AppEnv, guard, principalOf } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { inSandbox } from '../../http/sandbox';
import { json } from '../../http/validate';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { libraryObject } from '../../objects/library';
import { fresh } from '../../objects/rpc';
import { idParam } from './routes';
import { checkRefs } from './scripture';
import { checkPages, ingestBody, pagesBody } from './validate';

const holder = (c: Parameters<typeof principalOf>[0]) => {
  if (inSandbox()) throw new ApiError('validation', [{ path: 'TH-Sandbox', issue: 'the sandbox has no library' }]);
  const p = principalOf(c);
  return p.kind === 'device' ? p.session_id : p.agent_id;
};

export const ingestRoutes = new Hono<AppEnv>()
  .post('/library/ingest/claim', guard('POST /v1/library/ingest/claim'), async (c) => {
    const claim = value(await fresh(libraryObject(c.env).claim(holder(c))));
    return claim ? c.json(claim) : c.body(null, 204);
  })
  .get('/library/ingest/:job_id/file', guard('GET /v1/library/ingest/:job_id/file'), async (c) => {
    const key = value(await fresh(libraryObject(c.env).jobFile(idParam(c, 'job_id'), holder(c))));
    const obj = await c.env.VAULT.get(key);
    if (!obj) throw new ApiError('not_found');
    return c.body(obj.body, 200, { 'Content-Type': 'application/pdf', 'Content-Length': String(obj.size) });
  })
  .put('/library/books/:id/pages', guard('PUT /v1/library/books/:id/pages'), async (c) => {
    const id = idParam(c);
    const by = holder(c);
    const body = await json(c, pagesBody);
    checkPages(body.pages);
    await checkRefs(
      c.env,
      body.pages.flatMap((p, i) =>
        p.refs.map((r, k) => ({
          path: `pages.${i}.refs.${k}`,
          ref: refOf(r.book_code, r.chapter, r.v_start, r.v_end),
        })),
      ),
    );
    const core = coreObject(c.env);
    const lane = await fresh(core.bulkLane());
    if (!lane.open)
      throw new ApiError('rate_limited', undefined, {
        retry_after: Math.ceil((lane.resume_at - Date.now()) / 1000),
        scope: 'account',
      });
    const r = value(await fresh(libraryObject(c.env).putPages(id, body.job_id, by, body.pages)));
    await core.useBulkLane(r.rows);
    return c.json({ written: r.written, refs: r.refs } satisfies PagesResponse);
  })
  // A book's stored text, for the mind in its own session (SETUP.md O2; cited answers): 50 pages a call.
  .get('/library/books/:id/pages', guard('GET /v1/library/books/:id/pages'), async (c) => {
    const id = idParam(c);
    holder(c);
    const from = Math.max(1, Math.floor(Number(c.req.query('from') ?? 1)) || 1);
    const limit = Math.min(L.pages_batch, Math.max(1, Math.floor(Number(c.req.query('limit') ?? L.pages_batch)) || 1));
    const r = await fresh(libraryObject(c.env).pageTexts(id, from, limit));
    if (!r) throw new ApiError('not_found');
    return c.json(r);
  })
  .patch('/library/ingest/:job_id', guard('PATCH /v1/library/ingest/:job_id'), async (c) => {
    const jobId = idParam(c, 'job_id');
    const by = holder(c);
    const u = await json(c, ingestBody);
    return c.json({ book: value(await fresh(libraryObject(c.env).updateJob(jobId, by, u))) });
  });
