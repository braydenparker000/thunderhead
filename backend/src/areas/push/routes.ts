// /v1/push and /v1/pushes (P8; SECURITY.md §10, BEHAVIOR.md §3.4): a phone's subscription and the
// VAPID public key, the words a push points at (its service worker asks with the phone's own
// token), a test to this phone now, and the mind's nudge. What may go is sent from the Auth object
// at once, and again by the 15-minute cron (`deliver`). A nudge from the eval sandbox is answered
// but never reaches a phone.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import { type AppEnv, deviceOf, guard } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { inSandbox } from '../../http/sandbox';
import { json } from '../../http/validate';
import { fromB64u, pushService, vapidPublic } from '../../lib/webpush';
import { authObject } from '../../objects/auth';
import { coreObject } from '../../objects/core';
import { sha256Hex } from '../auth/crypto';

/** Sends every push that may go now. */
export async function deliver(env: Env) {
  const ctx = await coreObject(env).pushContext();
  return authObject(env).deliverPushes(ctx);
}

const B64U = /^[A-Za-z0-9_-]+$/;
const subscriptionBody = z.object({
  endpoint: z.string().check(z.maxLength(1024)),
  keys: z.object({
    p256dh: z.string().check(z.regex(B64U), z.maxLength(100)),
    auth: z.string().check(z.regex(B64U), z.maxLength(40)),
  }),
});
const words = (max: number) => z.string().check(z.minLength(1), z.maxLength(max), z.regex(/^[^!]*$/));
const nudgeBody = z.object({
  title: words(40),
  body: words(100),
  ref: z.optional(z.string().check(z.maxLength(200))),
  why: z.string().check(z.minLength(8), z.maxLength(300)),
  topic_key: z.string().check(z.minLength(1), z.maxLength(80), z.regex(/^[a-z0-9._:-]+$/)),
  deadline: z.optional(z.number().check(z.int(), z.gte(0))),
});
const ID = /^[A-Za-z0-9_-]{8,64}$/;

function configured(env: Env): void {
  if (!vapidPublic(env.VAPID_PRIVATE_JWK)) throw new ApiError('not_configured');
}

export const pushRoutes = new Hono<AppEnv>()
  .get('/push/key', guard('GET /v1/push/key'), (c) => {
    configured(c.env);
    return c.json({ vapid_public_key: vapidPublic(c.env.VAPID_PRIVATE_JWK) as string });
  })
  .put('/push/subscription', guard('PUT /v1/push/subscription'), async (c) => {
    const me = deviceOf(c);
    const b = await json(c, subscriptionBody);
    const ok = pushService(b.endpoint) && fromB64u(b.keys.p256dh).length === 65 && fromB64u(b.keys.auth).length === 16;
    if (!ok)
      throw new ApiError('validation', [{ path: 'endpoint', issue: 'Not a push subscription this server sends to.' }]);
    await authObject(c.env).putPushSubscription(me.session_id, {
      endpoint: b.endpoint,
      p256dh: b.keys.p256dh,
      auth: b.keys.auth,
    });
    return c.body(null, 204);
  })
  .delete('/push/subscription', guard('DELETE /v1/push/subscription'), async (c) => {
    await authObject(c.env).deletePushSubscription(deviceOf(c).session_id);
    return c.body(null, 204);
  })
  .post('/push/test', guard('POST /v1/push/test'), async (c) => {
    configured(c.env);
    const id = await authObject(c.env).queuePushTest(deviceOf(c).session_id);
    const out = await deliver(c.env);
    return c.json({ sent: out.sent.includes(id) ? 1 : 0 });
  })
  .get('/push/items/:id', guard('GET /v1/push/items/:id'), async (c) => {
    const id = c.req.param('id');
    const item = ID.test(id) ? await authObject(c.env).pushItem(id) : null;
    if (!item) throw new ApiError('not_found');
    return c.json(item);
  })
  .put('/pushes/:id', guard('PUT /v1/pushes/:id'), async (c) => {
    const id = c.req.param('id');
    if (!ID.test(id)) throw new ApiError('not_found');
    const r = await json(c, nudgeBody);
    configured(c.env);
    if (inSandbox()) return c.json({ queued_until: Date.now() }, 202);
    const ctx = await coreObject(c.env).pushContext();
    const out = await authObject(c.env).queueNudge(id, r, sha256Hex(JSON.stringify(r)), ctx);
    if ('code' in out) throw new ApiError(out.code);
    c.executionCtx.waitUntil(deliver(c.env).catch(() => {}));
    return c.json(out, 202);
  });
