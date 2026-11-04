// Messages for the recall index (MEMORY.md §10.6, areas/search/embed-job.ts): the owner's and the
// mind's words, in `seq` order, never a system line, a Muse line or a held conversation (off the
// record or deleted, held.ts); and, for the recall, which indexed messages still stand. The index
// itself lives in the Library object; this area only answers by its own tables.
import type { Db } from '../../objects/base';
import { heldIds } from './held-store';

export interface MessageToEmbed {
  seq: number;
  id: string;
  thread_id: string;
  created_at: number;
  author: string;
  origin: string;
  body: string;
}

const KINDS = "('text', 'voice', 'question')";

/** Up to `limit` messages after `after` (seq) worth indexing: on the primary key, the held few left out. */
export function messagesAfter(db: Db, after: number, limit: number): MessageToEmbed[] {
  const held = heldIds(db);
  return db.all<MessageToEmbed>(
    `SELECT seq, id, thread_id, created_at, author, origin, body FROM messages
     WHERE seq > ? AND author IN ('owner', 'mind') AND kind IN ${KINDS} AND length(trim(body)) > 0
       ${held.length ? 'AND thread_id NOT IN (SELECT value FROM json_each(?))' : ''}
     ORDER BY seq LIMIT ?`,
    after,
    ...(held.length ? [JSON.stringify(held)] : []),
    limit,
  );
}

/** Where to start on a first run: the newest `keep` messages (by seq), so a long history starts at
 * its recent end rather than its oldest. */
export function messagesStart(db: Db, keep: number): number {
  const top = db.one<{ seq: number | null }>('SELECT max(seq) AS seq FROM messages')?.seq ?? 0;
  return Math.max(0, top - keep);
}

/** Which of these message ids still stand (present, by the owner or the mind, not held), with
 * each one's thread. */
export function liveMessages(db: Db, ids: string[]): Map<string, string> {
  if (!ids.length) return new Map();
  const held = new Set(heldIds(db));
  const rows = db.all<{ id: string; thread_id: string }>(
    `SELECT id, thread_id FROM messages WHERE id IN (SELECT value FROM json_each(?)) AND author IN ('owner', 'mind')`,
    JSON.stringify(ids),
  );
  return new Map(rows.filter((r) => !held.has(r.thread_id)).map((r) => [r.id, r.thread_id]));
}
