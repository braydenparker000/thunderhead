// A thread's title and its link to the day it continues (the conversation's store, split off to
// keep each file short): the mind's titles, the owner's name for a thread, the roll's provisional
// title; and one owner message the Worker itself answers (an `@muse`). All SQL, as in store.ts.
import type { Db } from '../../objects/base';

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

/** The owner's name for a thread (`title_source` 'owner'), or none (null clears it for the mind). */
export function ownerTitle(db: Db, id: string, title: string | null, at: number): void {
  db.run(
    'UPDATE threads SET title = ?, title_source = ?, updated_at = ? WHERE id = ?',
    title,
    title ? 'owner' : null,
    at,
    id,
  );
}

/** The roll's provisional title, only where none exists. */
export function autoTitle(db: Db, id: string, title: string): void {
  db.run(`UPDATE threads SET title = ?, title_source = 'auto' WHERE id = ? AND title IS NULL`, title, id);
}

/** The topic the menu files a thread under (thread.file), or none; whether a thread was there. */
export function setTopic(db: Db, id: string, topic: string | null, at: number): boolean {
  return db.all('UPDATE threads SET topic = ?, updated_at = ? WHERE id = ? RETURNING 1', topic, at, id).length > 0;
}

export function linkContinues(db: Db, todayId: string, filedId: string, at: number): void {
  db.run('UPDATE threads SET continues = ?, updated_at = ? WHERE id = ?', filedId, at, todayId);
}

/** Settles one owner message and no other: the Worker's own answer to an `@muse` (work/lines.ts),
 * which is no reply from the mind, so what the owner said before it still waits for one. */
export function answerOne(db: Db, id: string, at: number): void {
  db.run(
    `UPDATE messages SET answered_at = ?, acked_at = coalesce(acked_at, ?) WHERE id = ? AND author = 'owner'
       AND answered_at IS NULL`,
    at,
    at,
    id,
  );
}
