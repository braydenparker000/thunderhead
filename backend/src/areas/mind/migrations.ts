// The mind's bookkeeping (DATA.md §4.1): wakes, the chat lease, per-session state and session
// notes, with their retention (§10). `mind_sessions.day` and `last_owner_at` are additions that
// back `day_closed` and `idle_min` (API.md §11.8) without scanning messages. v10 indexes only the
// tainted sessions, which a claim looks up by the taint's time (a taint lasts 24 hours for its
// role, MEMORY.md §7). v11 is the night shift's run record, one row per closed day (RUNTIME.md
// §12), and a time index on session notes (the night reads a day's, the briefing the latest).
import type { Migration, TableInfo } from '../../objects/base';
import { pruneLeases, pruneNightRuns, pruneNotes, pruneSessions, pruneWakes } from './prune';

export const MIND_MIGRATIONS: Migration[] = [
  {
    version: 4,
    name: 'wakes, leases, mind_sessions, session_notes',
    kind: 'expand',
    sql: [
      `CREATE TABLE wakes (
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
      ) WITHOUT ROWID`,
      `CREATE INDEX wakes_at ON wakes (at)`,
      `CREATE INDEX wakes_open ON wakes (at) WHERE status IN ('fired', 'unclaimed')`,
      `CREATE TABLE leases (
        task TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        acquired_at INTEGER NOT NULL,
        renewed_at INTEGER NOT NULL
      ) WITHOUT ROWID`,
      `CREATE TABLE mind_sessions (
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
      ) WITHOUT ROWID`,
      `CREATE TABLE session_notes (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        wake_id TEXT,
        role TEXT NOT NULL,
        thread_id TEXT,
        created_at INTEGER NOT NULL,
        body TEXT NOT NULL,
        open_items_json TEXT NOT NULL
      ) WITHOUT ROWID`,
    ],
  },
  {
    version: 10,
    name: 'mind_sessions_tainted index',
    kind: 'expand',
    sql: ['CREATE INDEX mind_sessions_tainted ON mind_sessions (role, tainted_at) WHERE tainted_at IS NOT NULL'],
  },
  {
    version: 11,
    name: 'night_runs',
    kind: 'expand',
    sql: [
      `CREATE TABLE night_runs (
        day TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        step INTEGER NOT NULL DEFAULT 0,
        steps_json TEXT NOT NULL DEFAULT '{}',
        done_at INTEGER,
        session_id TEXT
      ) WITHOUT ROWID`,
      // The night reads a day's notes by time, and the briefing the latest one.
      'CREATE INDEX session_notes_at ON session_notes (created_at)',
    ],
  },
];

export const MIND_TABLES: Record<string, TableInfo> = {
  wakes: { retention: '30 days', backup: true, export: false, prune: pruneWakes },
  leases: { retention: 'live only', backup: false, export: false, prune: pruneLeases },
  mind_sessions: { retention: '90 days after ended_at', backup: true, export: false, prune: pruneSessions },
  session_notes: { retention: '180 days', backup: true, export: true, prune: pruneNotes },
  night_runs: { retention: '400 days', backup: true, export: false, prune: pruneNightRuns },
};
