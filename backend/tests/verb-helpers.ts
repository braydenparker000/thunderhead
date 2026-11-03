// Helpers for the verb suites (verbs-worker*.test.ts): queue a verb as the chat mind, set the owner's
// settings, undo a ledger row as the owner, read a row back, and check a Worker-side verb was done at
// once. They use the proposal suites' principals (proposal-helpers.ts `setup`). Everything is synthetic.
import { expect } from 'vitest';
import type {
  ErrorBody,
  LedgerEntry,
  Permit,
  PermitRefusal,
  Settings,
  UndoResponse,
  Verb,
} from '../../shared/contract/api';
import { uuidv7 } from '../src/lib/ids';
import { apiJson } from './helpers';
import { chat, P } from './proposal-helpers';

export type Out = Verb & { permit?: Permit } & ErrorBody;

export const SONG = (n: number) => `music:r2_song${String(n).padStart(8, '0')}`;
export const FEED = 'https://feeds.example.test/show.xml';

export const verb = (name: string, args: object, over: object = {}, call = chat()) =>
  apiJson<Out>('PUT', `/v1/verbs/${uuidv7()}`, {
    ...call,
    body: { verb: name, schema: 1, args, why: 'the owner asked for it just now', ...over },
  });
export const settle = (body: Record<string, unknown>) => apiJson('PATCH', '/v1/settings', { token: P.D, body });
export const settings = async () => (await apiJson<Settings>('GET', '/v1/settings', { token: P.D })).body;
export const undo = (id: string | null, token = P.D) =>
  apiJson<UndoResponse & ErrorBody>('POST', `/v1/ledger/${id}/undo`, { token, body: {} });
export const ledgerRow = async (id: string | null) =>
  (await apiJson<{ items: LedgerEntry[] }>('GET', '/v1/ledger?limit=100', { token: P.D })).body.items.find(
    (r) => r.id === id,
  );
export const refusal = (b: ErrorBody) => b.error.details as PermitRefusal;

/** Done at once: the answer is the finished verb, and no phone is asked for it. */
export async function doneNow(r: { status: number; body: Out }) {
  expect([r.status, r.body.status], JSON.stringify(r.body)).toEqual([201, 'done']);
  const open = (await apiJson<{ items: Verb[] }>('GET', '/v1/verbs/pending', { token: P.D })).body.items;
  expect(open.some((v) => v.id === r.body.id)).toBe(false);
  return r.body;
}
