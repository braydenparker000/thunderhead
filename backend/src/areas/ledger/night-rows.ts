// What the night's report reads of the ledger (BRIEFING.md "The report card"): the rows a line's
// `ledger:` ref names (each must be the night's own), whether each can still be undone (the
// Briefing tile's Undo), and the counts of the night's rows since its run began.
import type { Db } from '../../objects/base';

export interface RowState {
  id: string;
  actor: string;
  status: 'done' | 'undone' | 'failed';
  undoable: boolean;
}

/** The rows by id (a primary-key read each); ids not found are left out. */
export function rowStates(db: Db, ids: string[]): RowState[] {
  if (!ids.length) return [];
  return db
    .all<Omit<RowState, 'undoable'> & { undoable: number }>(
      `SELECT id, actor, status, undoable FROM ledger WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ...ids,
    )
    .map((r) => ({ ...r, undoable: r.undoable === 1 }));
}

/** How many of each `what` the night's sessions wrote since `since` (a refired session's rows
 * count with the first's; rows that failed are left out). Reads the rows since then (`ledger_at`). */
export function nightWhats(db: Db, since: number): Map<string, number> {
  const rows = db.all<{ what: string; n: number }>(
    `SELECT what, count(*) AS n FROM ledger WHERE at >= ? AND actor = 'mind:night' AND status <> 'failed'
       GROUP BY what`,
    since,
  );
  return new Map(rows.map((r) => [r.what, r.n]));
}
