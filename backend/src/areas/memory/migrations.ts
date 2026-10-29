// Memory's tables (DATA.md §4.4, MEMORY.md §2): facts and day notes with their FTS indexes, open
// threads (commitments), and op_batches, the idempotency window of batch writes (API.md §7).
// Like messages, facts and day notes carry an integer `seq` as their rowid so their external-
// content FTS tables survive a VACUUM; `id` (facts) and `day` (day notes) stay the keys clients
// use. `facts.ledger_id` (eng) names the ledger row that wrote each version, its "why";
// `lineage_id` (eng) is the first version's id, shared by every later one, so `forget` finds
// them all even after an undo unlinked a version. `fact_tombstones` keeps the forgotten ids (no
// text) so none is used again and a restore can re-apply the forgets.
import type { Migration, TableInfo } from '../../objects/base';
import { pruneBatches, pruneThreads } from './notes';

export const MEMORY_MIGRATIONS: Migration[] = [
  {
    version: 8,
    name: 'facts, fact_tombstones, day_notes, open_threads, op_batches',
    kind: 'expand',
    sql: [
      `CREATE TABLE facts (
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
      )`,
      `CREATE INDEX facts_current ON facts (kind) WHERE superseded_at IS NULL`,
      `CREATE INDEX facts_lineage ON facts (lineage_id)`,
      `CREATE TABLE fact_tombstones (
        id TEXT PRIMARY KEY,
        lineage_id TEXT NOT NULL,
        forgotten_at INTEGER NOT NULL
      ) WITHOUT ROWID`,
      `CREATE VIRTUAL TABLE facts_fts USING fts5 (text, subject, content = 'facts', content_rowid = 'seq', tokenize = 'unicode61 remove_diacritics 2')`,
      `CREATE TABLE day_notes (
        seq INTEGER PRIMARY KEY,
        day TEXT NOT NULL UNIQUE,
        summary TEXT NOT NULL,
        decisions_json TEXT,
        stats_json TEXT,
        importance INTEGER NOT NULL,
        written_by TEXT NOT NULL,
        version INTEGER NOT NULL,
        written_at INTEGER NOT NULL
      )`,
      `CREATE VIRTUAL TABLE day_notes_fts USING fts5 (summary, content = 'day_notes', content_rowid = 'seq', tokenize = 'unicode61 remove_diacritics 2')`,
      `CREATE TABLE open_threads (
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
      ) WITHOUT ROWID`,
      `CREATE INDEX open_threads_due ON open_threads (due_at) WHERE status = 'open'`,
      `CREATE TABLE op_batches (
        key TEXT PRIMARY KEY,
        route TEXT NOT NULL,
        req_sha256 TEXT NOT NULL,
        status INTEGER NOT NULL,
        result_json TEXT NOT NULL,
        at INTEGER NOT NULL
      ) WITHOUT ROWID`,
    ],
  },
];

export const MEMORY_TABLES: Record<string, TableInfo> = {
  facts: { retention: 'forever (until forgotten)', backup: true, export: true },
  facts_fts: { retention: 'derived (rebuilt)', backup: false, export: false },
  fact_tombstones: { retention: 'forever (ids only, no text)', backup: true, export: false },
  day_notes: { retention: 'forever', backup: true, export: true },
  day_notes_fts: { retention: 'derived (rebuilt)', backup: false, export: false },
  open_threads: { retention: 'open until closed; closed 1 year', backup: true, export: true, prune: pruneThreads },
  op_batches: { retention: '7 days', backup: false, export: false, prune: pruneBatches },
};
