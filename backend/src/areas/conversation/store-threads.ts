// A thread's title and its link to the day it continues (the conversation's store, split off to
// keep each file short): the mind's titles, the owner's name for a thread, the roll's provisional
// title. All SQL, as in store.ts.
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

export function linkContinues(db: Db, todayId: string, filedId: string, at: number): void {
  db.run('UPDATE threads SET continues = ?, updated_at = ? WHERE id = ?', filedId, at, todayId);
}
