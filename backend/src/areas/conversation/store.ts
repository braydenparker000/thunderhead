// SQL for the conversation inside Core: threads, messages, their FTS index and hand-out to the
// mind (DATA.md §4.2). The FTS table uses external content, so every write to `messages.body`
// writes `messages_fts` in the same transaction (no triggers: migrations stay plain). Stores
// never write the change feed; the caller's commit does (objects/commit.ts).
import type { JsonObject, Message, MessageKind, Thread } from '../../../../shared/contract/api';
import type { Db } from '../../objects/base';

type MessageRow = Omit<Message, 'meta' | 'attachments'> & { meta_json: string | null; attachments_json: string | null };

const THREAD_COLS =
  'id, day, kind, status, title, title_source, summary, continues, message_count, started_at, updated_at, filed_at';
const MSG_COLS =
  'seq, id, thread_id, author, origin, kind, body, meta_json, attachments_json, reply_to, created_at, delivered_at, acked_at, answered_at';

export function toMessage(r: MessageRow): Message {
  const { meta_json, attachments_json, ...rest } = r;
  return {
    ...rest,
    meta: meta_json ? JSON.parse(meta_json) : null,
    attachments: attachments_json ? JSON.parse(attachments_json) : [],
  };
}

export function thread(db: Db, id: string): Thread | null {
  return db.one<Thread>(`SELECT ${THREAD_COLS} FROM threads WHERE id = ?`, id);
}

export function dailyThread(db: Db, day: string): Thread | null {
  return db.one<Thread>(`SELECT ${THREAD_COLS} FROM threads WHERE kind = 'daily' AND day = ?`, day);
}

/** The open daily thread for `day`, made on the day's first message (the owner never makes one). */
export function ensureDaily(db: Db, id: string, day: string, at: number): Thread {
  const found = dailyThread(db, day);
  if (found) return found;
  db.run(
    `INSERT INTO threads (id, day, kind, status, started_at, updated_at, message_count) VALUES (?, ?, 'daily', 'open', ?, ?, 0)`,
    id,
    day,
    at,
    at,
  );
  return thread(db, id) as Thread;
}

/** Newest `updated_at` first; `after` is the previous page's last [updated_at, id]. */
export function threadsPage(db: Db, status: string | null, limit: number, after: [number, string] | null): Thread[] {
  return db.all<Thread>(
    `SELECT ${THREAD_COLS} FROM threads WHERE (? IS NULL OR status = ?)
       AND (? IS NULL OR updated_at < ? OR (updated_at = ? AND id < ?))
     ORDER BY updated_at DESC, id DESC LIMIT ?`,
    status,
    status,
    after?.[0] ?? null,
    after?.[0] ?? null,
    after?.[0] ?? null,
    after?.[1] ?? null,
    limit,
  );
}

export function patchThread(db: Db, id: string, title: string | undefined, summary: string | undefined, at: number) {
  db.run(
    `UPDATE threads SET title = coalesce(?, title), title_source = CASE WHEN ? IS NULL THEN title_source ELSE 'mind' END,
       summary = coalesce(?, summary), updated_at = ? WHERE id = ?`,
    title ?? null,
    title ?? null,
    summary ?? null,
    at,
    id,
  );
}

/** The roll's provisional title, only where none exists. */
export function autoTitle(db: Db, id: string, title: string): void {
  db.run(`UPDATE threads SET title = ?, title_source = 'auto' WHERE id = ? AND title IS NULL`, title, id);
}

export function linkContinues(db: Db, todayId: string, filedId: string, at: number): void {
  db.run('UPDATE threads SET continues = ?, updated_at = ? WHERE id = ?', filedId, at, todayId);
}

/** Files the open daily threads of days before `day` (the roll). Returns how many. */
export function fileBefore(db: Db, day: string, at: number): number {
  return db.all(
    `UPDATE threads SET status = 'filed', filed_at = ?, updated_at = ? WHERE kind = 'daily' AND status = 'open' AND day < ? RETURNING id`,
    at,
    at,
    day,
  ).length;
}

