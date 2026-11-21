CREATE TABLE _migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  bookmark TEXT
);

CREATE TABLE batches (
  batch_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  n INTEGER NOT NULL,
  sha256 TEXT NOT NULL
  ) WITHOUT ROWID;

CREATE TABLE events (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL,
  at INTEGER NOT NULL,
  day TEXT NOT NULL,
  app TEXT NOT NULL,
  type TEXT NOT NULL,
  ref TEXT,
  data_json TEXT,
  device_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  sensitivity INTEGER NOT NULL DEFAULT 0
  );

CREATE INDEX events_day_type ON events (day, type);

CREATE INDEX events_type_seq ON events (type, seq);

CREATE TABLE exports (
  day TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  n INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  at INTEGER NOT NULL
  ) WITHOUT ROWID;

CREATE TABLE meter_days (
  day TEXT NOT NULL,
  class TEXT NOT NULL,
  rows_read INTEGER NOT NULL,
  rows_written INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, class)
  ) WITHOUT ROWID;

CREATE TABLE rollups (
  day TEXT NOT NULL,
  type TEXT NOT NULL,
  ref TEXT NOT NULL,
  n INTEGER NOT NULL,
  sum_ms INTEGER NOT NULL,
  PRIMARY KEY (day, type, ref)
  ) WITHOUT ROWID;
