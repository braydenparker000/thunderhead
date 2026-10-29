// Session notes (DATA.md §4.1, MEMORY.md §1): the mind's short note at the end of a session, read
// by the next briefing ("Today so far") and by the night shift for the day it works on.
import type { MindRole } from '../../../../shared/contract/api';
import type { Db } from '../../objects/base';

export function note(db: Db, id: string): { body: string; open_items_json: string; session_id: string | null } | null {
  return db.one('SELECT body, open_items_json, session_id FROM session_notes WHERE id = ?', id);
}

export function putNote(
  db: Db,
  n: {
    id: string;
    session_id: string | null;
    wake_id: string | null;
    role: MindRole;
    thread_id: string | null;
    at: number;
    body: string;
    open: string;
  },
): void {
  db.run(
    `INSERT INTO session_notes (id, session_id, wake_id, role, thread_id, created_at, body, open_items_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    n.id,
    n.session_id,
    n.wake_id,
    n.role,
    n.thread_id,
    n.at,
    n.body,
    n.open,
  );
}

export interface NoteRow {
  id: string;
  session_id: string | null;
  role: MindRole;
  thread_id: string | null;
  created_at: number;
  body: string;
  open_items_json: string;
}

/** Notes written in [from, to), oldest first, after (`created_at`, `id`) when given: a range on
 * `session_notes_at` (which holds the id), starting at the cursor's own time. */
export function notesBetween(
  db: Db,
  from: number,
  to: number,
  after: [number, string] | null,
  limit: number,
): NoteRow[] {
  const lo = after ? Math.max(from, after[0]) : from;
  return db.all<NoteRow>(
    `SELECT id, session_id, role, thread_id, created_at, body, open_items_json FROM session_notes
     WHERE created_at >= ? AND created_at < ? AND (created_at > ? OR id > ?) ORDER BY created_at, id LIMIT ?`,
    lo,
    to,
    lo,
    after ? after[1] : '',
    limit,
  );
}

export function countNotes(db: Db, from: number, to: number): number {
  return (
    db.one<{ n: number }>('SELECT count(*) AS n FROM session_notes WHERE created_at >= ? AND created_at < ?', from, to)
      ?.n ?? 0
  );
}

export function latestNote(db: Db): { body: string; created_at: number } | null {
  return db.one('SELECT body, created_at FROM session_notes ORDER BY created_at DESC LIMIT 1');
}
