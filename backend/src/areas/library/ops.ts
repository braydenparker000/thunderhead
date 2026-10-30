// The Library's rules (STUDY.md §3–§5), each run inside one of the object's transactions: a book's
// record and upload parts, its states through ingestion, the newest reading place, the newest
// version of a highlight, and the mind's claimed runs. A broken rule throws `Fail`, which the
// object returns and the route turns into the HTTP error.
import {
  type Book,
  type BookCreateRequest,
  type Highlight,
  type IngestClaim,
  type IngestUpdate,
  LIBRARY_LIMITS as L,
  type PageIn,
  type Position,
} from '../../../../shared/contract/library.ts';
import { Fail } from '../../lib/result';
import type { Db } from '../../objects/base';
import * as store from './store';

export const partsFor = (bytes: number) => Math.max(1, Math.ceil(bytes / L.part_bytes));
/** Part `n`'s exact size: every part but the last is full. */
export const partSize = (bytes: number, n: number) =>
  n < partsFor(bytes) ? L.part_bytes : bytes - (partsFor(bytes) - 1) * L.part_bytes;

export function toBook(db: Db, b: store.BookRow): Book {
  const out: Book = {
    id: b.id,
    title: b.title,
    author: b.author,
    kind: b.kind,
    language: b.language,
    bytes: b.bytes,
    pdf_pages: b.pdf_pages,
    sha256: b.sha256,
    state: b.state,
    state_reason: b.state_reason,
    added_at: b.added_at,
    updated_at: b.updated_at,
    ingested_at: b.ingested_at,
    duplicate_of: b.duplicate_of,
    position: store.position(db, b.id),
  };
  if (b.state === 'uploading') out.parts = store.partsOf(b).map((p) => p.n);
  const job = ['queued', 'extracting', 'ocr', 'indexing'].includes(b.state) ? store.openJobOf(db, b.id) : null;
  if (job) {
    out.read_pages = job.cursor;
    if (job.state === 'paused') out.paused = true;
  }
  return out;
}

export function bookOrFail(db: Db, id: string): store.BookRow {
  const b = store.book(db, id);
  if (!b) throw new Fail('not_found');
  return b;
}

/** The same request again is the same book; other fields under its id are a conflict. */
export function sameRequest(b: store.BookRow, r: BookCreateRequest): boolean {
  return b.bytes === r.bytes && b.title === r.title;
}

export function newBook(db: Db, r: BookCreateRequest, uploadId: string, now: number): void {
  store.insertBook(db, {
    id: r.id,
    title: r.title,
    author: r.author ?? null,
    kind: r.kind ?? 'book',
    language: r.language ?? 'eng',
    bytes: r.bytes,
    r2_key: store.bookKey(r.id),
    state: 'uploading',
    added_at: now,
    updated_at: now,
    upload_id: uploadId,
    parts_json: '[]',
  });
}

/** Where part `n` of an upload goes; refused once the upload is finished. */
export function uploadTarget(db: Db, id: string, n: number): { key: string; upload_id: string; size: number } {
  const b = bookOrFail(db, id);
  if (b.state !== 'uploading' || !b.upload_id) throw new Fail('conflict', { reason: 'the upload is finished' });
  if (n > partsFor(b.bytes)) throw new Fail('validation', [{ path: 'n', issue: `1 to ${partsFor(b.bytes)}` }]);
  return { key: b.r2_key, upload_id: b.upload_id, size: partSize(b.bytes, n) };
}

export function partDone(db: Db, id: string, n: number, etag: string, now: number): number[] {
  const b = bookOrFail(db, id);
  if (b.state !== 'uploading') throw new Fail('conflict', { reason: 'the upload is finished' });
  const parts = [...store.partsOf(b).filter((p) => p.n !== n), { n, etag }].sort((a, c) => a.n - c.n);
  store.setParts(db, id, parts, now);
  return parts.map((p) => p.n);
}

/** The parts to complete with, once all of them are in. */
export function readyParts(db: Db, id: string): { b: store.BookRow; parts: store.Part[] } {
  const b = bookOrFail(db, id);
  const parts = store.partsOf(b);
  const want = partsFor(b.bytes);
  if (parts.length !== want)
    throw new Fail('conflict', { reason: `${parts.length} of ${want} parts received`, parts: parts.map((p) => p.n) });
  return { b, parts };
}

/** The file is whole: it waits for the mind to read it. */
export function stored(db: Db, id: string, jobId: string, now: number): void {
  store.setState(db, id, 'queued', now);
  store.insertJob(db, jobId, id, now);
}

/** Try again after a failure: a new run. */
export function retry(db: Db, id: string, jobId: string, now: number): void {
  const b = bookOrFail(db, id);
  if (b.state !== 'failed') throw new Fail('conflict', { reason: 'only a book that could not be read' });
  stored(db, id, jobId, now);
}

/** The newest place wins (by its own time); an older one changes nothing. */
export function putPosition(db: Db, bookId: string, p: Position): Position {
  bookOrFail(db, bookId);
  const had = store.position(db, bookId);
  if (had && had.at >= p.at) return had;
  store.putPosition(db, bookId, p);
  return p;
}

