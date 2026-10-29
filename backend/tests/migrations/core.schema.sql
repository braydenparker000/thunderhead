CREATE TABLE _migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  bookmark TEXT
);

CREATE TABLE changes (
  seq INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  ref TEXT,
  at INTEGER NOT NULL
  );

CREATE TABLE day_notes (
  seq INTEGER PRIMARY KEY,
  day TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  decisions_json TEXT,
  stats_json TEXT,
  importance INTEGER NOT NULL,
  written_by TEXT NOT NULL,
  version INTEGER NOT NULL,
  written_at INTEGER NOT NULL
  );

CREATE VIRTUAL TABLE day_notes_fts USING fts5 (summary, content = 'day_notes', content_rowid = 'seq', tokenize = 'unicode61 remove_diacritics 2');

CREATE TABLE 'day_notes_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID;

CREATE TABLE 'day_notes_fts_data'(id INTEGER PRIMARY KEY, block BLOB);

CREATE TABLE 'day_notes_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB);

CREATE TABLE 'day_notes_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID;

CREATE TABLE errors (
  fingerprint TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  route TEXT,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  count INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  last_build INTEGER,
  resolved_at INTEGER
  ) WITHOUT ROWID;

CREATE TABLE fact_tombstones (
  id TEXT PRIMARY KEY,
  lineage_id TEXT NOT NULL,
  forgotten_at INTEGER NOT NULL
  ) WITHOUT ROWID;

CREATE TABLE facts (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  about TEXT NOT NULL,
  subject TEXT,
  text TEXT NOT NULL,
  tags_json TEXT,
  source TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence_json TEXT NOT NULL,
  valid_from INTEGER,
  valid_to INTEGER,
  recorded_at INTEGER NOT NULL,
  superseded_at INTEGER,
  superseded_by TEXT,
  last_confirmed INTEGER NOT NULL,
  sensitivity INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  may_raise INTEGER NOT NULL DEFAULT 1,
  written_by TEXT NOT NULL,
  ledger_id TEXT,
  lineage_id TEXT NOT NULL
  );

CREATE INDEX facts_current ON facts (kind) WHERE superseded_at IS NULL;

CREATE VIRTUAL TABLE facts_fts USING fts5 (text, subject, content = 'facts', content_rowid = 'seq', tokenize = 'unicode61 remove_diacritics 2');

CREATE TABLE 'facts_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID;

CREATE TABLE 'facts_fts_data'(id INTEGER PRIMARY KEY, block BLOB);

CREATE TABLE 'facts_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB);

CREATE TABLE 'facts_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID;

CREATE INDEX facts_lineage ON facts (lineage_id);

CREATE TABLE leases (
  task TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  renewed_at INTEGER NOT NULL
  ) WITHOUT ROWID;

CREATE TABLE ledger (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  session_id TEXT,
  kind TEXT NOT NULL,
  what TEXT NOT NULL,
  why TEXT NOT NULL,
  ref TEXT,
  topic_key TEXT,
  undo_json TEXT,
  undoable INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  tainted INTEGER NOT NULL DEFAULT 0,
  proposal_id TEXT,
  op_json TEXT,
  verb_id TEXT,
  undone_at INTEGER,
  req_sha256 TEXT
  );

CREATE INDEX ledger_at ON ledger (at);

CREATE TABLE live_tickets (
  hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
  ) WITHOUT ROWID;

CREATE TABLE messages (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  thread_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  author TEXT NOT NULL,
  origin TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  reply_to TEXT,
  meta_json TEXT,
  attachments_json TEXT,
  device_id TEXT,
  session_id TEXT,
  delivered_at INTEGER,
  acked_at INTEGER,
  answered_at INTEGER,
  req_sha256 TEXT
  );

CREATE VIRTUAL TABLE messages_fts USING fts5 (body, content = 'messages', content_rowid = 'seq', tokenize = 'unicode61 remove_diacritics 2');

CREATE TABLE 'messages_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID;

CREATE TABLE 'messages_fts_data'(id INTEGER PRIMARY KEY, block BLOB);

CREATE TABLE 'messages_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB);

CREATE TABLE 'messages_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID;

CREATE INDEX messages_handed ON messages (delivered_at)
  WHERE author = 'owner' AND answered_at IS NULL AND acked_at IS NULL AND delivered_at IS NOT NULL;

CREATE INDEX messages_system ON messages (seq) WHERE author = 'system';

CREATE INDEX messages_thread_seq ON messages (thread_id, seq);

