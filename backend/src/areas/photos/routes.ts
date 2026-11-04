// /v1/photos (PHOTOS.md §3.1, API.md §11.26): the shelf by day (newest first, four photos and a
// count a day; `?day=` one whole day), one photo, its rating and flag, Recently deleted and back,
// and its preview: a JPEG of at most 400 KB the phone made, kept in the private bucket under
// photos/previews/ and served only through this Worker. The owner's phone only.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import {
  PHOTO_LIMITS as L,
  PHOTO_FLAGS,
  PHOTO_FORMATS,
  type PhotoItem,
  type PhotoShelfResponse,
} from '../../../../shared/contract/photos.ts';
import { type AppEnv, guard } from '../../http/auth';
import { idParam } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { inSandbox } from '../../http/sandbox';
import { json } from '../../http/validate';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';
import { sha256 } from '../import/vault';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (max: number) => z.string().check(z.minLength(1), z.maxLength(max));
const maybe = <T extends z.ZodMiniType>(t: T) => z.optional(z.nullable(t));
const dim = z.number().check(z.int(), z.gte(1), z.lte(100_000));
const putBody = z.strictObject({
  drive_id: z.string().check(z.regex(/^[A-Za-z0-9_-]{1,160}$/)),
  name: text(L.name_chars),
  format: z.enum(PHOTO_FORMATS),
  bytes: z.number().check(z.int(), z.gte(1), z.lte(L.bytes_max)),
  sha256: z.string().check(z.regex(/^[0-9a-f]{64}$/)),
  camera: maybe(text(L.camera_chars)),
  film: maybe(text(L.film_chars)),
  width: maybe(dim),
  height: maybe(dim),
  taken_at: z.number().check(z.int(), z.gte(0), z.lte(Number.MAX_SAFE_INTEGER)),
});
const patchBody = z.strictObject({
  rating: z.optional(z.number().check(z.int(), z.gte(0), z.lte(5))),
  flag: z.optional(z.nullable(z.enum(PHOTO_FLAGS))),
});
const vaultOf = (env: Env): R2Bucket => {
  const v = (env as { VAULT?: R2Bucket }).VAULT;
  if (!v) throw new ApiError('not_configured');
  return v;
};
const found = (p: PhotoItem | null) => {
  if (!p) throw new ApiError('not_found');
  return p;
};

export const photosRoutes = new Hono<AppEnv>()
  .get('/photos', guard('GET /v1/photos'), async (c) => {
    const day = c.req.query('day');
    const before = c.req.query('before');
    for (const [k, v] of [
      ['day', day],
      ['before', before],
    ] as const)
      if (v !== undefined && !DAY.test(v)) throw new ApiError('validation', [{ path: k, issue: 'a YYYY-MM-DD day' }]);
    const core = coreObject(c.env);
    const out = day ? await fresh(core.photosDay(day)) : await fresh(core.photosShelf(before ?? null));
    return c.json(out satisfies PhotoShelfResponse);
  })
  .get('/photos/deleted', guard('GET /v1/photos/deleted'), async (c) =>
    c.json({ items: await fresh(coreObject(c.env).photosDeleted()) }),
  )
  .put('/photos/:id', guard('PUT /v1/photos/:id'), async (c) => {
    const id = idParam(c);
    const body = await json(c, putBody);
    const out = value(await fresh(coreObject(c.env).putPhoto(id, body)));
    return c.json({ photo: out.photo }, out.created ? 201 : 200);
  })
  .get('/photos/:id', guard('GET /v1/photos/:id'), async (c) =>
    c.json({ photo: found(await fresh(coreObject(c.env).photo(idParam(c)))) }),
  )
  .patch('/photos/:id', guard('PATCH /v1/photos/:id'), async (c) => {
    const id = idParam(c);
    const body = await json(c, patchBody);
    return c.json({ photo: value(await fresh(coreObject(c.env).patchPhoto(id, body))) });
  })
  .delete('/photos/:id', guard('DELETE /v1/photos/:id'), async (c) =>
    c.json({ photo: value(await fresh(coreObject(c.env).deletePhoto(idParam(c)))) }),
  )
  .post('/photos/:id/restore', guard('POST /v1/photos/:id/restore'), async (c) =>
    c.json({ photo: value(await fresh(coreObject(c.env).restorePhoto(idParam(c)))) }),
  )
  .put('/photos/:id/preview', guard('PUT /v1/photos/:id/preview'), async (c) => {
    const id = idParam(c);
    if (inSandbox()) throw new ApiError('validation', [{ path: 'TH-Sandbox', issue: 'the sandbox keeps no previews' }]);
    if ((c.req.header('Content-Type') ?? '').split(';')[0]?.trim() !== 'image/jpeg')
      throw new ApiError('validation', [{ path: 'Content-Type', issue: 'image/jpeg' }]);
    const vault = vaultOf(c.env);
    const core = coreObject(c.env);
    found(await fresh(core.photo(id)));
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength > L.preview_bytes) throw new ApiError('too_large');
    if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
      throw new ApiError('validation', [{ path: 'body', issue: 'a JPEG' }]);
    const key = `photos/previews/${id}.jpg`;
    const sha = await sha256(bytes);
    try {
      await vault.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' }, sha256: sha });
    } catch {
      throw new ApiError('upstream');
    }
    return c.json({ photo: value(await fresh(core.photoPreview(id, key, sha))) });
  })
  .get('/photos/:id/preview', guard('GET /v1/photos/:id/preview'), async (c) => {
    const id = idParam(c);
    const vault = vaultOf(c.env);
    const p = await fresh(coreObject(c.env).photoPreviewKey(id));
    if (!p) throw new ApiError('not_found');
    const headers = { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-cache', ETag: `"${p.sha}"` };
    if ((c.req.header('If-None-Match') ?? '').includes(p.sha)) return c.body(null, 304, headers);
    const obj = await vault.get(p.key);
    if (!obj) throw new ApiError('not_found');
    return c.body(obj.body, 200, { ...headers, 'Content-Length': String(obj.size) });
  });
