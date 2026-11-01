// SQL for held conversations (held.ts: off the record and deleted; schema step 27). A thread is
// held exactly while its `purge_at` is set, so `threads_purge` (partial, `purge_at IS NOT NULL`)
// lists only held threads: every query that leaves them out reads those few rows, never the table.
// Stores never write the change feed or the ledger; the caller's commit does (objects/commit.ts).

import type { DeletedThread } from '../../../../shared/contract/held.ts';
import type { Db } from '../../objects/base';

/** The held threads' ids, on `threads_purge` (a row each; none read when there are none). A query
 * that leaves them out adds `NOT IN` only when there are some: workerd bills each row's `NOT IN`
 * check as a row read, so the usual day, with none held, costs nothing more. */
export function heldIds(db: Db): string[] {
  return db.all<{ id: string }>('SELECT id FROM threads WHERE purge_at IS NOT NULL').map((r) => r.id);
}

/** A condition and its bindings, for rows/backups `page`. */
export interface Keep {
  sql: string;
  args: unknown[];
}

/** What backups and "download everything" leave out (backups/job.ts, export-job.ts): held threads,
 * their messages, and their messages' files (a file row keeps its name and a memo's words). So no
 * backup ever holds a conversation off the record, and none taken after a delete holds that one. */
export function heldRows(db: Db, table: string): Keep | undefined {
  if (table === 'threads') return { sql: 'purge_at IS NULL', args: [] };
  if (table !== 'messages' && table !== 'files') return undefined;
  const ids = heldIds(db);
  if (!ids.length) return undefined;
  const held = 'SELECT value FROM json_each(?)';
  return table === 'messages'
    ? { sql: `thread_id NOT IN (${held})`, args: [JSON.stringify(ids)] }
    : {
        sql: `message_id IS NULL OR message_id NOT IN (SELECT id FROM messages WHERE thread_id IN (${held}))`,
        args: [JSON.stringify(ids)],
      };
}

export interface HeldRow {
  id: string;
  day: string;
  kind: string;
  status: string;
  purge_at: number | null;
  deleted_at: number | null;
  kind_was: string | null;
}

export function heldRow(db: Db, id: string): HeldRow | null {
  return db.one<HeldRow>('SELECT id, day, kind, status, purge_at, deleted_at, kind_was FROM threads WHERE id = ?', id);
}

/** A message's thread as the held rules need it: two rows read (the message, its thread). */
export function messageThread(db: Db, messageId: string): HeldRow | null {
  return db.one<HeldRow>(
    `SELECT t.id, t.day, t.kind, t.status, t.purge_at, t.deleted_at, t.kind_was FROM messages m
       JOIN threads t ON t.id = m.thread_id WHERE m.id = ?`,
    messageId,
  );
}

/** A new conversation off the record, purged `purgeAt` unless a message moves it on. */
export function insertOffRecord(db: Db, id: string, day: string, at: number, purgeAt: number): void {
  db.run(
    `INSERT INTO threads (id, day, kind, status, started_at, updated_at, message_count, purge_at)
     VALUES (?, ?, 'off_record', 'open', ?, ?, 0, ?)`,
    id,
    day,
    at,
    at,
    purgeAt,
  );
}

/** Each message moves an off-the-record thread's purge to 7 days after it. */
export function movePurge(db: Db, id: string, purgeAt: number): void {
  db.run(`UPDATE threads SET purge_at = ? WHERE id = ? AND kind = 'off_record'`, purgeAt, id);
}

/** Delete: the thread takes kind 'deleted' (so it leaves the day's one `daily` slot and a fresh
 * today can start), its own kind kept for Restore. */
export function markDeleted(db: Db, id: string, at: number, purgeAt: number): number {
  return db.run(
    `UPDATE threads SET kind_was = kind, kind = 'deleted', deleted_at = ?, purge_at = ?, updated_at = ?
     WHERE id = ? AND kind != 'deleted'`,
    at,
    purgeAt,
    at,
    id,
  );
}

/** Its owner messages still waiting count as settled: a deleted conversation is never handed to
 * the mind, nor shown in its briefing as waiting. Reads the waiting index, not the thread. */
export function settleWaiting(db: Db, threadId: string, at: number): number {
  return db.run(
    `UPDATE messages SET answered_at = ?, acked_at = coalesce(acked_at, ?)
     WHERE author = 'owner' AND answered_at IS NULL AND thread_id = ?`,
    at,
    at,
    threadId,
  );
}

