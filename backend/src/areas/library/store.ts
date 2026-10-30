// The Library object's rows (STUDY.md §1.1): books, pages with their full-text entries (written in
// the same transaction, no triggers), verse references, highlights, positions and ingestion runs.
// Every query is by key or by an index; none scans a growing table on a request.
import type { Book, BookState, Highlight, PageIn, Position } from '../../../../shared/contract/library.ts';
import type { Db } from '../../objects/base';

export interface BookRow {
  id: string;
  title: string;
  author: string | null;
  kind: Book['kind'];
  language: string;
  bytes: number;
  pdf_pages: number | null;
  sha256: string | null;
  r2_key: string;
  state: BookState;
  state_reason: string | null;
  added_at: number;
  updated_at: number;
  ingested_at: number | null;
  duplicate_of: string | null;
  upload_id: string | null;
  parts_json: string | null;
}
export interface JobRow {
  id: string;
  book_id: string;
  state: 'queued' | 'claimed' | 'paused' | 'done' | 'failed';
  cursor: number;
  attempts: number;
  last_error: string | null;
  claimed_by: string | null;
  claimed_at: number | null;
  updated_at: number;
}
export type Part = { n: number; etag: string };

export const bookKey = (id: string) => `books/${id}.pdf`;
export const partsOf = (b: BookRow): Part[] => (b.parts_json ? (JSON.parse(b.parts_json) as Part[]) : []);

export const book = (db: Db, id: string) => db.one<BookRow>('SELECT * FROM books WHERE id = ?', id);
/** Every book (a library holds hundreds at most), newest first. */
export const books = (db: Db) => db.all<BookRow>('SELECT * FROM books ORDER BY added_at DESC, id');