/** The newest version of a highlight wins (by `updated_at`); its book and page never change. */
export function putHighlight(db: Db, h: Highlight): { highlight: Highlight; applied: boolean } {
  bookOrFail(db, h.book_id);
  const had = store.highlight(db, h.id);
  if (had && had.book_id !== h.book_id) throw new Fail('conflict', { reason: 'a highlight stays in its book' });
  if (had && had.updated_at >= h.updated_at) return { highlight: had, applied: false };
  store.putHighlight(db, { ...h, created_at: had?.created_at ?? h.created_at });
  return { highlight: store.highlight(db, h.id) as Highlight, applied: true };
}

/** The oldest waiting book, leased to `by` for an hour; null when none waits. */
export function claim(db: Db, by: string, jobId: string | null, now: number): IngestClaim | null {
  const j = jobId ? store.job(db, jobId) : store.nextQueued(db);
  if (!j || j.state !== 'queued') return null;
  const b = bookOrFail(db, j.book_id);
  store.updateJob(db, { ...j, state: 'claimed', claimed_by: by, claimed_at: now, updated_at: now });
  if (b.state === 'queued') store.setState(db, b.id, 'extracting', now);
  return {
    job: { id: j.id, book_id: b.id, cursor: j.cursor, attempts: j.attempts, lease_until: now + L.claim_ms },
    book: { id: b.id, bytes: b.bytes, language: b.language, pdf_pages: b.pdf_pages },
  };
}

/** The run, if `by` holds its lease now; the lease is renewed by each call. */
export function held(db: Db, jobId: string, by: string, now: number): store.JobRow {
  const j = store.job(db, jobId);
  if (!j) throw new Fail('not_found');
  if (j.state !== 'claimed' || j.claimed_by !== by || (j.claimed_at ?? 0) + L.claim_ms < now)
    throw new Fail('conflict', { reason: 'claim this run first' });
  return j;
}

export function putPages(db: Db, bookId: string, j: store.JobRow, pages: PageIn[], now: number) {
  if (j.book_id !== bookId) throw new Fail('conflict', { reason: 'this run reads another book' });
  const b = bookOrFail(db, bookId);
  const over = b.pdf_pages !== null ? pages.findIndex((p) => p.pdf_page > (b.pdf_pages as number)) : -1;
  if (over >= 0) throw new Fail('validation', [{ path: `pages.${over}.pdf_page`, issue: 'past the last page' }]);
  let refs = 0;
  for (const p of pages) refs += store.putPage(db, bookId, p);
  const cursor = Math.max(j.cursor, ...pages.map((p) => p.pdf_page));
  store.updateJob(db, { ...j, cursor, claimed_at: now, updated_at: now });
  return { written: pages.length, refs };
}

/** The mind's word on its run: a state while it reads, then ready or failed. A file whose SHA-256
 * another book has is a duplicate, whatever the mind says next. */
export function update(db: Db, j: store.JobRow, u: IngestUpdate, now: number): void {
  const b = bookOrFail(db, j.book_id);
  const cursor = u.cursor ?? j.cursor;
  const sha = u.sha256 ?? b.sha256;
  const same = sha ? store.sameFile(db, sha, b.id) : null;
  if (same) {
    store.setState(db, b.id, 'duplicate', now, { sha256: sha ?? undefined, duplicate_of: same.id });
    store.updateJob(db, { ...j, state: 'done', cursor, updated_at: now });
    return;
  }
  const facts = { pdf_pages: u.pdf_pages, sha256: u.sha256 };
  if (u.state === 'ready') {
    if (!sha || (u.pdf_pages ?? b.pdf_pages) === null)
      throw new Fail('validation', [{ path: 'state', issue: 'ready needs the file’s sha256 and its page count' }]);
    store.setState(db, b.id, 'ready', now, { ...facts, ingested: true });
    store.updateJob(db, { ...j, state: 'done', cursor, updated_at: now });
  } else if (u.state === 'failed') {
    if (!u.reason) throw new Fail('validation', [{ path: 'reason', issue: 'a plain sentence for the owner' }]);
    store.setState(db, b.id, 'failed', now, { ...facts, reason: u.reason });
    store.updateJob(db, { ...j, state: 'failed', cursor, last_error: 'reported', updated_at: now });
  } else if (u.state === 'paused') {
    if (u.pdf_pages || u.sha256) store.setState(db, b.id, b.state, now, facts);
    store.updateJob(db, { ...j, state: 'paused', cursor, claimed_by: null, claimed_at: null, updated_at: now });
  } else {
    store.setState(db, b.id, u.state, now, facts);
    store.updateJob(db, { ...j, cursor, claimed_at: now, updated_at: now });
  }
}

/** Claims past their lease and paused runs (from the next UTC day, when the lane opens again) wait
 * again; a third lapse fails the book. */
export function release(db: Db, now: number, laneDayStart: number): number {
  let n = 0;
  for (const j of store.lapsed(db, now - L.claim_ms)) {
    if (j.state === 'paused' && j.updated_at >= laneDayStart) continue;
    const attempts = j.state === 'claimed' ? j.attempts + 1 : j.attempts;
    if (attempts >= 3) {
      store.updateJob(db, { ...j, state: 'failed', attempts, last_error: 'lease_lapsed', updated_at: now });
      store.setState(db, j.book_id, 'failed', now, { reason: 'Reading this book stopped three times. Try again.' });
    } else
      store.updateJob(db, { ...j, state: 'queued', attempts, claimed_by: null, claimed_at: null, updated_at: now });
    n++;
  }
  return n;
}
