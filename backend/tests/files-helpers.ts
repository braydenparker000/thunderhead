// Helpers for the chat files suites: raw-byte uploads through the Worker's real fetch handler (or
// through the app with an env of the test's own, for a missing bucket or a fake AI binding), and
// synthetic bytes. Nothing here is real: the names, the "photos" and the memo's words are made up.
import { createExecutionContext } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import type { Attachment, Issue } from '../../shared/contract/api';
import { app } from '../src/app';
import { uuidv7 } from '../src/lib/ids';

export const bytesOf = (text: string) => new TextEncoder().encode(text);

export async function shaOf(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Upload {
  token: string;
  bytes: Uint8Array;
  id?: string;
  /** Content-Type; left out when null. */
  type?: string | null;
  /** Sent URL-encoded; `raw` sends it as given; null leaves the header out. */
  name?: string | null;
  raw?: string;
  sha?: string;
  seconds?: string;
  headers?: Record<string, string>;
}

export async function fileRequest(u: Upload): Promise<{ id: string; request: Request }> {
  const id = u.id ?? uuidv7();
  const headers = new Headers({ Authorization: `Bearer ${u.token}`, 'CF-Connecting-IP': '192.0.2.40', ...u.headers });
  if (u.type !== null) headers.set('Content-Type', u.type ?? 'image/jpeg');
  if (u.raw !== undefined) headers.set('TH-File-Name', u.raw);
  else if (u.name !== null) headers.set('TH-File-Name', encodeURIComponent(u.name ?? 'synthetic photo.jpg'));
  headers.set('TH-Sha256', u.sha ?? (await shaOf(u.bytes)));
  if (u.seconds !== undefined) headers.set('TH-Seconds', u.seconds);
  const request = new Request(`https://api.example.test/v1/files/${id}`, { method: 'PUT', headers, body: u.bytes });
  return { id, request };
}

/** PUT /v1/files/:id; `env` runs the app with that env instead of the test's. */
export async function upload(u: Upload, env?: Env) {
  const { id, request } = await fileRequest(u);
  const res = env ? await app.fetch(request, env, createExecutionContext()) : await exports.default.fetch(request);
  const text = await res.text();
  const body = (text ? JSON.parse(text) : null) as Attachment & { error: { code: string; details?: Issue[] } };
  return { id, status: res.status, body, res };
}

/** An upload that must succeed; returns its ref. */
export async function uploaded(u: Upload, env?: Env): Promise<string> {
  const r = await upload(u, env);
  if (r.status !== 201) throw new Error(`upload failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.ref;
}

/** GET /v1/files/:id as `token`. */
export function download(token: string, id: string, headers: Record<string, string> = {}, env?: Env) {
  const request = new Request(`https://api.example.test/v1/files/${id}`, {
    headers: { Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '192.0.2.40', ...headers },
  });
  return env ? app.fetch(request, env, createExecutionContext()) : exports.default.fetch(request);
}
