// /v1/files (HOME.md §4.6, API.md §11.7): a chat file's upload and its bytes. The bytes go into
// the private bucket first and the row after, so a row never names missing bytes; they come back
// only through this Worker, to a signed-in caller, never by a link. A voice memo gets its words
// from Workers AI on the way in (transcribe.ts), and dictation's pieces get theirs back without
// being kept (POST /v1/dictate). Nothing here logs a name, a type or a word.
import { Hono } from 'hono';
import type { DictateResponse, FileResponse } from '../../../../shared/contract/files.ts';
import { DICTATE_LIMITS, FILE_LIMITS } from '../../../../shared/contract/files.ts';
import { type AppEnv, guard } from '../../http/auth';
import { callerOf, idParam } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { inSandbox } from '../../http/sandbox';
import { UUIDV7 } from '../../lib/ids';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';
import { putOnce, sha256 } from '../import/vault';
import { toAttachment } from './store';
import { aiOf, hear, transcribe } from './transcribe';
import { fileKey, mediaType, memoSeconds, safeName, servingHeaders, unchanged } from './wire';

const vaultOf = (env: Env): R2Bucket => {
  const v = (env as { VAULT?: R2Bucket }).VAULT;
  if (!v) throw new ApiError('not_configured');
  return v;
};
const SHA = /^[0-9a-f]{64}$/;
/** How long a dictation piece waits for its words: the owner is watching the bar. */
export const DICTATE_MS = 10_000;
/** Pieces one isolate takes a minute: the phone sends about one every 2 s while the mic is held,
 * so this only stops a runaway loop from spending the day's free Whisper on one isolate. */
export const DICTATE_PER_MINUTE = 60;
let minute = { start: 0, n: 0 };
/** Seconds until this isolate takes another piece; 0 when it takes this one now. */
const waitFor = (now = Date.now()): number => {
  if (now - minute.start >= 60_000) minute = { start: now, n: 0 };
  return ++minute.n <= DICTATE_PER_MINUTE ? 0 : Math.max(1, Math.ceil((minute.start + 60_000 - now) / 1000));
};

export const filesRoutes = new Hono<AppEnv>()
  .put('/files/:id', guard('PUT /v1/files/:id'), async (c) => {
    const id = idParam(c);
    // The eval sandbox works on a scratch Core; the bucket is the owner's (EVALS.md §1.1).
    if (inSandbox()) throw new ApiError('validation', [{ path: 'TH-Sandbox', issue: 'the sandbox keeps no files' }]);
    const vault = vaultOf(c.env);
    const name = safeName(c.req.header('TH-File-Name'));
    const type = mediaType(c.req.header('Content-Type'));
    const seconds = memoSeconds(c.req.header('TH-Seconds'), type);
    const sha = (c.req.header('TH-Sha256') ?? '').trim().toLowerCase();
    if (!SHA.test(sha)) throw new ApiError('validation', [{ path: 'TH-Sha256', issue: 'hex SHA-256 of the body' }]);
    const core = coreObject(c.env);
    // A retry: the same bytes are the same file (no second upload); other bytes are a conflict.
    const had = await fresh(core.fileRow(id));
    if (had) {
      if (had.sha256 !== sha) throw new ApiError('conflict');
      return c.json(toAttachment(had) satisfies FileResponse, 200);
    }
    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength > FILE_LIMITS.bytes) throw new ApiError('too_large');
    if (bytes.byteLength === 0) throw new ApiError('validation', [{ path: 'body', issue: 'the file is empty' }]);
    if ((await sha256(bytes)) !== sha)
      throw new ApiError('validation', [{ path: 'TH-Sha256', issue: 'does not match the body' }]);
    const key = fileKey(id, type);
    let stored: 'stored' | 'conflict';
    try {
      stored = await putOnce(vault, key, bytes, sha, type);
    } catch {
      throw new ApiError('upstream');
    }
    if (stored === 'conflict') throw new ApiError('conflict');
    const text = seconds !== null ? await transcribe(aiOf(c.env), bytes, type) : null;
    const f = { id, key, name, type, bytes: bytes.byteLength, sha256: sha, seconds, text };
    const out = value(await fresh(core.putFile(callerOf(c), f)));
    return c.json(out.file satisfies FileResponse, out.created ? 201 : 200);
  })
  // A piece of what the owner is saying, for its words now (HOME.md §6.4). Nothing is stored:
  // not the audio, not the words, not a row. A failed hearing is 502, so the phone can tell it
  // from silence ('').
  .post('/dictate', guard('POST /v1/dictate'), async (c) => {
    const type = mediaType(c.req.header('Content-Type'));
    if (!type.startsWith('audio/')) throw new ApiError('validation', [{ path: 'Content-Type', issue: 'audio only' }]);
    if (Number(c.req.header('Content-Length') ?? 0) > DICTATE_LIMITS.bytes) throw new ApiError('too_large');
    const ai = aiOf(c.env);
    if (!ai) throw new ApiError('not_configured');
    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength > DICTATE_LIMITS.bytes) throw new ApiError('too_large');
    if (bytes.byteLength === 0) throw new ApiError('validation', [{ path: 'body', issue: 'nothing to hear' }]);
    const wait = waitFor();
    if (wait) throw new ApiError('rate_limited', undefined, { retry_after: wait, scope: 'account' });
    let text: string;
    try {
      text = await hear(ai, bytes, type, DICTATE_MS);
    } catch {
      throw new ApiError('upstream');
    }
    return c.json({ text } satisfies DictateResponse);
  })
  .get('/files/:id', guard('GET /v1/files/:id'), async (c) => {
    const id = c.req.param('id') ?? '';
    if (!UUIDV7.test(id)) throw new ApiError('not_found');
    const vault = vaultOf(c.env);
    const f = await fresh(coreObject(c.env).fileRow(id));
    if (!f) throw new ApiError('not_found');
    // `?meta=1`: the file as a message carries it (name, type, size, a memo's seconds and words).
    if (c.req.query('meta') === '1') return c.json(toAttachment(f) satisfies FileResponse);
    const headers = servingHeaders(f);
    if (unchanged(c.req.header('If-None-Match'), headers.ETag)) return c.body(null, 304, headers);
    const obj = await vault.get(f.key);
    if (!obj) throw new ApiError('not_found');
    return c.body(obj.body, 200, { ...headers, 'Content-Length': String(obj.size) });
  });
