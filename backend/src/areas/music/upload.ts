// /v1/music/uploads/* (MIGRATION.md §7 step 4, the old repo's backend/music-upload.js, ported): the
// upload tools, server to server. No bearer token: each request is signed (Ed25519) by one of the
// tools' keys (`MUSIC_UPLOAD_PUBLIC_KEYS`, a JSON list of hex public keys, set by the owner, SETUP.md
// N4) over its method, origin, path, type, the body's SHA-256 and size and a time within five
// minutes, so a replay can only repeat the same idempotent request. A request from a browser (any
// Origin) is refused.
// - PUT …/audio/<sha256>.opus and …/art/<sha256>.jpg|png: the bytes are checked against the signed
//   hash and their own format, then stored once in `jarvis-music` under their content address
//   (`If-None-Match: *`), marked verified. The only writes this Worker makes to that bucket; it
//   never deletes from it (DATA.md §7.2).
// - POST …/<op>: the catalog writer's operations (areas/music/writer*.ts) in the Music object;
//   `export` (the catalog with its waveforms) and `links` (signed links to tracks' audio, for the
//   waveform backfill) read only.
import { Hono } from 'hono';
import type { AppEnv } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { musicObject, type WriteResult } from '../../objects/music';
import { fresh } from '../../objects/rpc';
import { sha256 } from '../import/vault';
import { SONG_ID } from './shapes';
import { signKey, signR2 } from './sign';
import { HEX, signatureMessage } from './validate';
import { proof, verifiedBlob } from './writer';

export const UPLOAD_LIMITS = { audio: 32 * 1024 * 1024, art: 2 * 1024 * 1024, op: 64 * 1024, batch: 1024 * 1024 };
/** The operations whose bodies may reach `batch` bytes. */
export const BIG_OPS = new Set(['register-batch', 'waveforms']);
const AUDIO = /^([a-f0-9]{64})\.opus$/;
const ART = /^([a-f0-9]{64})\.(jpg|png)$/;
const LINKS_MAX = 100;
const enc = new TextEncoder();
const raw = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (x) => Number.parseInt(x, 16));

interface Signed {
  size: number;
  hash: string;
  type: string;
}

/** The request's signature, checked; the signed size, hash and type. */
async function signed(c: { env: Env; req: { header(n: string): string | undefined; method: string; url: string } }) {
  if (c.req.header('Origin') !== undefined) throw new ApiError('forbidden');
  const list = c.env.MUSIC_UPLOAD_PUBLIC_KEYS;
  if (!list || list === 'none') throw new ApiError('not_configured');
  let keys: unknown;
  try {
    keys = JSON.parse(list);
  } catch {
    throw new ApiError('not_configured');
  }
  if (!Array.isArray(keys) || keys.length > 8 || !keys.every((k) => HEX.test(String(k))))
    throw new ApiError('not_configured');
  const h = (n: string) => c.req.header(n) ?? '';
  const [key, sig, time, size, hash] = [
    'X-Music-Public-Key',
    'X-Music-Signature',
    'X-Music-Timestamp',
    'X-Music-Size',
    'X-Music-Sha256',
  ].map(h);
  if (
    !HEX.test(key) ||
    !keys.includes(key) ||
    !/^[a-f0-9]{128}$/.test(sig) ||
    !/^\d{10}$/.test(time) ||
    Math.abs(Date.now() / 1000 - Number(time)) > 300 ||
    !/^[1-9]\d{0,8}$/.test(size) ||
    !HEX.test(hash)
  )
    throw new ApiError('unauthorized');
  const type = h('Content-Type');
  const url = new URL(c.req.url);
  const message = signatureMessage({
    method: c.req.method,
    origin: url.origin,
    path: url.pathname,
    type,
    hash,
    size,
    time,
    key,
  });
  const k = await crypto.subtle.importKey('raw', raw(key), { name: 'Ed25519' }, false, ['verify']);
  if (!(await crypto.subtle.verify({ name: 'Ed25519' }, k, raw(sig), enc.encode(message))))
    throw new ApiError('unauthorized');
  return { size: Number(size), hash, type } satisfies Signed;
}

/** The body, which must be exactly the signed bytes. */
async function body(c: { req: { arrayBuffer(): Promise<ArrayBuffer> } }, s: Signed): Promise<Uint8Array> {
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length !== s.size || (await sha256(bytes)) !== s.hash)
    throw new ApiError('validation', [{ path: 'body', issue: 'the bytes do not match the signed hash and size' }]);
  return bytes;
}

const media = (env: Env) => {
  if (!env.MEDIA) throw new ApiError('not_configured');
  return env.MEDIA;
};

