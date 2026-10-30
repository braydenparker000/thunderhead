// The Library object (STUDY.md §1.1, DATA.md §6.3): Study's books, their pages with each page's text,
// blocks and full-text index, the verse references found in them, the owner's highlights and notes,
// the last reading place per book, and the ingestion runs. The PDFs themselves live in the private
// bucket (`books/<id>.pdf`). The class ships alone in its own deploy (a Durable Object class change
// cannot be rolled back); its routes come in the next one.
import { type Migration, OwnerObject } from './base';

export const LIBRARY_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'library',
    kind: 'expand',
    sql: [
      // `sha256` is the stored file's, set when the mind first reads it; `upload_id` and `parts_json`
      // hold an R2 multipart upload while its parts arrive.
      `CREATE TABLE books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT,
        kind TEXT NOT NULL,
        language TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        pdf_pages INTEGER,
        sha256 TEXT,
        r2_key TEXT NOT NULL,
        state TEXT NOT NULL,
        state_reason TEXT,
        added_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        ingested_at INTEGER,
        duplicate_of TEXT,
        kept_hint INTEGER NOT NULL DEFAULT 0,
        upload_id TEXT,
        parts_json TEXT
      ) WITHOUT ROWID`,
      // `blocks_json`: [[start, end], …] character offsets into `text`.
      `CREATE TABLE pages (
        seq INTEGER PRIMARY KEY,
        book_id TEXT NOT NULL,
        pdf_page INTEGER NOT NULL,
        page_label TEXT,
        text TEXT NOT NULL,
        blocks_json TEXT NOT NULL,
        ocr INTEGER NOT NULL DEFAULT 0,
        ocr_conf REAL,
        chars INTEGER NOT NULL,
        UNIQUE (book_id, pdf_page)
      )`,
      // Kept in step by the writer in the same transaction (no triggers), as Core's messages_fts.
      `CREATE VIRTUAL TABLE pages_fts USING fts5 (text, content = 'pages', content_rowid = 'seq', tokenize = 'unicode61 remove_diacritics 2')`,
      // One row per reference found in a block (`i` numbers them within it); a chapter reference has
      // no verses. Keyed by its page so a page read again replaces its references.
      `CREATE TABLE verse_refs (
        book_id TEXT NOT NULL,
        pdf_page INTEGER NOT NULL,
        block INTEGER NOT NULL,
        i INTEGER NOT NULL,
        book_code TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        v_start INTEGER,
        v_end INTEGER,
        weight INTEGER NOT NULL,
        in_heading INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (book_id, pdf_page, block, i)
      ) WITHOUT ROWID`,
      'CREATE INDEX verse_refs_chapter ON verse_refs (book_code, chapter)',
      // A page note is a highlight with an empty quote and no rects.
      `CREATE TABLE highlights (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        pdf_page INTEGER NOT NULL,
        quote TEXT NOT NULL,
        prefix TEXT NOT NULL,
        suffix TEXT NOT NULL,
        rects_json TEXT,
        color TEXT NOT NULL,
        note TEXT,
        ref TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      ) WITHOUT ROWID`,
      'CREATE INDEX highlights_book ON highlights (book_id, pdf_page)',
      'CREATE INDEX highlights_ref ON highlights (ref) WHERE ref IS NOT NULL',
      'CREATE INDEX highlights_deleted ON highlights (deleted_at) WHERE deleted_at IS NOT NULL',
      `CREATE TABLE positions (
        book_id TEXT PRIMARY KEY,
        pdf_page INTEGER NOT NULL,
        scroll_frac REAL NOT NULL,
        at INTEGER NOT NULL,
        device TEXT NOT NULL
      ) WITHOUT ROWID`,
      `CREATE TABLE ingest_jobs (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        state TEXT NOT NULL,
        cursor INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        claimed_by TEXT,
        claimed_at INTEGER,
        updated_at INTEGER NOT NULL
      ) WITHOUT ROWID`,
      'CREATE INDEX ingest_jobs_state ON ingest_jobs (state, updated_at)',
    ],
  },
];

/** The one instance: the owner's (STUDY.md §1; shardable as `library:<shelf>` later). */
export const LIBRARY_INSTANCE = 'owner';

export function libraryObject(env: Env): DurableObjectStub<Library> {
  return env.LIBRARY.getByName(LIBRARY_INSTANCE);
}

export class Library extends OwnerObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, LIBRARY_MIGRATIONS);
  }
}
