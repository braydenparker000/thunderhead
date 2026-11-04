// Facts and day notes for the recall index (MEMORY.md §10.6, areas/search/embed-job.ts): current
// facts only (a superseded version is passed over, a forgotten one is gone) in `seq` order, and day
// notes in the order they were last written, so a rewritten note is indexed again; and, for the
// recall, which indexed ones still stand. Labelled as their FTS hits are (store.ts, notes.ts).
import type { Provenance } from '../../../../shared/contract/memory.ts';
import type { Db } from '../../objects/base';
import { provenanceOf } from './store';

export interface FactToEmbed {
  seq: number;
  id: string;
  text: string;
  recorded_at: number;
  provenance: Provenance;
}

export function factsAfter(db: Db, after: number, limit: number): FactToEmbed[] {
  return db
    .all<Omit<FactToEmbed, 'provenance'> & { source: string; provenance: Provenance | null }>(
      `SELECT seq, id, text, recorded_at, source, provenance FROM facts
       WHERE seq > ? AND superseded_at IS NULL ORDER BY seq LIMIT ?`,
      after,
      limit,
    )
    .map(({ source, provenance, ...f }) => ({ ...f, provenance: provenanceOf({ source, provenance }) }));
}

export interface NoteToEmbed {
  day: string;
  summary: string;
  written_at: number;
  provenance: Provenance;
}

/** Day notes written after `[written_at, day]`, in that order (a note is one row a day). */
export function notesAfter(db: Db, after: [number, string], limit: number): NoteToEmbed[] {
  return db.all<NoteToEmbed>(
    `SELECT day, summary, written_at, coalesce(provenance, 'owner') AS provenance FROM day_notes
     WHERE (written_at, day) > (?, ?) ORDER BY written_at, day LIMIT ?`,
    after[0],
    after[1],
    limit,
  );
}

/** One placeholder a value (the recall asks about at most 50). */
const marks = (xs: unknown[]) => xs.map(() => '?').join(', ');

/** Which of these fact ids are still current. */
export function liveFacts(db: Db, ids: string[]): Set<string> {
  if (!ids.length) return new Set();
  const rows = db.all<{ id: string }>(
    `SELECT id FROM facts WHERE id IN (${marks(ids)}) AND superseded_at IS NULL`,
    ...ids,
  );
  return new Set(rows.map((r) => r.id));
}

/** Which of these days still have a note. */
export function liveNotes(db: Db, days: string[]): Set<string> {
  if (!days.length) return new Set();
  const rows = db.all<{ day: string }>(`SELECT day FROM day_notes WHERE day IN (${marks(days)})`, ...days);
  return new Set(rows.map((r) => r.day));
}
