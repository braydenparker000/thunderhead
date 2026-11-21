// The stemmed index (schema step 4, STUDY.md §6): `pages_stem`, the same pages as `pages_fts` with
// Porter stemming and accents removed, so "prayers" finds "prayer" and "oracion" finds "oración".
// Kept in step by the page writer like `pages_fts`, except for the pages that were stored before the
// step ran: those go in by `stem_fill`, oldest first, a chunk each daily pass while the rows guard
// allows. Until the last of them is in, search reads `pages_fts` (search.ts).
import type { Db } from '../../objects/base';

/** Pages put in the stemmed index by one daily pass (a page's FTS entry writes a few rows). */
export const FILL_STEP = 1000;

interface Fill {
  after: number;
  until: number;
}
const fillOf = (db: Db): Fill =>
  db.one<Fill>('SELECT after, until FROM stem_fill WHERE id = 1') ?? { after: 0, until: 0 };

/** Every page is in the stemmed index. */
export const stemmed = (db: Db): boolean => {
  const f = fillOf(db);
  return f.after >= f.until;
};

/** Whether the page at `seq` has its entry in the stemmed index (one the backfill hasn't reached has none). */
const has = (f: Fill, seq: number) => seq > f.until || seq <= f.after;

/** A page's stemmed entry after its text changed (`old`: what was stored before, if anything). A
 * page the backfill hasn't reached yet is left to it, so it is never entered twice. */
export function restem(db: Db, old: { seq: number; text: string } | null, seq: number, text: string): void {
  const f = fillOf(db);
  if (!has(f, seq)) return;
  if (old) db.run("INSERT INTO pages_stem (pages_stem, rowid, text) VALUES ('delete', ?, ?)", old.seq, old.text);
  db.run('INSERT INTO pages_stem (rowid, text) VALUES (?, ?)', seq, text);
}

/** One chunk of the backfill, in the caller's transaction; pages entered. */
export function fill(db: Db, limit = FILL_STEP): number {
  const f = fillOf(db);
  if (f.after >= f.until) return 0;
  const rows = db.all<{ seq: number; text: string }>(
    'SELECT seq, text FROM pages WHERE seq > ? AND seq <= ? ORDER BY seq LIMIT ?',
    f.after,
    f.until,
    limit,
  );
  for (const r of rows) db.run('INSERT INTO pages_stem (rowid, text) VALUES (?, ?)', r.seq, r.text);
  db.run('UPDATE stem_fill SET after = ? WHERE id = 1', rows.length < limit ? f.until : rows[rows.length - 1].seq);
  return rows.length;
}
