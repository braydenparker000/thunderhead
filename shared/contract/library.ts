// Study's library (STUDY.md, API.md §11.21): the owner's books, uploaded in parts into the private
// bucket, read by the mind in its own session (never in Actions) into pages, blocks, a full-text
// index and verse references, and the owner's highlights, notes and reading places.
import type { Id, Ms } from './api';

export const LIBRARY_LIMITS = {
  /** A book's file (STUDY.md §3.1). */
  book_bytes: 500 * 1024 * 1024,
  /** Each upload part but the last is exactly this size (R2 wants equal parts; the Free plan caps a
   * request body at 100 MB). */
  part_bytes: 50 * 1024 * 1024,
  title_chars: 300,
  author_chars: 200,
  /** Pages a batch from the mind. */
  pages_batch: 50,
  page_chars: 60_000,
  blocks_per_page: 400,
  refs_per_page: 400,
  quote_chars: 500,
  affix_chars: 32,
  note_chars: 4_000,
  rects_per_highlight: 64,
  search_q_chars: 200,
  search_hits: 50,
  /** An ingestion claim's lease (STUDY.md §3.3). */
  claim_ms: 60 * 60_000,
  /** An upload not finished by then is aborted and its record removed. */
  upload_ms: 24 * 60 * 60_000,
  /** A deleted highlight is kept this long (for undo and the other devices), then purged. */
  deleted_highlight_days: 30,
  /** Finished ingestion runs are kept this long. */
  ingest_days: 90,
  /** The private book table and one book's verse text (P7 step 4). */
  table_bytes: 1024 * 1024,
  text_bytes: 8 * 1024 * 1024,
  verse_chars: 4_000,
  /** "Cited in your books": rows shown, and at most with "Show all". */
  cited: 10,
  cited_all: 200,
} as const;

export type BookKind = 'book' | 'manual' | 'other';
/** STUDY.md §3.2. */
export type BookState =
  | 'uploading'
  | 'stored'
  | 'queued'
  | 'extracting'
  | 'ocr'
  | 'indexing'
  | 'ready'
  | 'failed'
  | 'duplicate';
/** The states the mind reports while it reads a book, and how it ends. A duplicate is the Worker's
 * call, from the file's SHA-256. `paused`: the day's bulk rows are used up; it goes on tomorrow. */
export type IngestState = 'extracting' | 'ocr' | 'indexing' | 'paused' | 'ready' | 'failed';

export interface Position {
  pdf_page: number;
  scroll_frac: number;
  at: Ms;
  /** The session that wrote it. */
  device: string;
}

export interface Book {
  id: Id;
  title: string;
  author: string | null;
  kind: BookKind;
  language: string;
  bytes: number;
  pdf_pages: number | null;
  sha256: string | null;
  state: BookState;
  /** A plain sentence when it failed. */
  state_reason: string | null;
  added_at: Ms;
  updated_at: Ms;
  ingested_at: Ms | null;
  duplicate_of: Id | null;
  /** While uploading: the parts received (1-based). */
  parts?: number[];
  /** While being read: pages read so far, and whether it waits for tomorrow's rows. */
  read_pages?: number;
  paused?: boolean;
  position: Position | null;
}

/** POST /v1/library/books: the client's id makes it safe to send again. */
export interface BookCreateRequest {
  id: Id;
  title: string;
  author?: string | null;
  kind?: BookKind;
  language?: string;
  bytes: number;
}
export interface BookUpload {
  part_bytes: number;
  parts: number;
}
export interface BookCreateResponse {
  book: Book;
  upload: BookUpload;
}
/** PUT /v1/library/books/:id/parts/:n */
export interface BookPartResponse {
  n: number;
  parts: number[];
}

