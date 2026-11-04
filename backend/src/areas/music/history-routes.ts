// /v1/music/history, /v1/music/taste and /v1/music/similar/:mbid (MUSIC.md §16, API.md §11.9): the
// owner's listening-history files in, their taste out. A file is kept in the private bucket by its
// SHA-256 (which the phone sends and the Worker checks), so the same file again is answered with its
// import's state and never counted twice; its import is a job in Core (history-job.ts). The mind
// reads counts, ids and canonical names only.
import { Hono } from 'hono';
import {
  type HistoryPut,
  type HistoryStatus,
  TASTE_LIMITS as L,
  type SimilarResponse,
  type TasteResponse,
} from '../../../../shared/contract/taste.ts';
import { type AppEnv, guard } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { inSandbox } from '../../http/sandbox';
import { coreObject } from '../../objects/core';
import { musicObject } from '../../objects/music';
import { fresh } from '../../objects/rpc';
import { putOnce, sha256 } from '../import/vault';
import { refuseWhileHeld } from '../meter/hold';
import { historyKey } from './history-job';
import { MBID, similarFetch } from './history-mb';
import { guessSource, kindOf } from './history-read';

const SHA = /^[0-9a-f]{64}$/;
const NAME = /^[^/\\]{1,200}$/;
const CONTROL = /\p{Cc}/u;

export const historyRoutes = new Hono<AppEnv>()
  .put('/music/history', guard('PUT /v1/music/history'), async (c) => {
    if (inSandbox()) throw new ApiError('validation', [{ path: 'TH-Sandbox', issue: 'the sandbox has no music' }]);
    const name = decodeURIComponent(c.req.header('TH-File-Name') ?? '');
    const want = (c.req.header('TH-Sha256') ?? '').toLowerCase();
    if (!NAME.test(name) || CONTROL.test(name))
      throw new ApiError('validation', [{ path: 'TH-File-Name', issue: 'the file name' }]);
    if (!SHA.test(want)) throw new ApiError('validation', [{ path: 'TH-Sha256', issue: '64 lowercase hex' }]);
    const bytes = await c.req.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > L.file_bytes)
      throw new ApiError('validation', [{ path: 'body', issue: `1 byte to ${L.file_bytes} bytes` }]);
    if ((await sha256(bytes)) !== want)
      throw new ApiError('validation', [{ path: 'TH-Sha256', issue: 'not these bytes' }]);
    if (!kindOf(name, new Uint8Array(bytes)))
      throw new ApiError('validation', [{ path: 'body', issue: 'a zip, json or csv export' }]);
    const music = musicObject(c.env);
    const had = await fresh(music.historyFile(want));
    if (had?.state === 'done')
      return c.json({ sha256: want, source: had.source, state: 'done' } satisfies HistoryPut, 200);
    const vault = (c.env as { VAULT?: R2Bucket }).VAULT;
    if (!vault) throw new ApiError('not_configured');
    await putOnce(vault, historyKey(want), bytes, want, 'application/octet-stream');
    const state = await fresh(coreObject(c.env).queueHistory({ sha256: want, name }));
    const source = had?.source ?? guessSource(name, new Uint8Array(bytes));
    return c.json({ sha256: want, source, state } satisfies HistoryPut, state === 'done' ? 200 : 202);
  })
  .get('/music/history', guard('GET /v1/music/history'), async (c) =>
    c.json((await fresh(musicObject(c.env).historyStatus())) satisfies HistoryStatus),
  )
  .get('/music/taste', guard('GET /v1/music/taste'), async (c) => {
    const n = Number(c.req.query('limit') ?? L.taste_default);
    if (!Number.isInteger(n) || n < 1 || n > L.taste_max)
      throw new ApiError('validation', [{ path: 'limit', issue: `1 to ${L.taste_max}` }]);
    return c.json((await fresh(musicObject(c.env).taste(n))) satisfies TasteResponse);
  })
  .get('/music/similar/:mbid', guard('GET /v1/music/similar/:mbid'), async (c) => {
    const mbid = c.req.param('mbid');
    if (!MBID.test(mbid)) throw new ApiError('validation', [{ path: 'mbid', issue: 'a MusicBrainz artist id' }]);
    const music = musicObject(c.env);
    const now = Date.now();
    const had = await fresh(music.similarCached(mbid));
    if (had && now - had.fetched_at < L.similar_ms) return c.json({ mbid, ...had } satisfies SimilarResponse);
    await refuseWhileHeld(c.env);
    const items = await similarFetch(c.env, mbid);
    if (!items) {
      if (had) return c.json({ mbid, ...had } satisfies SimilarResponse);
      throw new ApiError('unavailable', { reason: 'ListenBrainz did not answer' });
    }
    return c.json({ mbid, ...(await fresh(music.putSimilar(mbid, items, now))) } satisfies SimilarResponse);
  });
