// The old rows as new ones (MIGRATION.md §4): I1 `cc_threads` → filed `imported` threads, with the
// day of their start in the owner's zone and their original title; I2 `cc_messages` → messages
// with origin `import`, the body unchanged, the owner's as `owner` and Claude's as `mind`; I3 the
// notebook row of `cc_state` → one raw `import_items` document for the mind to convert. Ids are
// deterministic (lib/ids.ts `importedId`), so the same old row maps to the same new id on every
// run. A row that can't be imported is a skip with its reason, never an error.
import type { ImportSkipReason, JsonObject, MessageKind } from '../../../../shared/contract/api';
import { importedId } from '../../lib/ids';
import { logicalDay } from '../conversation/day';
import type { ImportedMessage, ImportedThread } from '../conversation/imported';

type Old = Record<string, unknown>;
export type Mapped<T> = { old_id: string; row: T; files?: boolean } | { old_id: string; skip: ImportSkipReason };
export interface NotebookItem {
  id: string;
  key: string;
  body: string;
}
/** The creation times of the export's importable threads and messages, by old id: what a message
 * needs to name its thread and the message it replies to by their new ids. */
export interface Refs {
  threads: Map<string, number>;
  messages: Map<string, number>;
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const ms = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);
const KINDS: readonly MessageKind[] = ['text', 'voice', 'progress', 'card', 'question', 'error'];

/** An old thread's id and creation time, or null when it can't be imported. */
export function threadKey(o: Old): [id: string, created: number] | null {
  const id = str(o.id);
  const created = ms(o.created_ms);
  return id && created !== null ? [id, created] : null;
}

export async function mapThread(o: Old, tz: string): Promise<Mapped<ImportedThread>> {
  const key = threadKey(o);
  if (!key) return { old_id: str(o.id) ?? String(o.__rowid__), skip: 'empty' };
  const [id, created] = key;
  const title = str(o.title)?.trim() || null;
  return {
    old_id: id,
    row: {
      id: await importedId('threads', id, created),
      day: logicalDay(created, tz),
      title,
      started_at: created,
      filed_at: ms(o.updated_ms) ?? created,
    },
  };
}

function meta(v: unknown): JsonObject | null {
  if (typeof v !== 'string' || !v) return null;
  try {
    const m = JSON.parse(v) as unknown;
    return m && typeof m === 'object' && !Array.isArray(m) ? (m as JsonObject) : null;
  } catch {
    return null;
  }
}

/** Why an old message can't be imported (nothing in it, not the owner's or Claude's, or in a
 * thread the export lacks), or null. */
export function messageSkip(o: Old, threads: Refs['threads']): ImportSkipReason | null {
  if (!str(o.id) || ms(o.created_ms) === null || (!(str(o.body) ?? '').trim() && !meta(o.meta))) return 'empty';
  if (o.role !== 'owner' && o.role !== 'claude') return 'dropped';
  const thread = str(o.thread_id);
  return thread && threads.has(thread) ? null : 'invalid_ref';
}

export async function mapMessage(o: Old, refs: Refs): Promise<Mapped<ImportedMessage>> {
  const skip = messageSkip(o, refs.threads);
  if (skip) return { old_id: str(o.id) ?? String(o.__rowid__), skip };
  const id = o.id as string;
  const created = o.created_ms as number;
  const body = str(o.body) ?? '';
  const m = meta(o.meta);
  const author = o.role === 'owner' ? 'owner' : 'mind';
  const threadOld = o.thread_id as string;
  const threadAt = refs.threads.get(threadOld) as number;
  const replyOld = str(o.reply_to);
  const replyAt = replyOld ? refs.messages.get(replyOld) : undefined;
  const files = typeof o.attachments === 'string' && o.attachments !== '[]' && o.attachments !== '';
  return {
    old_id: id,
    files,
    row: {
      id: await importedId('messages', id, created),
      thread_id: await importedId('threads', threadOld, threadAt),
      created_at: created,
      author,
      kind: KINDS.includes(o.kind as MessageKind) ? (o.kind as MessageKind) : 'text',
      body,
      // A reply to a message the export doesn't have, or that is skipped, keeps the message
      // without the link, so no reply points at nothing.
      reply_to: replyOld && replyAt !== undefined ? await importedId('messages', replyOld, replyAt) : null,
      meta: m,
      delivered_at: ms(o.delivered_ms),
      answered_at: ms(o.answered_ms),
    },
  };
}

/** `cc_state`: the notebook is kept; the lease, the last wake and the error inbox are dropped. */
export async function mapNotebook(o: Old, runStarted: number): Promise<Mapped<NotebookItem>> {
  const key = str(o.key) ?? String(o.__rowid__);
  if (key !== 'notebook') return { old_id: key, skip: 'dropped' };
  const value = str(o.value);
  if (!value) return { old_id: key, skip: 'empty' };
  let at = runStarted;
  try {
    const v = JSON.parse(value) as { updatedAt?: unknown };
    at = ms(v?.updatedAt) ?? ms(Date.parse(String(v?.updatedAt))) ?? runStarted;
  } catch {
    return { old_id: key, skip: 'empty' };
  }
  return { old_id: key, row: { id: await importedId('notebook', key, at), key, body: value } };
}