export interface NewMessage {
  id: string;
  thread_id: string;
  author: Message['author'];
  origin: Message['origin'];
  kind: MessageKind;
  body: string;
  meta: JsonObject | null;
  reply_to: string | null;
  created_at: number;
  device_id: string | null;
  session_id: string | null;
  req_sha256: string;
}

export function messageById(
  db: Db,
  id: string,
): (Message & { req_sha256: string | null; session_id: string | null }) | null {
  const r = db.one<MessageRow & { req_sha256: string | null; session_id: string | null }>(
    `SELECT ${MSG_COLS}, req_sha256, session_id FROM messages WHERE id = ?`,
    id,
  );
  return r ? { ...toMessage(r), req_sha256: r.req_sha256, session_id: r.session_id } : null;
}

/** Who wrote a message and through what: what memory's provenance rules read (MEMORY.md §6). */
export function messageOrigin(db: Db, id: string): Pick<Message, 'author' | 'origin' | 'kind'> | null {
  return db.one('SELECT author, origin, kind FROM messages WHERE id = ?', id);
}

export function insertMessage(db: Db, m: NewMessage): Message {
  db.run(
    `INSERT INTO messages (id, thread_id, created_at, author, origin, kind, body, reply_to, meta_json, attachments_json,
       device_id, session_id, req_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    m.id,
    m.thread_id,
    m.created_at,
    m.author,
    m.origin,
    m.kind,
    m.body,
    m.reply_to,
    m.meta ? JSON.stringify(m.meta) : null,
    m.device_id,
    m.session_id,
    m.req_sha256,
  );
  // last_insert_rowid() reads no rows (RETURNING would bill one).
  const row = db.one<{ seq: number }>('SELECT last_insert_rowid() AS seq') as { seq: number };
  db.run('INSERT INTO messages_fts (rowid, body) VALUES (?, ?)', row.seq, m.body);
  db.run(
    'UPDATE threads SET message_count = message_count + 1, updated_at = ? WHERE id = ?',
    m.created_at,
    m.thread_id,
  );
  return messageById(db, m.id) as Message;
}

export function patchMessage(
  db: Db,
  seq: number,
  oldBody: string,
  body: string | undefined,
  meta: unknown,
  at: number,
) {
  if (body !== undefined && body !== oldBody) {
    db.run("INSERT INTO messages_fts (messages_fts, rowid, body) VALUES ('delete', ?, ?)", seq, oldBody);
    db.run('INSERT INTO messages_fts (rowid, body) VALUES (?, ?)', seq, body);
  }
  db.run(
    'UPDATE messages SET body = coalesce(?, body), meta_json = CASE WHEN ? IS NULL THEN meta_json ELSE ? END WHERE seq = ?',
    body ?? null,
    meta === undefined ? null : 1,
    meta === undefined ? null : JSON.stringify(meta),
    seq,
  );
  db.run(`UPDATE threads SET updated_at = ? WHERE id = (SELECT thread_id FROM messages WHERE seq = ?)`, at, seq);
}

/** The last `limit` messages of a thread, oldest first. */
export function lastMessages(db: Db, threadId: string, limit: number): Message[] {
  return db
    .all<MessageRow>(`SELECT ${MSG_COLS} FROM messages WHERE thread_id = ? ORDER BY seq DESC LIMIT ?`, threadId, limit)
    .reverse()
    .map(toMessage);
}

/** A page of one thread: before `before` (newest first) or after `after` (oldest first). */
export function messagesPage(db: Db, threadId: string, before: number | null, after: number | null, limit: number) {
  const rows =
    after !== null
      ? db.all<MessageRow>(
          `SELECT ${MSG_COLS} FROM messages WHERE thread_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
          threadId,
          after,
          limit,
        )
      : db.all<MessageRow>(
          `SELECT ${MSG_COLS} FROM messages WHERE thread_id = ? AND (? IS NULL OR seq < ?) ORDER BY seq DESC LIMIT ?`,
          threadId,
          before,
          before,
          limit,
        );
  return rows.map(toMessage);
}

/** Owner messages not yet answered, oldest first (the briefing's "Waiting"). */
export function unanswered(db: Db, limit: number): Message[] {
  return db
    .all<MessageRow>(
      `SELECT ${MSG_COLS} FROM messages WHERE author = 'owner' AND answered_at IS NULL ORDER BY seq LIMIT ?`,
      limit,
    )
    .map(toMessage);
}

