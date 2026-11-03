// The `messages` search source (MEMORY.md §10): FTS5 over message bodies, bm25-ranked, with a
// snippet that marks the match in «». The Worker's federated search (areas/search) calls it
// through Core and fuses its ranking with any other source. Held conversations are never found
// (held.ts): one off the record has no FTS entry at all, and a deleted one's messages are left out
// here until the purge takes their entries (held-store.ts `heldIds`: none, nothing more to check).
import type { Db } from '../../objects/base';
import { heldIds } from './held-store';

/** FTS5 search over message bodies (MEMORY.md §10): bm25, a ≤ 200-character snippet with «». */
export function searchMessages(
  db: Db,
  match: string,
  since: number | null,
  until: number | null,
  threadId: string | null,
  limit: number,
) {
  const held = heldIds(db);
  return db.all<{
    seq: number;
    id: string;
    thread_id: string;
    created_at: number;
    snippet: string;
    score: number;
    author: string;
    origin: string;
  }>(
    `SELECT m.seq, m.id, m.thread_id, m.created_at, snippet(messages_fts, 0, '«', '»', '…', 24) AS snippet,
       bm25(messages_fts) AS score, m.author, m.origin
     FROM messages_fts JOIN messages m ON m.seq = messages_fts.rowid
     WHERE messages_fts MATCH ? AND (? IS NULL OR m.created_at >= ?) AND (? IS NULL OR m.created_at < ?)
       AND (? IS NULL OR m.thread_id = ?) ${held.length ? 'AND m.thread_id NOT IN (SELECT value FROM json_each(?))' : ''}
     ORDER BY score LIMIT ?`,
    match,
    since,
    since,
    until,
    until,
    threadId,
    threadId,
    ...(held.length ? [JSON.stringify(held)] : []),
    limit,
  );
}
