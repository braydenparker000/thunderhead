// The mind's bookkeeping (DATA.md §4.1): wakes, the chat lease, per-session state and session
// notes, with their retention (§10). `mind_sessions.day` and `last_owner_at` are additions that
// back `day_closed` and `idle_min` (API.md §11.8) without scanning messages.
import type { Migration, TableInfo } from '../../objects/base';
import { pruneLeases, pruneNotes, pruneSessions, pruneWakes } from './store';

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
];

export const MIND_TABLES: Record<string, TableInfo> = {
  wakes: { retention: '30 days', backup: true, export: false, prune: pruneWakes },
  leases: { retention: 'live only', backup: false, export: false, prune: pruneLeases },
  mind_sessions: { retention: '90 days after ended_at', backup: true, export: false, prune: pruneSessions },
  session_notes: { retention: '180 days', backup: true, export: true, prune: pruneNotes },
};
