// Shared test helpers. Everything is synthetic: example usernames, TEST-NET addresses
// (192.0.2.0/24, 2001:db8::/32) and the fixture setup code whose fingerprint vitest.config.ts
// installs as AUTH_SETUP_FP. Storage is isolated per test file.
import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import type { AgentRole, NewAgentResponse, SignedIn, SignedInWithCode } from '../../shared/contract/api';
import type { Auth } from '../src/objects/auth';
import { authObject } from '../src/objects/auth';
import type { Core } from '../src/objects/core';
import { coreObject } from '../src/objects/core';
import { PASSWORD, SETUP_CODE, USERNAME } from './fixtures';

export { PASSWORD, SETUP_CODE, SITE, USERNAME } from './fixtures';

export interface Call {
  token?: string;
  body?: unknown;
  ip?: string;
  headers?: Record<string, string>;
}

/** One request through the Worker's real fetch handler. */
export async function api(method: string, path: string, call: Call = {}): Promise<Response> {
  const headers = new Headers(call.headers);
  if (call.token) headers.set('Authorization', `Bearer ${call.token}`);
  if (call.body !== undefined) headers.set('Content-Type', 'application/json');
  headers.set('CF-Connecting-IP', call.ip ?? '192.0.2.10');
  const body = call.body === undefined ? undefined : JSON.stringify(call.body);
  return exports.default.fetch(new Request(`https://api.example.test${path}`, { method, headers, body }));
}

export async function apiJson<T>(method: string, path: string, call: Call = {}): Promise<{ status: number; body: T }> {
  const res = await api(method, path, call);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

export const DEVICE = { platform: 'Android', browser: 'Chrome', standalone: false };

export async function setupOwner(device: object = { ...DEVICE, model: 'Test phone' }): Promise<SignedInWithCode> {
  const { status, body } = await apiJson<SignedInWithCode>('POST', '/v1/auth/setup', {
    body: { setup_code: SETUP_CODE, username: USERNAME, password: PASSWORD, device },
  });
  if (status !== 201) throw new Error(`setup failed: ${status} ${JSON.stringify(body)}`);
  return body;
}

export function login(ip = '192.0.2.10', password = PASSWORD, username = USERNAME): Promise<Response> {
  return api('POST', '/v1/auth/login', { ip, body: { username, password, device: DEVICE } });
}

export async function loginOk(ip = '192.0.2.10', password = PASSWORD): Promise<SignedIn> {
  const res = await login(ip, password);
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as SignedIn;
}

/** A new agent key, made from a signed-in device with the current password. */
export async function makeAgent(
  token: string,
  role: AgentRole,
  name: string = role.replace(':', '-'),
): Promise<string> {
  const { status, body } = await apiJson<NewAgentResponse>('POST', '/v1/auth/agents', {
    token,
    body: { name, role, current_password: PASSWORD },
  });
  if (status !== 201) throw new Error(`agent failed: ${status} ${JSON.stringify(body)}`);
  return body.token;
}

export const auth = () => authObject(env);
export const core = () => coreObject(env);

export interface Rows {
  read: number;
  written: number;
}

/** Rows the object read and wrote while `fn` ran, from its own meter. */
export async function rowsDuring(stub: DurableObjectStub<Auth> | DurableObjectStub<Core>, fn: () => Promise<unknown>) {
  const meter = () =>
    runInDurableObject(stub as DurableObjectStub<Auth>, (o: Auth) => ({ r: o.meter.rowsRead, w: o.meter.rowsWritten }));
  const before = await meter();
  await fn();
  const after = await meter();
  return { read: after.r - before.r, written: after.w - before.w } satisfies Rows;
}

/** Runs SQL inside the Auth object, for inspecting or ageing rows. */
export function authSql<T = Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]): Promise<T[]> {
  return runInDurableObject(auth(), (_o: Auth, state) => state.storage.sql.exec(query, ...bindings).toArray() as T[]);
}

export function coreSql<T = Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]): Promise<T[]> {
  return runInDurableObject(
    core() as unknown as DurableObjectStub<Auth>,
    (_o, state) => state.storage.sql.exec(query, ...bindings).toArray() as T[],
  );
}

/** Moves every back-off counter `ms` into the past, as if that much time had gone by. */
export async function ageCounters(ms: number): Promise<void> {
  await authSql(
    'UPDATE throttle SET window_start = window_start - ?, last_at = last_at - ?, next_allowed_at = next_allowed_at - ?',
    ms,
    ms,
    ms,
  );
}

export function counter(prefix: string) {
  return authSql<{ key: string; fails: number; next_allowed_at: number }>(
    'SELECT key, fails, next_allowed_at FROM throttle WHERE key LIKE ?',
    `${prefix}%`,
  );
}

/** Calls a flow function directly inside the Auth object with test dependencies. */
export function inAuth<T>(fn: (o: Auth, state: DurableObjectState) => T | Promise<T>): Promise<T> {
  return runInDurableObject(auth(), fn);
}
