// /v1/jobs (JOBS.md §3.3–3.5, API.md §11.22) and the listening pass's reads (/v1/music/pack,
// /v1/music/analysis/:id). The mind's night shift asks for the next job and dispatches the Actions
// workflow with its id only; the run fetches its spec with the ci key, uploads each part file and the
// manifest last through PUT /v1/jobs/:id/files/:name (into the private bucket, where nothing reads
// them until they are collected), then collects. Collecting checks the manifest and queues Core's
// apply job, which checks every result before anything reaches the owner's data. Nothing here ever
// returns or logs a hash but the spec itself, to the ci key alone.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import { ANALYZER, LISTEN_LIMITS as L, LISTEN_KINDS } from '../../../../shared/contract/listen.ts';
import { type AppEnv, guard } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { parse } from '../../http/validate';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { musicObject } from '../../objects/music';
import { fresh } from '../../objects/rpc';
import { refuseWhileHeld } from '../meter/hold';
import { base64, incoming, MANIFEST, specKey, uploadLimit } from './listen-files';
import { PACK_KEY } from './listen-pack';
import { SONG_ID } from './shapes';

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const nextQuery = z.object({
  kind: z.enum(LISTEN_KINDS),
  max: z.optional(z.coerce.number().check(z.int(), z.gte(1), z.lte(L.max_tracks))),
});
const listQuery = z.object({ kind: z.optional(z.enum(LISTEN_KINDS)), open: z.optional(z.enum(['0', '1'])) });
const likeQuery = z.object({ like: z.optional(z.coerce.number().check(z.int(), z.gte(0), z.lte(L.like_max))) });

type C = { req: { param(name: string): string | undefined }; env: Env };
const jobId = (c: C) => {
  const id = c.req.param('id') ?? '';
  if (!JOB_ID.test(id)) throw new ApiError('not_found');
  return id;
};
const vaultOf = (c: C) => {
  if (!c.env.VAULT) throw new ApiError('not_configured');
  return c.env.VAULT;
};

export const listenRoutes = new Hono<AppEnv>()
  .get('/jobs/next', guard('GET /v1/jobs/next'), async (c) => {
    const q = parse(nextQuery, c.req.query());
    // Heavy work: from 80% of the day's database budget it waits for 00:00 UTC (DATA.md §8.1).
    await refuseWhileHeld(c.env);
    const out = value(await fresh(musicObject(c.env).listenNext(q.kind, q.max ?? L.max_tracks)));
    return out ? c.json(out) : c.body(null, 204);
  })
  .get('/jobs', guard('GET /v1/jobs'), async (c) => {
    const q = parse(listQuery, c.req.query());
    return c.json({ items: await fresh(musicObject(c.env).listenJobs(q.kind ?? null, q.open === '1')) });
  })
  .get('/jobs/:id', guard('GET /v1/jobs/:id'), async (c) => {
    const s = await fresh(musicObject(c.env).listenJob(jobId(c)));
    if (!s) throw new ApiError('not_found');
    return c.json(s);
  })
  .get('/jobs/:id/spec', guard('GET /v1/jobs/:id/spec'), async (c) => {
    const id = jobId(c);
    const { kind, spec } = value(await fresh(musicObject(c.env).listenSpec(id)));
    if (kind === 'audio.analysis') return c.json({ job_id: id, kind, v: 2, shas: spec.shas, analyzer: ANALYZER });
    const emb = await vaultOf(c).get(specKey(id, 'emb'));
    if (!emb) throw new ApiError('not_found');
    const b64 = base64(new Uint8Array(await emb.arrayBuffer()));
    return c.json({ job_id: id, kind, v: 1, n: spec.n, k: L.k, dim: L.dim, emb: b64 });
  })
  // An Actions run's file, kept as sent until it is collected; the manifest goes last and closes the
  // job to more parts (a manifest sent again replaces it while the job is still issued).
  .put('/jobs/:id/files/:name', guard('PUT /v1/jobs/:id/files/:name'), async (c) => {
    const id = jobId(c);
    const name = c.req.param('name');
    const { kind, spec } = value(await fresh(musicObject(c.env).listenSpec(id)));
    const limit = uploadLimit(kind, name, spec.shas?.length ?? 0);
    if (!limit) throw new ApiError('not_found');
    const size = Number(c.req.header('Content-Length') ?? Number.NaN);
    if (!Number.isSafeInteger(size) || size < 1)
      throw new ApiError('validation', [{ path: 'Content-Length', issue: 'the exact size is required' }]);
    if (size > limit) throw new ApiError('too_large');
    const vault = vaultOf(c);
    if (name !== MANIFEST && (await vault.head(incoming(id) + MANIFEST)))
      throw new ApiError('conflict', { reason: 'manifest_sent' });
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length !== size)
      throw new ApiError('validation', [{ path: 'Content-Length', issue: 'not the size sent' }]);
    await vault.put(incoming(id) + name, bytes);
    return c.json({ name, bytes: bytes.length }, 201);
  })
  .post('/jobs/:id/collect', guard('POST /v1/jobs/:id/collect'), async (c) => {
    const id = jobId(c);
    const music = musicObject(c.env);
    const obj = await vaultOf(c).get(incoming(id) + MANIFEST);
    if (!obj) {
      const s = await fresh(music.listenJob(id));
      if (!s) throw new ApiError('not_found');
      if (s.state === 'issued')
        throw s.expires_at <= Date.now()
          ? new ApiError('expired')
          : new ApiError('conflict', { reason: 'no_manifest' });
      return c.json({ state: s.state });
    }
    // Check 1: at most 1 MB and JSON; anything else is a bad manifest, which rejects the job.
    let manifest: unknown = null;
    if (obj.size > L.manifest_bytes) await obj.body.cancel();
    else
      try {
        manifest = JSON.parse(await obj.text());
      } catch {
        manifest = null;
      }
    const out = value(await fresh(music.listenCollect(id, manifest)));
    if (out.state === 'rejected') throw new ApiError('invalid_result', { reason: 'bad_manifest' });
    if (out.payload) await fresh(coreObject(c.env).queueListenApply(out.payload));
    return c.json({ state: out.state }, out.state === 'validating' ? 202 : 200);
  })
  // The phone's one file (listen-pack.ts), by R2's own ETag: an unchanged file costs a 304.
  .get('/music/pack', guard('GET /v1/music/pack'), async (c) => {
    const obj = await vaultOf(c).get(PACK_KEY, { onlyIf: c.req.raw.headers });
    if (!obj) throw new ApiError('not_found');
    c.header('ETag', obj.httpEtag);
    if (!('body' in obj)) return c.body(null, 304);
    return c.body(obj.body, 200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(obj.size) });
  })
  .get('/music/analysis/:id', guard('GET /v1/music/analysis/:id'), async (c) => {
    const id = c.req.param('id');
    if (!SONG_ID.test(id)) throw new ApiError('not_found');
    const q = parse(likeQuery, c.req.query());
    const r = await fresh(musicObject(c.env).trackAnalysis(id, q.like ?? 10));
    if (!r) throw new ApiError('not_found');
    return c.json(r);
  });
