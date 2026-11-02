// Session notes (DATA.md §4.1, MEMORY.md §1): the mind's short note at the end of a session, read
// by the next briefing ("Today so far") and by the night shift for the day it works on. A note
// written by a tainted session (`tainted`, MEMORY.md §7: after the night's songs or evals, or the
// chat's web) could carry outside text in the mind's own words, so neither reader gets its words:
// they read a line saying one was left out, and the next clean session stays clean.
import type { MindRole } from '../../../../shared/contract/api';
import type { Db } from '../../objects/base';

export function note(
  db: Db,
  id: string,
): { body: string; open_items_json: string; session_id: string | null; tainted: number } | null {
  return db.one('SELECT body, open_items_json, session_id, tainted FROM session_notes WHERE id = ?', id);
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
    tainted: boolean;
  },
): void {
  db.run(
    `INSERT INTO session_notes (id, session_id, wake_id, role, thread_id, created_at, body, open_items_json, tainted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    n.id,
    n.session_id,
    n.wake_id,
    n.role,
    n.thread_id,
    n.at,
    n.body,
    n.open,
    n.tainted ? 1 : 0,
  );
}

/** What a reader gets of a note written after outside text. */
export const LEFT_OUT = '(Left out: written by a session that had read outside text.)';
/** Its words, or the line above for a tainted note; its open items likewise. */
const WORDS = `CASE WHEN tainted = 1 THEN '${LEFT_OUT}' ELSE body END AS body,
  CASE WHEN tainted = 1 THEN '[]' ELSE open_items_json END AS open_items_json`;

export interface NoteRow {
  id: string;
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
    `SELECT id, role, thread_id, created_at, ${WORDS} FROM session_notes
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
  return db.one(`SELECT ${WORDS}, created_at FROM session_notes ORDER BY created_at DESC LIMIT 1`);
}

/** A purged conversation's session notes (conversation/purge.ts): the mind's own words about it go
 * with it. A scan (no index on `thread_id`; a few hundred notes are kept), once per purged thread. */
export function deleteThreadNotes(db: Db, threadId: string): number {
  return db.run('DELETE FROM session_notes WHERE thread_id = ?', threadId);
}