export interface Highlight {
  id: Id;
  book_id: Id;
  pdf_page: number;
  quote: string;
  prefix: string;
  suffix: string;
  /** Normalised rects, 0–1 of the page box: [x, y, w, h]; null for a page note. */
  rects: [number, number, number, number][] | null;
  color: 'green' | 'gold' | 'blue' | 'rose';
  note: string | null;
  /** The verse the quote names, when it names one. */
  ref: string | null;
  created_at: Ms;
  updated_at: Ms;
  deleted_at: Ms | null;
}
/** PUT /v1/library/highlights/:id: the newest `updated_at` wins. */
export interface HighlightPutResponse {
  highlight: Highlight;
  applied: boolean;
}

export interface SearchHit {
  book_id: Id;
  pdf_page: number;
  page_label: string | null;
  /** With `<mark>` around the matched words; the rest is the page's text, escaped. */
  snippet: string;
  score: number;
}
/** GET /v1/library/search?q&book_id&limit&cursor */
export interface LibrarySearchResponse {
  items: SearchHit[];
  next: string | null;
  /** Books not ready yet, so not searched. */
  not_ready: number;
}

/** POST /v1/library/ingest/claim: the oldest waiting book, leased for an hour. */
export interface IngestClaim {
  job: { id: Id; book_id: Id; cursor: number; attempts: number; lease_until: Ms };
  book: { id: Id; bytes: number; language: string; pdf_pages: number | null };
}

/** A reference found in a block: a chapter (no verses) or a verse range. */
export interface PageRef {
  block: number;
  book_code: string;
  chapter: number;
  v_start: number | null;
  v_end: number | null;
  weight: 1 | 2 | 3;
  in_heading: boolean;
}
export interface PageIn {
  pdf_page: number;
  page_label: string | null;
  text: string;
  /** [start, end) character offsets into `text`, in order, not overlapping. */
  blocks: [number, number][];
  ocr: boolean;
  ocr_conf: number | null;
  refs: PageRef[];
}
/** PUT /v1/library/books/:id/pages: each page replaces the one stored at its number. */
export interface PagesRequest {
  job_id: Id;
  pages: PageIn[];
}
export interface PagesResponse {
  written: number;
  refs: number;
}
/** GET /v1/library/books/:id/pages?from=&limit= (the mind: SETUP.md O2, cited answers). */
export interface PageTextResponse {
  items: { pdf_page: number; page_label: string | null; text: string }[];
  /** The next `from`, or null at the end. */
  next: number | null;
}

/** PATCH /v1/library/ingest/:job_id */
export interface IngestUpdate {
  state: IngestState;
  cursor?: number;
  pdf_pages?: number;
  sha256?: string;
  /** A plain sentence the owner reads when it failed. */
  reason?: string;
}

/** One block that cites a verse (STUDY.md §7.6 "Cited in your books"). */
export interface CitedBlock {
  book_id: Id;
  title: string;
  pdf_page: number;
  page_label: string | null;
  block: number;
  /** The block's first line, at most 140 characters, cut at a word. */
  line: string;
  weight: number;
}
/** GET /v1/library/verses/:code/:chapter?v=12[-14]&all=1 */
export interface VerseResponse {
  ref: string;
  cited: CitedBlock[];
  total: number;
  /** The owner's highlights and notes whose verse is this one or overlaps it. */
  highlights: Highlight[];
}
/** One block the mind may cite (STUDY.md §8.1): `book:<id>#p<n>.b<k>`, "Title, p. 212", its text. */
export interface CiteCandidate {
  ref: string;
  label: string;
  text: string;
}
/** GET /v1/library/cite?q= (the mind). */
export interface CiteResponse {
  q: string;
  candidates: CiteCandidate[];
}
/** `meta.cite` of a cited answer: the mind sends `{ q }`; the Worker stores what it kept. */
export interface CiteMeta {
  q: string;
  citations: { ref: string; label: string }[];
  dropped: number;
}
/** GET /v1/library/scripture/text/:code/:chapter: the owner's own licensed copy, private. */
export interface VerseTextResponse {
  code: string;
  chapter: number;
  verses: Record<string, string>;
}
/** PUT /v1/library/scripture/text/:code */
export interface ScriptureTextRequest {
  chapters: Record<string, Record<string, string>>;
}