export function insertBook(
  db: Db,
  b: Omit<BookRow, 'pdf_pages' | 'sha256' | 'state_reason' | 'ingested_at' | 'duplicate_of'>,
) {
  db.run(
    `INSERT INTO books (id, title, author, kind, language, bytes, r2_key, state, added_at, updated_at, upload_id, parts_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    b.id,
    b.title,
    b.author,
    b.kind,
    b.language,
    b.bytes,
    b.r2_key,
    b.state,
    b.added_at,
    b.updated_at,
    b.upload_id,
    b.parts_json,
  );
}

export function setParts(db: Db, id: string, parts: Part[], at: number) {
  db.run('UPDATE books SET parts_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(parts), at, id);
}

export function setState(
  db: Db,
  id: string,
  state: BookState,
  at: number,
  more: { reason?: string | null; pdf_pages?: number; sha256?: string; duplicate_of?: string; ingested?: boolean } = {},
) {
  db.run(
    `UPDATE books SET state = ?, state_reason = ?, updated_at = ?,
       pdf_pages = coalesce(?, pdf_pages), sha256 = coalesce(?, sha256), duplicate_of = coalesce(?, duplicate_of),
       ingested_at = CASE WHEN ? THEN ? ELSE ingested_at END,
       upload_id = CASE WHEN ? = 'uploading' THEN upload_id ELSE NULL END,
       parts_json = CASE WHEN ? = 'uploading' THEN parts_json ELSE NULL END
     WHERE id = ?`,
    state,
    more.reason ?? null,
    at,
    more.pdf_pages ?? null,
    more.sha256 ?? null,
    more.duplicate_of ?? null,
    more.ingested ? 1 : 0,
    at,
    state,
    state,
    id,
  );
}

export function editBook(
  db: Db,
  id: string,
  f: Partial<Pick<BookRow, 'title' | 'author' | 'kind' | 'language'>>,
  at: number,
) {
  db.run(
    `UPDATE books SET title = coalesce(?, title), author = CASE WHEN ? THEN ? ELSE author END,
       kind = coalesce(?, kind), language = coalesce(?, language), updated_at = ? WHERE id = ?`,
    f.title ?? null,
    f.author !== undefined ? 1 : 0,
    f.author ?? null,
    f.kind ?? null,
    f.language ?? null,
    at,
    id,
  );
}

/** An upload that never finished: its record, and any place or note made on it meanwhile. */
export function deleteUpload(db: Db, id: string) {
  db.run('DELETE FROM positions WHERE book_id = ?', id);
  db.run('DELETE FROM highlights WHERE book_id = ?', id);
  db.run("DELETE FROM books WHERE id = ? AND state = 'uploading'", id);
}
/** Uploads started before `before` and never finished. */
export const staleUploads = (db: Db, before: number) =>
  db.all<BookRow>("SELECT * FROM books WHERE state = 'uploading' AND added_at < ? LIMIT 20", before);
/** Another book with the same file. */
export const sameFile = (db: Db, sha: string, id: string) =>
  db.one<{ id: string }>("SELECT id FROM books WHERE sha256 = ? AND id != ? AND state != 'duplicate' LIMIT 1", sha, id);
export const notReady = (db: Db) =>
  db.one<{ n: number }>("SELECT count(*) AS n FROM books WHERE state NOT IN ('ready', 'duplicate', 'uploading')")?.n ??
  0;

// --- positions --------------------------------------------------------------------------------

export const position = (db: Db, bookId: string) =>
  db.one<Position>('SELECT pdf_page, scroll_frac, at, device FROM positions WHERE book_id = ?', bookId);
export const positions = (db: Db) =>
  db.all<Position & { book_id: string }>('SELECT book_id, pdf_page, scroll_frac, at, device FROM positions');
export function putPosition(db: Db, bookId: string, p: Position) {
  db.run(
    `INSERT INTO positions (book_id, pdf_page, scroll_frac, at, device) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (book_id) DO UPDATE SET pdf_page = excluded.pdf_page, scroll_frac = excluded.scroll_frac,
       at = excluded.at, device = excluded.device`,
    bookId,
    p.pdf_page,
    p.scroll_frac,
    p.at,
    p.device,
  );
}

// --- highlights -------------------------------------------------------------------------------

interface HighlightRow extends Omit<Highlight, 'rects'> {
  rects_json: string | null;
}
const toHighlight = ({ rects_json, ...h }: HighlightRow): Highlight => ({
  ...h,
  rects: rects_json ? (JSON.parse(rects_json) as Highlight['rects']) : null,
});
export const highlight = (db: Db, id: string) => {
  const r = db.one<HighlightRow>('SELECT * FROM highlights WHERE id = ?', id);
  return r ? toHighlight(r) : null;
};
export const highlightsOf = (db: Db, bookId: string) =>
  db
    .all<HighlightRow>('SELECT * FROM highlights WHERE book_id = ? ORDER BY pdf_page, created_at', bookId)
    .map(toHighlight);
export function putHighlight(db: Db, h: Highlight) {
  db.run(
    `INSERT INTO highlights (id, book_id, pdf_page, quote, prefix, suffix, rects_json, color, note, ref, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET pdf_page = excluded.pdf_page, quote = excluded.quote, prefix = excluded.prefix,
       suffix = excluded.suffix, rects_json = excluded.rects_json, color = excluded.color, note = excluded.note,
       ref = excluded.ref, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`,
    h.id,
    h.book_id,
    h.pdf_page,
    h.quote,
    h.prefix,
    h.suffix,
    h.rects ? JSON.stringify(h.rects) : null,
    h.color,
    h.note,
    h.ref,
    h.created_at,
    h.updated_at,
    h.deleted_at,
  );
}
export const purgeHighlights = (db: Db, before: number, limit: number) =>
  db.run(
    'DELETE FROM highlights WHERE id IN (SELECT id FROM highlights WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT ?)',
    before,
    limit,
  );

// --- ingestion runs ---------------------------------------------------------------------------

export const job = (db: Db, id: string) => db.one<JobRow>('SELECT * FROM ingest_jobs WHERE id = ?', id);
/** The book's run that isn't finished, if any. */
export const openJobOf = (db: Db, bookId: string) =>
  db.one<JobRow>(
    "SELECT * FROM ingest_jobs WHERE book_id = ? AND state IN ('queued', 'claimed', 'paused') LIMIT 1",
    bookId,
  );
export const nextQueued = (db: Db) =>
  db.one<JobRow>("SELECT * FROM ingest_jobs WHERE state = 'queued' ORDER BY updated_at, id LIMIT 1");
export function insertJob(db: Db, id: string, bookId: string, at: number) {
  db.run("INSERT INTO ingest_jobs (id, book_id, state, updated_at) VALUES (?, ?, 'queued', ?)", id, bookId, at);
}
export function updateJob(db: Db, j: JobRow) {
  db.run(
    `UPDATE ingest_jobs SET state = ?, cursor = ?, attempts = ?, last_error = ?, claimed_by = ?, claimed_at = ?, updated_at = ?
     WHERE id = ?`,
    j.state,
    j.cursor,
    j.attempts,
    j.last_error,
    j.claimed_by,
    j.claimed_at,
    j.updated_at,
    j.id,
  );
}
/** Claims whose lease ran out, and paused runs: waiting again. */
export const lapsed = (db: Db, claimedBefore: number) =>
  db.all<JobRow>(
    "SELECT * FROM ingest_jobs WHERE (state = 'claimed' AND claimed_at < ?) OR state = 'paused' LIMIT 20",
    claimedBefore,
  );
export const pruneJobs = (db: Db, before: number, limit: number) =>
  db.run(
    "DELETE FROM ingest_jobs WHERE id IN (SELECT id FROM ingest_jobs WHERE state IN ('done', 'failed') AND updated_at < ? LIMIT ?)",
    before,
    limit,
  );

// --- pages ------------------------------------------------------------------------------------

/** One page in place of the one stored at its number, with its full-text entry and its refs. */
export function putPage(db: Db, bookId: string, p: PageIn): number {
  const old = db.one<{ seq: number; text: string }>(
    'SELECT seq, text FROM pages WHERE book_id = ? AND pdf_page = ?',
    bookId,
    p.pdf_page,
  );
  if (old) db.run("INSERT INTO pages_fts (pages_fts, rowid, text) VALUES ('delete', ?, ?)", old.seq, old.text);
  const seq = db.one<{ seq: number }>(
    `INSERT INTO pages (book_id, pdf_page, page_label, text, blocks_json, ocr, ocr_conf, chars)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (book_id, pdf_page) DO UPDATE SET page_label = excluded.page_label, text = excluded.text,
       blocks_json = excluded.blocks_json, ocr = excluded.ocr, ocr_conf = excluded.ocr_conf, chars = excluded.chars
     RETURNING seq`,
    bookId,
    p.pdf_page,
    p.page_label,
    p.text,
    JSON.stringify(p.blocks),
    p.ocr ? 1 : 0,
    p.ocr_conf,
    p.text.length,
  )?.seq;
  db.run('INSERT INTO pages_fts (rowid, text) VALUES (?, ?)', seq, p.text);
  db.run('DELETE FROM verse_refs WHERE book_id = ? AND pdf_page = ?', bookId, p.pdf_page);
  const count = new Map<number, number>();
  for (const r of p.refs) {
    const i = (count.get(r.block) ?? 0) + 1;
    count.set(r.block, i);
    db.run(
      `INSERT INTO verse_refs (book_id, pdf_page, block, i, book_code, chapter, v_start, v_end, weight, in_heading)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      bookId,
      p.pdf_page,
      r.block,
      i,
      r.book_code,
      r.chapter,
      r.v_start,
      r.v_end,
      r.weight,
      r.in_heading ? 1 : 0,
    );
  }
  return p.refs.length;
}
