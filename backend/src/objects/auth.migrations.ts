// Schema steps for the Auth object (DATA.md §5, §9). Expand-only; an entry never changes after
// it ships. Tables are WITHOUT ROWID with the lookup key as primary key wherever that saves an
// index: on the free plan every index entry is one more billed row write.
import type { Migration } from './base';

export const AUTH_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'credential, recovery, sessions, throttle, notices, tickets, agents',
    kind: 'expand',
    sql: [
      `CREATE TABLE credential (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        username TEXT NOT NULL,
        algo TEXT NOT NULL,
        n INTEGER NOT NULL, r INTEGER NOT NULL, p INTEGER NOT NULL,
        salt BLOB NOT NULL,
        hash BLOB NOT NULL,
        pepper_v INTEGER NOT NULL,
        version INTEGER NOT NULL,
        changed_at INTEGER NOT NULL
      )`,
      // last5_hash lets /recovery-code/confirm check the owner's typing without the code.
      `CREATE TABLE recovery (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        code_hash BLOB NOT NULL,
        last5_hash BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        confirmed_at INTEGER,
        used_at INTEGER
      )`,
      // Keyed by token hash, the hot lookup; device ids are found by scanning a handful of rows.
      // Revoked and expired rows stay 30 days so an old token learns why (SIGN-IN.md §3.2).
      `CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        id TEXT NOT NULL,
        pop_jwk TEXT,
        label TEXT NOT NULL,
        platform TEXT, browser TEXT, model TEXT,
        standalone INTEGER NOT NULL DEFAULT 0,
        country TEXT, region TEXT, last_country TEXT,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        idle_expires_at INTEGER NOT NULL,
        revoked_at INTEGER,
        revoked_reason TEXT,
        credential_version INTEGER NOT NULL,
        stepup_at INTEGER
      ) WITHOUT ROWID`,
      `CREATE TABLE throttle (
        key TEXT PRIMARY KEY,
        fails INTEGER NOT NULL,
        window_start INTEGER NOT NULL,
        last_at INTEGER NOT NULL,
        next_allowed_at INTEGER NOT NULL
      ) WITHOUT ROWID`,
      `CREATE TABLE notices (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        session_id TEXT,
        args_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        acked_at INTEGER,
        answer TEXT,
        expires_at INTEGER
      ) WITHOUT ROWID`,
      `CREATE TABLE tickets (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        source TEXT NOT NULL,
        requested_at INTEGER NOT NULL,
        usable_after INTEGER,
        expires_at INTEGER,
        used_at INTEGER,
        cancelled_at INTEGER
      ) WITHOUT ROWID`,
      `CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        token_hash BLOB NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        created_on TEXT NOT NULL,
        last_used_at INTEGER,
        last_country TEXT,
        revoked_at INTEGER
      ) WITHOUT ROWID`,
    ],
  },
  {
    version: 2,
    name: 'push subscriptions and outbox',
    kind: 'expand',
    sql: [
      // One per session (SECURITY.md §10); the endpoint is a capability URL.
      `CREATE TABLE push_subscriptions (
        session_id TEXT PRIMARY KEY,
        endpoint TEXT NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) WITHOUT ROWID`,
      // The outbox and each push's words (the payload is only a kind and an id); kept 30 days.
      `CREATE TABLE pushes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        url TEXT NOT NULL,
        topic_key TEXT,
        ref TEXT,
        why TEXT,
        hash TEXT,
        session_id TEXT,
        created_at INTEGER NOT NULL,
        deadline INTEGER NOT NULL,
        sent_at INTEGER,
        dropped_at INTEGER
      ) WITHOUT ROWID`,
    ],
  },
];
