// Helpers for the held-conversation suites (off the record, Delete, Restore, the purge): calls as
// the phone and the mind make them, the cron's tick at a chosen time (the purge's fake clock), and
// a file attached to a message. Everything is synthetic.
import { runInDurableObject } from 'cloudflare:test';
import type { Message, Thread } from '../../shared/contract/api';
import { uuidv7 } from '../src/lib/ids';
import type { Core } from '../src/objects/core';
import { bytesOf, uploaded } from './files-helpers';
import { apiJson, core, coreSql } from './helpers';
import { CHAT_SESSION } from './memory-helpers';

export const DAY_MS = 86_400_000;
export const stub = () => core() as unknown as DurableObjectStub<Core>;
/** The cron's tick as of `now`: the prune pass decides what is due by this clock. */
export const tick = (now: number) => runInDurableObject(stub(), (o: Core) => o.tick(now));
export const chat = (token: string, session = CHAT_SESSION) => ({ token, headers: { 'TH-Session': session } });

/** The phone starts a conversation off the record under its own id. */
export async function offRecord(D: string, id = uuidv7()): Promise<Thread> {
  const r = await apiJson<Thread>('PUT', `/v1/threads/${id}/off-record`, { token: D });
  if (r.status !== 201) throw new Error(`off the record failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

export type Said = Message & { error?: { code: string; details?: unknown } };

/** A message, into a named thread when `thread` is given. */
export function say(
  call: { token: string; headers?: Record<string, string> },
  body: string,
  extra: Record<string, unknown> = {},
  id = uuidv7(),
) {
  return apiJson<Said>('PUT', `/v1/messages/${id}`, { ...call, body: { body, ...extra } });
}

/** A file uploaded by the device, for an owner message to take: its `file:<id>` ref. */
export const fileOf = (D: string, text = 'a synthetic note') =>
  uploaded({ token: D, bytes: bytesOf(text), type: 'text/plain', name: 'note.txt' });

/** The thread's row as stored, or undefined once purged. */
export async function threadRow(id: string) {
  const [r] = await coreSql<{
    kind: string;
    purge_at: number | null;
    deleted_at: number | null;
    kind_was: string | null;
  }>('SELECT kind, purge_at, deleted_at, kind_was FROM threads WHERE id = ?', id);
  return r;
}

/** FTS hits for a word, straight from the index (what any search could ever find). */
export async function ftsHits(word: string): Promise<number> {
  const rows = await coreSql<{ n: number }>(
    `SELECT count(*) AS n FROM messages_fts WHERE messages_fts MATCH ?`,
    `"${word}"`,
  );
  return rows[0]?.n ?? 0;
}
