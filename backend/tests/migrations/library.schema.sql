CREATE TABLE _migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  bookmark TEXT
);

CREATE TABLE books (
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
  ) WITHOUT ROWID;

CREATE TABLE embeddings (
  ref TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  vector BLOB NOT NULL,
  snippet TEXT NOT NULL,
  at INTEGER NOT NULL,
  provenance TEXT,
  indexed_at INTEGER NOT NULL
  );

CREATE INDEX embeddings_at ON embeddings (at);

CREATE TABLE highlights (
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
  ) WITHOUT ROWID;

CREATE INDEX highlights_book ON highlights (book_id, pdf_page);

CREATE INDEX highlights_deleted ON highlights (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX highlights_ref ON highlights (ref) WHERE ref IS NOT NULL;

CREATE TABLE ingest_jobs (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  state TEXT NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  claimed_by TEXT,
  claimed_at INTEGER,
  updated_at INTEGER NOT NULL
  ) WITHOUT ROWID;

CREATE INDEX ingest_jobs_state ON ingest_jobs (state, updated_at);

CREATE TABLE meter_days (
  day TEXT NOT NULL,
  class TEXT NOT NULL,
  rows_read INTEGER NOT NULL,
  rows_written INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, class)
  ) WITHOUT ROWID;

CREATE TABLE pages (
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
  );

CREATE VIRTUAL TABLE pages_fts USING fts5 (text, content = 'pages', content_rowid = 'seq', tokenize = 'unicode61 remove_diacritics 2');

CREATE TABLE 'pages_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID;

CREATE TABLE 'pages_fts_data'(id INTEGER PRIMARY KEY, block BLOB);

CREATE TABLE 'pages_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB);

CREATE TABLE 'pages_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID;

CREATE VIRTUAL TABLE pages_stem USING fts5 (text, content = 'pages', content_rowid = 'seq', tokenize = 'porter unicode61 remove_diacritics 2');

CREATE TABLE 'pages_stem_config'(k PRIMARY KEY, v) WITHOUT ROWID;

CREATE TABLE 'pages_stem_data'(id INTEGER PRIMARY KEY, block BLOB);

CREATE TABLE 'pages_stem_docsize'(id INTEGER PRIMARY KEY, sz BLOB);

CREATE TABLE 'pages_stem_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID;

CREATE TABLE positions (
  book_id TEXT PRIMARY KEY,
  pdf_page INTEGER NOT NULL,
  scroll_frac REAL NOT NULL,
  at INTEGER NOT NULL,
  device TEXT NOT NULL
  ) WITHOUT ROWID;

CREATE TABLE stem_fill (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  after INTEGER NOT NULL,
  until INTEGER NOT NULL
  );

CREATE TABLE verse_refs (
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
  ) WITHOUT ROWID;

CREATE INDEX verse_refs_chapter ON verse_refs (book_code, chapter);