/** Restore: its kind back (or `restored` beside a newer daily thread of its day), the purge moved
 * to what it was before (null, or an off-the-record thread's own 7 days). */
export function markRestored(
  db: Db,
  id: string,
  r: { kind: string; status: string; filed_at: number | null; purge_at: number | null; at: number },
): void {
  db.run(
    `UPDATE threads SET kind = ?, kind_was = NULL, deleted_at = NULL, purge_at = ?, status = ?,
       filed_at = coalesce(filed_at, ?), updated_at = ? WHERE id = ? AND kind = 'deleted'`,
    r.kind,
    r.purge_at,
    r.status,
    r.filed_at,
    r.at,
    id,
  );
}

/** Settings › Recently deleted: newest first, on `threads_deleted`. */
export function deletedPage(db: Db, now: number, limit: number): DeletedThread[] {
  return db.all<DeletedThread>(
    `SELECT id, day, kind_was AS kind, title, summary, message_count, deleted_at, purge_at FROM threads
     WHERE deleted_at IS NOT NULL AND kind = 'deleted' AND purge_at > ? ORDER BY deleted_at DESC LIMIT ?`,
    now,
    limit,
  );
}

/** Off-the-record threads among `ids` that are still live (one lookup each). */
export function offRecordAmong(db: Db, ids: string[], now: number): string[] {
  return ids.filter(
    (id) =>
      db.one(`SELECT 1 AS x FROM threads WHERE id = ? AND kind = 'off_record' AND purge_at > ?`, id, now) !== null,
  );
}

/** When the newest conversation off the record last spoke (its purge less 7 days), for the roll's
 * quiet hour: talking off the record is talking. One row on `threads_purge`, newest first. */
export function newestOffRecordPurge(db: Db): number | null {
  return (
    db.one<{ at: number }>(
      `SELECT purge_at AS at FROM threads WHERE purge_at IS NOT NULL AND kind = 'off_record'
       ORDER BY purge_at DESC LIMIT 1`,
    )?.at ?? null
  );
}

// --- the purge (purge.ts) ----------------------------------------------------------------------

export interface DueRow {
  id: string;
  kind: string;
  kind_was: string | null;
  purge_at: number;
}

/** Held threads whose purge is due, the oldest due first, on `threads_purge`. */
export function due(db: Db, now: number, limit: number): DueRow[] {
  return db.all<DueRow>(
    `SELECT id, kind, kind_was, purge_at FROM threads WHERE purge_at IS NOT NULL AND purge_at <= ?
     ORDER BY purge_at LIMIT ?`,
    now,
    limit,
  );
}

export interface PurgeMessage {
  seq: number;
  id: string;
  body: string;
  attachments_json: string | null;
}

/** The thread's first `limit` messages, on `messages_thread_seq`. */
export function firstMessages(db: Db, threadId: string, limit: number): PurgeMessage[] {
  return db.all<PurgeMessage>(
    'SELECT seq, id, body, attachments_json FROM messages WHERE thread_id = ? ORDER BY seq LIMIT ?',
    threadId,
    limit,
  );
}

/** Deletes messages, and their FTS entries when they were indexed (an off-the-record message never
 * is: an FTS5 'delete' must name exactly what was inserted). Returns rows written. */
export function deleteMessages(db: Db, rows: PurgeMessage[], indexed: boolean): number {
  let n = 0;
  for (const r of rows) {
    if (indexed)
      n += db.run("INSERT INTO messages_fts (messages_fts, rowid, body) VALUES ('delete', ?, ?)", r.seq, r.body);
    n += db.run('DELETE FROM messages WHERE seq = ?', r.seq);
  }
  return n;
}

/** Whether the thread has any message left (one row at most). */
export const hasMessages = (db: Db, threadId: string): boolean =>
  db.one('SELECT 1 AS x FROM messages WHERE thread_id = ? LIMIT 1', threadId) !== null;

export function deleteThread(db: Db, id: string): number {
  return db.run('DELETE FROM threads WHERE id = ? AND purge_at IS NOT NULL', id);
}

/** A plain FTS5 delete only marks the words; `optimize` rewrites the index so they leave its
 * segments too (as memory's forget does, MEMORY.md §3). Once per purged indexed thread. */
export function optimizeFts(db: Db): number {
  return db.run(`INSERT INTO messages_fts (messages_fts) VALUES ('optimize')`);
}
