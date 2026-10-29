// Helpers for the memory suites: principals with claimed sessions, owner and mind messages to
// cite, and one-call wrappers for memory ops. Everything is synthetic.
import type { BriefResponse, MemoryOp, MemoryOpsResponse, Message } from '../../shared/contract/api';
import { uuidv7 } from '../src/lib/ids';
import { apiJson, makeAgent, setupOwner } from './helpers';

export interface Principals {
  D: string;
  C: string;
  N: string;
}

export const CHAT_SESSION = 'cse_memory_chat_1';
export const NIGHT_SESSION = 'cse_memory_night_1';
export const SHA = 'a'.repeat(64);

export const as = (token: string, session: string) => ({ token, headers: { 'TH-Session': session } });

export function brief(token: string, session: string, role: 'chat' | 'night', sha = SHA) {
  return apiJson<BriefResponse>('POST', '/v1/mind/brief', {
    ...as(token, session),
    body: { claim: true, session_id: session, role, constitution_sha256: sha, th_version: '0.1.0' },
  });
}

/** The owner, a chat key and a night key, each mind key with a claimed session. */
export async function principals(): Promise<Principals> {
  const D = (await setupOwner()).token;
  const C = await makeAgent(D, 'mind:chat');
  const N = await makeAgent(D, 'mind:night');
  await brief(C, CHAT_SESSION, 'chat');
  await brief(N, NIGHT_SESSION, 'night');
  return { D, C, N };
}

/** An owner message (from the device) to cite as evidence. */
export async function ownerSays(D: string, body: string): Promise<string> {
  const id = uuidv7();
  const r = await apiJson<Message>('PUT', `/v1/messages/${id}`, { token: D, body: { body } });
  if (r.status !== 201) throw new Error(`owner message failed: ${r.status}`);
  return id;
}

/** A mind reply in today's thread. */
export async function mindSays(C: string, body: string): Promise<string> {
  const id = uuidv7();
  const r = await apiJson<Message>('PUT', `/v1/messages/${id}`, { ...as(C, CHAT_SESSION), body: { body } });
  if (r.status !== 201) throw new Error(`mind message failed: ${r.status} ${JSON.stringify(r.body)}`);
  return id;
}

export type OpsResult = MemoryOpsResponse & { error?: { code: string; details?: { path: string; issue: string }[] } };

export function ops(call: { token: string; headers?: Record<string, string> }, list: unknown[], batch = uuidv7()) {
  return apiJson<OpsResult>('POST', '/v1/memory/ops', { ...call, body: { batch_id: batch, ops: list } });
}

export function addOp(evidence: string[], over: Partial<Extract<MemoryOp, { op: 'add' }>> = {}) {
  return {
    op: 'add',
    id: uuidv7(),
    kind: 'preference',
    subject: 'music.evening',
    text: 'Likes calm music in the evening',
    source: 'user',
    evidence,
    sensitivity: 0,
    ...over,
  } as const;
}

/** One op through a principal; the reason of its rejection, or null when it applied. */
export async function reason(call: { token: string; headers?: Record<string, string> }, op: unknown) {
  const r = await ops(call, [op]);
  if (r.status === 200) return r.body.rejected[0]?.reason ?? null;
  return r.body.error?.details?.[0]?.issue ?? r.body.error?.code ?? `http_${r.status}`;
}
