// /v1/auth (API.md §11.2–11.4). Handlers validate the shape, call one Auth RPC and map the
// result; behaviour lives in the Auth object. Auth handlers never log bodies.
import { type Context, Hono } from 'hono';
import type {
  AgentMe,
  AgentsResponse,
  AuthStateResponse,
  BreakglassResponse,
  DeviceMe,
  NewAgentResponse,
  PasswordResponse,
  RecoveryCodeResponse,
  SessionItem,
  SessionsResponse,
  SignedIn,
  SignedInWithCode,
} from '../../../../shared/contract/api';
import { type AppEnv, country, deviceOf, forget, guard, principalOf } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { json, parse } from '../../http/validate';
import { authObject } from '../../objects/auth';
import { coreObject } from '../../objects/core';
import type { Failure, RequestMeta } from './flows';
import * as s from './schema';

/** Cloudflare sets CF-Connecting-IP on every request; it is hashed in the Auth object. */
function meta(c: Context<AppEnv>): RequestMeta {
  const region = (c.req.raw.cf as { region?: string } | undefined)?.region ?? null;
  return { ip: c.req.header('CF-Connecting-IP') ?? 'unknown', country: country(c), region };
}

/** The value of a successful result, or the thrown §6 error of a failed one. */
function ok<T extends object>(result: ({ ok: true } & T) | Failure): T {
  if (!result.ok)
    throw new ApiError(result.code, result.details, { retry_after: result.retry_after, scope: result.scope });
  const { ok: _ok, ...body } = result;
  return body as unknown as T;
}

const auth = (c: Context<AppEnv>) => authObject(c.env);

/** Signed-out sessions: dropped from this isolate's cache at once, and their live sockets are
 * closed with 4401 (API.md §12) after the response. */
function revoke(c: Context<AppEnv>, ids: string[]): void {
  forget(ids);
  if (ids.length) c.executionCtx.waitUntil(coreObject(c.env).liveRevoke(ids));
}

export const authRoutes = new Hono<AppEnv>()
  // --- public ----------------------------------------------------------------------------------
  .get('/state', async (c) => {
    const q = parse(s.stateQuery, c.req.query());
    return c.json((await auth(c).state(q.fp ?? null, q.reset_fp ?? null)) satisfies AuthStateResponse);
  })
  .post('/setup', async (c) => {
    const body = await json(c, s.setupBody);
    return c.json(ok<SignedInWithCode>(await auth(c).setup(body, meta(c))), 201);
  })
  .post('/login', async (c) => {
    const body = await json(c, s.loginBody);
    return c.json(ok<SignedIn>(await auth(c).login(body, meta(c))));
  })
  .post('/recover', async (c) => {
    const body = await json(c, s.recoverBody);
    const out = ok<SignedInWithCode>(await auth(c).recover(body, meta(c)));
    // Recovery ended every session; drop this isolate's cached ones right away.
    forget();
    return c.json(out);
  })
  // --- this device -----------------------------------------------------------------------------
  .get('/me', guard('GET /v1/auth/me'), async (c) => {
    const p = principalOf(c);
    if (p.kind === 'agent') return c.json({ agent_id: p.agent_id, role: p.role, name: p.name } satisfies AgentMe);
    return c.json(ok<DeviceMe>(await auth(c).me(p.session_id)));
  })
  .post('/signout', guard('POST /v1/auth/signout'), async (c) => {
    const { scope } = await json(c, s.signoutBody);
    revoke(c, await auth(c).signout(deviceOf(c).session_id, scope));
    return c.body(null, 204);
  })
  .post('/notices/:id/ack', guard('POST /v1/auth/notices/:id/ack'), async (c) => {
    const { id } = parse(s.idParam, c.req.param());
    const { answer } = await json(c, s.ackBody);
    revoke(c, ok<{ forget: string[] }>(await auth(c).ackNotice(deviceOf(c).session_id, id, answer)).forget);
    return c.body(null, 204);
  })
  // --- password and recovery code --------------------------------------------------------------
  .post('/password', guard('POST /v1/auth/password'), async (c) => {
    const body = await json(c, s.passwordBody);
    revoke(c, ok<{ forget: string[] }>(await auth(c).changePassword(deviceOf(c).session_id, body)).forget);
    return c.json({} satisfies PasswordResponse);
  })
  .post('/recovery-code', guard('POST /v1/auth/recovery-code'), async (c) => {
    const { current_password } = await json(c, s.recoveryCodeBody);
    return c.json(ok<RecoveryCodeResponse>(await auth(c).newRecoveryCode(deviceOf(c).session_id, current_password)));
  })
  .post('/recovery-code/confirm', guard('POST /v1/auth/recovery-code/confirm'), async (c) => {
    const { last5 } = await json(c, s.recoveryConfirmBody);
    ok(await auth(c).confirmRecovery(last5));
    return c.body(null, 204);
  })
  // --- reset ticket ----------------------------------------------------------------------------
  .post('/breakglass', guard('POST /v1/auth/breakglass'), async (c) => {
    const { fingerprint } = await json(c, s.breakglassBody);
    return c.json(ok<BreakglassResponse>(await auth(c).breakglass(fingerprint)), 201);
  })
  .post('/breakglass/cancel', guard('POST /v1/auth/breakglass/cancel'), async (c) => {
    const { ticket_id } = await json(c, s.cancelBody);
    const me = deviceOf(c);
    ok(await auth(c).cancelReset(me.session_id, me.label, ticket_id));
    return c.body(null, 204);
  })
  // --- sessions (devices) ----------------------------------------------------------------------
  .get('/sessions', guard('GET /v1/auth/sessions'), async (c) => {
    return c.json({ items: await auth(c).sessions(deviceOf(c).session_id) } satisfies SessionsResponse);
  })
  .patch('/sessions/:id', guard('PATCH /v1/auth/sessions/:id'), async (c) => {
    const { id } = parse(s.idParam, c.req.param());
    const { label } = await json(c, s.labelBody);
    return c.json(ok<SessionItem>(await auth(c).relabel(deviceOf(c).session_id, id, label)));
  })
  .delete('/sessions/:id', guard('DELETE /v1/auth/sessions/:id'), async (c) => {
    const { id } = parse(s.idParam, c.req.param());
    // 204 also when already gone; revoked within 60 s everywhere (this isolate at once).
    revoke(c, [id, ...(await auth(c).revokeSession(deviceOf(c).session_id, id))]);
    return c.body(null, 204);
  })
  // --- agent keys ------------------------------------------------------------------------------
  .get('/agents', guard('GET /v1/auth/agents'), async (c) => {
    return c.json({ items: await auth(c).agents() } satisfies AgentsResponse);
  })
  .post('/agents', guard('POST /v1/auth/agents'), async (c) => {
    const body = await json(c, s.agentBody);
    return c.json(ok<NewAgentResponse>(await auth(c).createAgent(deviceOf(c).session_id, body)), 201);
  })
  .delete('/agents/:id', guard('DELETE /v1/auth/agents/:id'), async (c) => {
    const { id } = parse(s.idParam, c.req.param());
    await auth(c).revokeAgent(id);
    forget([id]);
    return c.body(null, 204);
  });
