// The mind's bookkeeping (DATA.md §4.1): wakes, the chat lease, per-session state and session
// notes, with their retention (§10). `mind_sessions.day` and `last_owner_at` are additions that
// back `day_closed` and `idle_min` (API.md §11.8) without scanning messages. v10 indexes only the
// tainted sessions, which a claim looks up by the taint's time (a taint lasts 24 hours for its
// role, MEMORY.md §7). v11 is the night shift's run record, one row per closed day (RUNTIME.md
// §12), and a time index on session notes (the night reads a day's, the briefing the latest).
// v26 dates every taint event (`taint_event_at`: a later read re-dates an already tainted session,
// a claim's inherited taint doesn't), records when a night session last read songs' tags
// (`songs_at`, so a sibling's read closes the web of every night session claimed before it), and
// marks a session note written by a tainted session (`tainted`, MEMORY.md §7). v34 is the day
// pulse (watches/, RUNTIME.md §3; 33 is scheduled actions'): the watches, the wake's reason
// (`wakes.reason_json`, `{watch, kind, note}` on a wake a watch fired) and a time index on the
// sessions' claims, which the usage meter reads (GET /v1/mind/usage) instead of every session row.
// v39 keeps the outside read's time on the wake (`outside_ms`: the lookup title to the reply).
import type { Migration, TableInfo } from '../../objects/base';
import { pruneLeases, pruneNightRuns, pruneNotes, pruneSessions, pruneWakes } from './prune';
import { pruneWatches } from './watches/store';

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
    version: 15,
    name: 'mind_sessions_open index',
    kind: 'expand',
    // A chat claim ends the role's other open sessions, found through this index.
    sql: ['CREATE INDEX mind_sessions_open ON mind_sessions (role) WHERE ended_at IS NULL'],
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
  {
    version: 26,
    name: 'taint events, songs, tainted notes',
    kind: 'expand',
    sql: [
      'ALTER TABLE mind_sessions ADD COLUMN taint_event_at INTEGER',
      'ALTER TABLE mind_sessions ADD COLUMN songs_at INTEGER',
      // A row from before v26 counts its first taint as its last event.
      `CREATE INDEX mind_sessions_taint_event ON mind_sessions (role, coalesce(taint_event_at, tainted_at))
        WHERE tainted_at IS NOT NULL`,
      'CREATE INDEX mind_sessions_songs ON mind_sessions (role, songs_at) WHERE songs_at IS NOT NULL',
      'ALTER TABLE session_notes ADD COLUMN tainted INTEGER NOT NULL DEFAULT 0',
    ],
  },
  {
    version: 34,
    name: 'watches, wake reasons, session claim times',
    kind: 'expand',
    sql: [
      `CREATE TABLE watches (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        fire_at INTEGER,
        type TEXT,
        ref TEXT,
        why TEXT NOT NULL,
        note TEXT,
        outside INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        until INTEGER NOT NULL,
        session_id TEXT,
        met_at INTEGER,
        met_ref TEXT,
        settled_at INTEGER,
        by TEXT,
        wake_id TEXT,
        to_session TEXT
      ) WITHOUT ROWID`,
      // The waiting ones: the count, the soonest time, an event's or a change's kind, the queue.
      "CREATE INDEX watches_waiting ON watches (kind, type, fire_at) WHERE state IN ('live', 'queued')",
      // The settled ones by when: the meter, the list's last day, a claim's hand-over, the prune.
      'CREATE INDEX watches_settled ON watches (settled_at) WHERE settled_at IS NOT NULL',
      'ALTER TABLE wakes ADD COLUMN reason_json TEXT',
      'CREATE INDEX mind_sessions_claimed ON mind_sessions (claimed_at)',
    ],
  },
  {
    version: 39,
    name: 'outside-read time on the wake',
    kind: 'expand',
    // From the working card's lookup title to the reply (RUNTIME.md §6.6), beside first_reply_at.
    sql: ['ALTER TABLE wakes ADD COLUMN outside_ms INTEGER'],
  },
];

export const MIND_TABLES: Record<string, TableInfo> = {
  wakes: { retention: '30 days', backup: true, export: false, prune: pruneWakes },
  leases: { retention: 'live only', backup: false, export: false, prune: pruneLeases },
  mind_sessions: { retention: '90 days after ended_at', backup: true, export: false, prune: pruneSessions },
  session_notes: { retention: '180 days', backup: true, export: true, prune: pruneNotes },
  night_runs: { retention: '400 days', backup: true, export: false, prune: pruneNightRuns },
  watches: { retention: '30 days after it settles', backup: true, export: false, prune: pruneWatches },
};