/** Marks owner messages handed out (shown in a claimed briefing counts as handed out). */
export function markDelivered(db: Db, ids: string[], at: number): void {
  if (ids.length)
    db.run(`UPDATE messages SET delivered_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`, at, ...ids);
}

/** Handed-out owner messages never acknowledged within `ms`: their hand-out is undone, so the
 * next wait or session gets them again (RUNTIME.md §4.5). Returns how many. */
export function requeueUnacked(db: Db, now: number, ms: number): number {
  return db.run(
    `UPDATE messages SET delivered_at = NULL WHERE author = 'owner' AND answered_at IS NULL AND acked_at IS NULL
       AND delivered_at IS NOT NULL AND delivered_at < ?`,
    now - ms,
  );
}

/** When the newest message was written (by seq, so one row is read). */
export function lastMessageAt(db: Db): number | null {
  return db.one<{ at: number }>('SELECT created_at AS at FROM messages ORDER BY seq DESC LIMIT 1')?.at ?? null;
}

/** The newest system message with `meta.line` = `line`, for the once-an-hour rule. Reads only
 * system messages (the `messages_system` index), newest first. */
export function lastSystemLine(db: Db, line: string): number | null {
  return (
    db.one<{ at: number }>(
      `SELECT created_at AS at FROM messages WHERE author = 'system' AND json_extract(meta_json, '$.line') = ?
       ORDER BY seq DESC LIMIT 1`,
      line,
    )?.at ?? null
  );
}

/** Owner messages that still need answering (acknowledged or not), ids only, oldest first. */
export function unansweredIds(db: Db): string[] {
  return db
    .all<{ id: string }>(`SELECT id FROM messages WHERE author = 'owner' AND answered_at IS NULL ORDER BY seq LIMIT 50`)
    .map((r) => r.id);
}

/** Hands out owner messages to a waiting mind: new ones, and handed-out ones never acknowledged
 * within `requeueMs` (RUNTIME.md §4.5). Sets `delivered_at`. */
export function takeOwnerMessages(db: Db, now: number, requeueMs: number, limit: number): Message[] {
  const rows = db.all<MessageRow>(
    `SELECT ${MSG_COLS} FROM messages WHERE author = 'owner' AND acked_at IS NULL AND answered_at IS NULL
       AND (delivered_at IS NULL OR delivered_at < ?) ORDER BY seq LIMIT ?`,
    now - requeueMs,
    limit,
  );
  if (rows.length)
    db.run(
      `UPDATE messages SET delivered_at = ? WHERE seq IN (${rows.map(() => '?').join(',')})`,
      now,
      ...rows.map((r) => r.seq),
    );
  return rows.map((r) => toMessage({ ...r, delivered_at: now }));
}

/** Handed-out owner messages count as acknowledged once the chat mind works or posts (one chat
 * session holds the lease, so whatever was handed out was handed to it). */
export function ackHandedOut(db: Db, at: number): number {
  return db.run(
    `UPDATE messages SET acked_at = ? WHERE author = 'owner' AND answered_at IS NULL AND acked_at IS NULL
       AND delivered_at IS NOT NULL`,
    at,
  );
}

/** Marks the replied-to owner message and every earlier unanswered one answered: the chat is one
 * conversation, so a reply to a later message has seen the earlier ones (API.md §11.7 rule 3). */
export function answer(db: Db, replyTo: string, at: number): void {
  db.run(
    `UPDATE messages SET answered_at = ?, acked_at = coalesce(acked_at, ?) WHERE author = 'owner'
       AND answered_at IS NULL AND seq <= (SELECT seq FROM messages WHERE id = ?)`,
    at,
    at,
    replyTo,
  );
}

/** The oldest owner message handed out and still unacknowledged (for the requeue alarm). */
export function oldestUnacked(db: Db): number | null {
  return (
    db.one<{ at: number | null }>(
      `SELECT min(delivered_at) AS at FROM messages WHERE author = 'owner' AND delivered_at IS NOT NULL AND acked_at IS NULL AND answered_at IS NULL`,
    )?.at ?? null
  );
}
