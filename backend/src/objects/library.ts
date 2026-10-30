// The Library object (STUDY.md §1.1, DATA.md §6.3): Study's books, their pages with each page's text,
// blocks and full-text index, the verse references found in them, the owner's highlights and notes,
// the last reading place per book, and the ingestion runs. The PDFs themselves live in the private
// bucket (`books/<id>.pdf`), uploaded as R2 multipart uploads in parts the Worker streams straight
// to the bucket. The class shipped alone (migration tag v4); P7 step 1b gives it its routes, its
// daily pass and its place in the weekly backup and the export.
import type {
  Book,
  BookCreateRequest,
  Highlight,
  IngestClaim,
  IngestUpdate,
  LibrarySearchResponse,
  PageIn,
  Position,
} from '../../../shared/contract/library.ts';
import { LIBRARY_LIMITS as L } from '../../../shared/contract/library.ts';
import type { BackupOf } from '../areas/backups/ops';
import { page, type Row } from '../areas/backups/rows';
import * as ops from '../areas/library/ops';
import { search } from '../areas/library/search';
import * as store from '../areas/library/store';
import { uuidv7 } from '../lib/ids';
import { attempt, attemptAsync, Fail, type Out } from '../lib/result';
import { DAY, utcDay } from '../lib/time';
import { OwnerObject } from './base';
import { LIBRARY_MIGRATIONS } from './library.migrations';

/** The one instance: the owner's (STUDY.md §1; shardable as `library:<shelf>` later). */
export const LIBRARY_INSTANCE = 'owner';

export function libraryObject(env: Env): DurableObjectStub<Library> {
  return env.LIBRARY.getByName(LIBRARY_INSTANCE);
}

/** In the weekly backup and "download everything" (DATA.md §10); the FTS index is rebuilt instead. */
export const LIBRARY_BACKUP = ['books', 'pages', 'verse_refs', 'highlights', 'positions', 'ingest_jobs'] as const;
export const LIBRARY_EXPORT = ['books', 'pages', 'verse_refs', 'highlights', 'positions'] as const;

const STEP = 2_000;

