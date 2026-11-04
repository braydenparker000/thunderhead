// The owner's current fact under one subject and kind (memory's SQL, split off store.ts): the pace
// Study keeps to (`study.pace`, a goal), which `study.pace_goal` replaces rather than adds beside.
import type { Db } from '../../objects/base';

/** The newest current, unexpired fact of `kind` under `subject` (the `facts_current` index). */
export function currentOf(db: Db, kind: string, subject: string, now: number): { id: string; text: string } | null {
  return db.one<{ id: string; text: string }>(
    `SELECT id, text FROM facts WHERE superseded_at IS NULL AND kind = ? AND subject = ?
       AND (valid_to IS NULL OR valid_to > ?) ORDER BY recorded_at DESC LIMIT 1`,
    kind,
    subject,
    now,
  );
}