/** Stores verified bytes once under their content address. */
async function store(env: Env, key: string, sha: string, bytes: Uint8Array, contentType: string) {
  const bucket = media(env);
  const o =
    (await bucket.put(key, bytes, {
      onlyIf: new Headers({ 'If-None-Match': '*' }),
      sha256: sha,
      httpMetadata: { contentType, cacheControl: 'private, max-age=31536000, immutable' },
      customMetadata: { 'verified-sha256': sha, verification: 'worker-upload-sha256-v1' },
    })) ?? (await bucket.head(key));
  if (!o || !verifiedBlob(o, sha, bytes.length))
    throw new ApiError('conflict', { reason: 'an object with other bytes is already at this key' });
  return { key, sha256: sha, size: o.size, r2Identity: proof(o) };
}

const OGG = (b: Uint8Array) => {
  const head = new TextDecoder().decode(b.slice(0, 96));
  return head.startsWith('OggS') && head.includes('OpusHead');
};
const JPEG = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const PNG = (b: Uint8Array) => [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v);

/** The writer's answer as this API's error envelope. */
function answer(status: number, b: Record<string, unknown>): never {
  const reason = String(b.error ?? '');
  if (status === 404) throw new ApiError('not_found');
  if (status === 409) throw new ApiError('conflict', { ...b, reason });
  if (status === 413) throw new ApiError('too_large');
  if (status === 422) throw new ApiError('validation', [{ path: 'body', issue: reason }]);
  throw new ApiError(status === 503 ? 'not_configured' : 'unavailable');
}

export const uploadRoutes = new Hono<AppEnv>()
  .put('/music/uploads/audio/:file', async (c) => {
    const m = AUDIO.exec(c.req.param('file'));
    if (!m) throw new ApiError('not_found');
    const s = await signed(c);
    if (s.size > UPLOAD_LIMITS.audio) throw new ApiError('too_large');
    if (s.type !== 'audio/ogg') throw new ApiError('unsupported_media_type');
    if (m[1] !== s.hash) throw new ApiError('validation', [{ path: 'path', issue: 'the key is not the signed hash' }]);
    const bytes = await body(c, s);
    if (!OGG(bytes)) throw new ApiError('unsupported_media_type');
    return c.json(await store(c.env, `native/audio/${s.hash}.opus`, s.hash, bytes, 'audio/ogg'));
  })
  .put('/music/uploads/art/:file', async (c) => {
    const m = ART.exec(c.req.param('file'));
    if (!m) throw new ApiError('not_found');
    const s = await signed(c);
    if (s.size > UPLOAD_LIMITS.art) throw new ApiError('too_large');
    const type = m[2] === 'jpg' ? 'image/jpeg' : 'image/png';
    if (s.type !== type) throw new ApiError('unsupported_media_type');
    if (m[1] !== s.hash) throw new ApiError('validation', [{ path: 'path', issue: 'the key is not the signed hash' }]);
    const bytes = await body(c, s);
    if (!(m[2] === 'jpg' ? JPEG(bytes) : PNG(bytes))) throw new ApiError('unsupported_media_type');
    return c.json(await store(c.env, `native/art/${s.hash}.${m[2]}`, s.hash, bytes, type));
  })
  .post('/music/uploads/:op', async (c) => {
    const op = c.req.param('op');
    if (!/^[a-z-]{1,40}$/.test(op)) throw new ApiError('not_found');
    const s = await signed(c);
    if (s.size > (BIG_OPS.has(op) ? UPLOAD_LIMITS.batch : UPLOAD_LIMITS.op)) throw new ApiError('too_large');
    if (s.type !== 'application/json') throw new ApiError('unsupported_media_type');
    let input: unknown;
    try {
      input = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(await body(c, s)));
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError('bad_request');
    }
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new ApiError('validation', [{ path: 'body', issue: 'a JSON object' }]);
    const music = musicObject(c.env);
    if (op === 'export')
      return c.body(await fresh(music.exportCatalog()), 200, { 'Content-Type': 'application/json; charset=utf-8' });
    if (op === 'links') return c.json(await links(c.env, (input as { ids?: unknown }).ids));
    // The RPC types can't carry `unknown`; the body is the writer's own JSON.
    const r = (await fresh(music.write(op, input as Record<string, unknown>))) as unknown as WriteResult;
    if (r.status !== 200) answer(r.status, r.body);
    return c.json(r.body);
  });

/** Signed links to tracks' audio (3 h), for a tool that measures the audio itself. */
async function links(env: Env, ids: unknown) {
  const key = signKey(env);
  if (!key) throw new ApiError('not_configured');
  if (!Array.isArray(ids) || !ids.length || ids.length > LINKS_MAX || !ids.every((id) => SONG_ID.test(String(id))))
    throw new ApiError('validation', [{ path: 'ids', issue: `1 to ${LINKS_MAX} track ids` }]);
  const found = await fresh(musicObject(env).keys([...new Set(ids as string[])]));
  const now = Date.now();
  const items = [];
  for (const t of found) items.push({ id: t.id, ...(await signR2(key, 'jarvis-music', t.audio_key, now)) });
  return { items, notFound: (ids as string[]).filter((id) => !found.some((t) => t.id === id)) };
}