export class Library extends OwnerObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, LIBRARY_MIGRATIONS);
  }

  private tx<T>(fn: () => T): Out<T> {
    return attempt(() => this.ctx.storage.transactionSync(fn));
  }

  private get vault(): R2Bucket {
    return this.env.VAULT;
  }

  books(): Book[] {
    return store.books(this.db).map((b) => ops.toBook(this.db, b));
  }

  /** The files of whole books (their upload finished), for signed links. */
  files(ids: string[]): { id: string; key: string }[] {
    return ids.flatMap((id) => {
      const b = store.book(this.db, id);
      return b && b.state !== 'uploading' ? [{ id, key: b.r2_key }] : [];
    });
  }

  book(id: string): Book | null {
    const b = store.book(this.db, id);
    return b ? ops.toBook(this.db, b) : null;
  }

  /** A new book and its multipart upload; the same request again is the same book. */
  createBook(r: BookCreateRequest, now = Date.now()): Promise<Out<{ book: Book; created: boolean }>> {
    return attemptAsync(async () => {
      const had = store.book(this.db, r.id);
      if (had) {
        if (!ops.sameRequest(had, r)) throw new Fail('conflict');
        return { book: ops.toBook(this.db, had), created: false };
      }
      const up = await this.vault.createMultipartUpload(store.bookKey(r.id), {
        httpMetadata: { contentType: 'application/pdf' },
      });
      // Another request may have made it while the bucket answered.
      const now2 = store.book(this.db, r.id);
      if (now2) {
        await up.abort().catch(() => undefined);
        if (!ops.sameRequest(now2, r)) throw new Fail('conflict');
        return { book: ops.toBook(this.db, now2), created: false };
      }
      ops.newBook(this.db, r, up.uploadId, now);
      return { book: this.book(r.id) as Book, created: true };
    });
  }

  uploadTarget(id: string, n: number): Out<{ key: string; upload_id: string; size: number }> {
    return attempt(() => ops.uploadTarget(this.db, id, n));
  }

  partDone(id: string, n: number, etag: string, now = Date.now()): Out<number[]> {
    return this.tx(() => ops.partDone(this.db, id, n, etag, now));
  }

  /** All parts in: the multipart upload completes into `books/<id>.pdf`, and the book waits for the
   * mind. Again after that, the book as it is. */
  complete(id: string, now = Date.now()): Promise<Out<Book>> {
    return attemptAsync(async () => {
      const b0 = ops.bookOrFail(this.db, id);
      if (b0.state !== 'uploading') return ops.toBook(this.db, b0);
      const { b, parts } = ops.readyParts(this.db, id);
      const up = this.vault.resumeMultipartUpload(b.r2_key, b.upload_id as string);
      const obj = await up.complete(parts.map((p) => ({ partNumber: p.n, etag: p.etag })));
      if (obj.size !== b.bytes) throw new Fail('conflict', { reason: 'the file is not the size given' });
      const out = this.tx(() => {
        if (ops.bookOrFail(this.db, id).state === 'uploading') ops.stored(this.db, id, uuidv7(now), now);
      });
      if (!out.ok) throw new Fail(out.code, out.details);
      return this.book(id) as Book;
    });
  }

  edit(
    id: string,
    f: { title?: string; author?: string | null; kind?: Book['kind']; language?: string },
    now = Date.now(),
  ): Out<Book> {
    return this.tx(() => {
      ops.bookOrFail(this.db, id);
      store.editBook(this.db, id, f, now);
      return ops.toBook(this.db, ops.bookOrFail(this.db, id));
    });
  }

  retry(id: string, now = Date.now()): Out<Book> {
    return this.tx(() => {
      ops.retry(this.db, id, uuidv7(now), now);
      return ops.toBook(this.db, ops.bookOrFail(this.db, id));
    });
  }

  putPosition(bookId: string, p: Position): Out<Position> {
    return this.tx(() => ops.putPosition(this.db, bookId, p));
  }

  putHighlight(h: Highlight): Out<{ highlight: Highlight; applied: boolean }> {
    return this.tx(() => ops.putHighlight(this.db, h));
  }

  highlights(bookId: string): Highlight[] {
    return store.highlightsOf(this.db, bookId);
  }

  search(match: string, bookId: string | null, limit: number, offset: number): LibrarySearchResponse {
    const items = search(this.db, match, bookId, limit + 1, offset);
    const more = items.length > limit;
    return {
      items: items.slice(0, limit),
      next: more ? `o${offset + limit}` : null,
      not_ready: store.notReady(this.db),
    };
  }

  // --- the mind's ingestion runs (STUDY.md §3.3) ------------------------------------------------

  claim(by: string, now = Date.now()): Out<IngestClaim | null> {
    return this.tx(() => {
      ops.release(this.db, now, Date.parse(`${utcDay(now)}T00:00:00Z`));
      return ops.claim(this.db, by, null, now);
    });
  }

  /** The file's key, for the run's holder only. */
  jobFile(jobId: string, by: string, now = Date.now()): Out<string> {
    return attempt(() => ops.bookOrFail(this.db, ops.held(this.db, jobId, by, now).book_id).r2_key);
  }

  putPages(bookId: string, jobId: string, by: string, pages: PageIn[], now = Date.now()) {
    return this.tx(() => {
      const before = this.meter.rowsWritten;
      const r = ops.putPages(this.db, bookId, ops.held(this.db, jobId, by, now), pages, now);
      return { ...r, rows: this.meter.rowsWritten - before };
    });
  }

  updateJob(jobId: string, by: string, u: IngestUpdate, now = Date.now()): Out<Book> {
    return this.tx(() => {
      const j = ops.held(this.db, jobId, by, now);
      ops.update(this.db, j, u, now);
      return ops.toBook(this.db, ops.bookOrFail(this.db, j.book_id));
    });
  }

  /** Core's tick: uploads unfinished after a day are aborted and their record removed (it never
   * held a file), lapsed claims and paused runs wait again, deleted highlights go after 30 days,
   * finished runs after 90. */
  async daily(now = Date.now()): Promise<{ aborted: number; released: number; purged: number }> {
    let aborted = 0;
    for (const b of store.staleUploads(this.db, now - L.upload_ms)) {
      if (b.upload_id)
        await this.vault
          .resumeMultipartUpload(b.r2_key, b.upload_id)
          .abort()
          .catch(() => undefined);
      this.ctx.storage.transactionSync(() => store.deleteUpload(this.db, b.id));
      aborted++;
    }
    const out = this.tx(() => {
      const released = ops.release(this.db, now, Date.parse(`${utcDay(now)}T00:00:00Z`));
      const purged =
        store.purgeHighlights(this.db, now - L.deleted_highlight_days * DAY, STEP) +
        store.pruneJobs(this.db, now - L.ingest_days * DAY, STEP);
      return { released, purged };
    });
    if (!out.ok) throw new Error(out.code);
    return { aborted, ...out.value };
  }

  /** What the weekly backup of this object needs when it starts (areas/backups). */
  async backupOf(): Promise<BackupOf> {
    const bookmark = await this.ctx.storage.getCurrentBookmark().catch(() => null);
    return { tables: [...LIBRARY_BACKUP], schema_version: this.migration, bookmark };
  }

  /** One page of a table in key order, for the backup and the export. */
  page(table: string, after: unknown[] | null, limit: number): { rows: Row[]; last: unknown[] | null } {
    if (!(LIBRARY_BACKUP as readonly string[]).includes(table)) throw new Error('not a Library table');
    return page(this.db, table, after, limit);
  }
}