CREATE INDEX messages_waiting ON messages (seq) WHERE author = 'owner' AND answered_at IS NULL;

CREATE TABLE mind_sessions (
  session_id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  wake_id TEXT,
  claimed_at INTEGER NOT NULL,
  th_version TEXT,
  constitution_sha256 TEXT,
  laws_pinned INTEGER NOT NULL DEFAULT 0,
  tainted_at INTEGER,
  taint_source TEXT,
  ended_at INTEGER,
  day TEXT NOT NULL,
  last_owner_at INTEGER
  ) WITHOUT ROWID;

CREATE INDEX mind_sessions_tainted ON mind_sessions (role, tainted_at) WHERE tainted_at IS NOT NULL;

CREATE TABLE night_runs (
  day TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  step INTEGER NOT NULL DEFAULT 0,
  steps_json TEXT NOT NULL DEFAULT '{}',
  done_at INTEGER,
  session_id TEXT
  ) WITHOUT ROWID;

CREATE TABLE op_batches (
  key TEXT PRIMARY KEY,
  route TEXT NOT NULL,
  req_sha256 TEXT NOT NULL,
  status INTEGER NOT NULL,
  result_json TEXT NOT NULL,
  at INTEGER NOT NULL
  ) WITHOUT ROWID;

CREATE TABLE open_threads (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  owner TEXT NOT NULL,
  due_at INTEGER,
  tags_json TEXT,
  status TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  last_progress_at INTEGER,
  closed_at INTEGER,
  closed_why TEXT
  ) WITHOUT ROWID;

CREATE INDEX open_threads_due ON open_threads (due_at) WHERE status = 'open';

CREATE TABLE perf_days (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  p50 REAL, p75 REAL, p95 REAL,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, metric)
  ) WITHOUT ROWID;

CREATE TABLE session_notes (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  wake_id TEXT,
  role TEXT NOT NULL,
  thread_id TEXT,
  created_at INTEGER NOT NULL,
  body TEXT NOT NULL,
  open_items_json TEXT NOT NULL
  ) WITHOUT ROWID;

CREATE INDEX session_notes_at ON session_notes (created_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  actor TEXT NOT NULL
  ) WITHOUT ROWID;

CREATE TABLE surfaces (
  app TEXT NOT NULL,
  slot TEXT NOT NULL,
  kind TEXT NOT NULL,
  schema INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  why TEXT NOT NULL,
  topic_key TEXT NOT NULL,
  ref TEXT,
  expires_at INTEGER,
  written_at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  ledger_id TEXT,
  seq INTEGER NOT NULL, facts_json TEXT,
  PRIMARY KEY (app, slot)
  ) WITHOUT ROWID;

CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT,
  title_source TEXT,
  summary TEXT,
  status TEXT NOT NULL,
  continues TEXT,
  started_at INTEGER NOT NULL,
  filed_at INTEGER,
  message_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
  ) WITHOUT ROWID;

CREATE UNIQUE INDEX threads_daily_day ON threads (day) WHERE kind = 'daily';

CREATE INDEX threads_status_updated ON threads (status, updated_at);

CREATE TABLE topics (
  topic_key TEXT PRIMARY KEY,
  last_shown_at INTEGER,
  ignored_at INTEGER,
  shown_count INTEGER NOT NULL DEFAULT 0
  ) WITHOUT ROWID;

CREATE TABLE verbs (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  verb TEXT NOT NULL,
  schema INTEGER NOT NULL,
  ref TEXT,
  args_json TEXT NOT NULL,
  device_id TEXT,
  status TEXT NOT NULL,
  proposal_id TEXT,
  ledger_id TEXT,
  expires_at INTEGER NOT NULL,
  claimed_at INTEGER,
  claimed_by TEXT,
  claims INTEGER NOT NULL DEFAULT 0,
  done_at INTEGER,
  result_json TEXT,
  undo_json TEXT,
  error_json TEXT,
  req_sha256 TEXT
  ) WITHOUT ROWID;

CREATE INDEX verbs_open ON verbs (created_at) WHERE status IN ('pending', 'claimed');

CREATE TABLE wakes (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  task TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  fired_at INTEGER,
  fire_status INTEGER,
  fire_error TEXT,
  session_id TEXT,
  claimed_at INTEGER,
  claim_match TEXT,
  retry_of TEXT,
  first_reply_at INTEGER,
  ended_at INTEGER,
  end_reason TEXT
  ) WITHOUT ROWID;

CREATE INDEX wakes_at ON wakes (at);

CREATE INDEX wakes_open ON wakes (at) WHERE status IN ('fired', 'unclaimed');
