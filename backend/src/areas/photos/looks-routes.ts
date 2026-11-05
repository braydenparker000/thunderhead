// /v1/photos/looks (PHOTOS.md, Looks; API.md §11.26): the owner's looks, listed, added or replaced in
// batches of up to 50 (a save, or an import of .xmp presets or a pasted recipe), renamed or updated
// from the current edit, and deleted. Mounted before photos' own routes, so `looks` is never read as
// a photo's id. The owner's phone only.
import { Hono } from 'hono';
import { type AppEnv, guard } from '../../http/auth';
import { idParam } from '../../http/caller';
import { json } from '../../http/validate';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';
import { patchBody, putBody } from './looks';

export const looksRoutes = new Hono<AppEnv>()
  .get('/photos/looks', guard('GET /v1/photos/looks'), async (c) =>
    c.json({ items: await fresh(coreObject(c.env).photoLooks()) }),
  )
  .put('/photos/looks', guard('PUT /v1/photos/looks'), async (c) => {
    const body = await json(c, putBody);
    const out = value(await fresh(coreObject(c.env).putPhotoLooks(body.items)));
    return c.json(out, out.created ? 201 : 200);
  })
  .patch('/photos/looks/:lid', guard('PATCH /v1/photos/looks/:lid'), async (c) => {
    const id = idParam(c, 'lid');
    const body = await json(c, patchBody);
    return c.json({ look: value(await fresh(coreObject(c.env).patchPhotoLook(id, body))) });
  })
  .delete('/photos/looks/:lid', guard('DELETE /v1/photos/looks/:lid'), async (c) => {
    value(await fresh(coreObject(c.env).deletePhotoLook(idParam(c, 'lid'))));
    return c.json({ ok: true });
  });
