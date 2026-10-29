// The old Chats' conversations, imported (MIGRATION.md §4 I1–I2): threads of kind `imported`, filed,
// and their messages with origin `import`, each put by its deterministic id so a run that finds
// them already there writes nothing. A new message gets its FTS entry, as every message does; an
// imported owner message is answered as of its old answer (or its own time), so none ever waits
// for the mind or is handed out again. A thread keeps the title it was first imported with.
import type { JsonObject, MessageAuthor, MessageKind } from '../../../../shared/contract/api';
import type { Db } from '../../objects/base';

export interface ImportedThread {
  id: string;
  day: string;
  title: string | null;
  started_at: number;
  filed_at: number;
}

/** Puts a thread unless it is there already. Returns rows written (0 when it was). */
export function putThread(db: Db, t: ImportedThread): number {
  return db.run(
    `INSERT INTO threads (id, day, kind, title, title_source, summary, status, continues, started_at, filed_at,
       message_count, updated_at) VALUES (?, ?, 'imported', ?, 'auto', NULL, 'filed', NULL, ?, ?, 0, ?)
     ON CONFLICT (id) DO NOTHING`,
    t.id,
    t.day,
    t.title,
    t.started_at,
    t.filed_at,
    t.filed_at,
  );
}

export function thread(db: Db, id: string): { id: string; day: string; title: string | null; kind: string } | null {
  return db.one('SELECT id, day, title, kind FROM threads WHERE id = ?', id);
}

export interface ImportedMessage {
  id: string;
  thread_id: string;
  created_at: number;
  author: MessageAuthor;
  kind: MessageKind;
  body: string;
  reply_to: string | null;
  meta: JsonObject | null;
  delivered_at: number | null;
  answered_at: number | null;
}

export function message(
  db: Db,
  id: string,
): { seq: number; thread_id: string; body: string; author: string; created_at: number } | null {
  return db.one('SELECT seq, thread_id, body, author, created_at FROM messages WHERE id = ?', id);
}

/** A new message with its FTS entry. Returns rows written. */
export function insertMessage(db: Db, m: ImportedMessage): number {
  const owner = m.author === 'owner';
  let rows = db.run(
    `INSERT INTO messages (id, thread_id, created_at, author, origin, kind, body, reply_to, meta_json, attachments_json,
       delivered_at, acked_at, answered_at, req_sha256) VALUES (?, ?, ?, ?, 'import', ?, ?, ?, ?, NULL, ?, ?, ?, '')`,
    m.id,
    m.thread_id,
    m.created_at,
    m.author,
    m.kind,
    m.body,
    m.reply_to,
    m.meta ? JSON.stringify(m.meta) : null,
    m.delivered_at ?? m.created_at,
    owner ? (m.answered_at ?? m.created_at) : null,
    owner ? (m.answered_at ?? m.created_at) : m.answered_at,
  );
  const seq = (db.one<{ seq: number }>('SELECT last_insert_rowid() AS seq') as { seq: number }).seq;
  rows += db.run('INSERT INTO messages_fts (rowid, body) VALUES (?, ?)', seq, m.body);
  return rows;
}

/** A message the old system amended after an earlier import: the new body, and its FTS entry. */
export function updateBody(db: Db, seq: number, oldBody: string, body: string): number {
  return (
    db.run("INSERT INTO messages_fts (messages_fts, rowid, body) VALUES ('delete', ?, ?)", seq, oldBody) +
    db.run('INSERT INTO messages_fts (rowid, body) VALUES (?, ?)', seq, body) +
    db.run('UPDATE messages SET body = ? WHERE seq = ?', body, seq)
  );
}

export function addMessages(db: Db, threadId: string, n: number): number {
  return db.run('UPDATE threads SET message_count = message_count + ? WHERE id = ?', n, threadId);
}
