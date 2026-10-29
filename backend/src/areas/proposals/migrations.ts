// Proposals (DATA.md §4.3, API.md §11.10): the decision cards behind the ask-first classes, with
// their retention (§10: a year after they were decided). `show_from` holds a card made in quiet
// hours, or snoozed with "Not yet", until the morning; `visible_from` is when it first could show,
// which the owner's words must come after. `ref` names what the op acts on (one waiting card per
// thing; the words of a card are scrubbed when the owner forgets the fact it names).
import type { Migration, TableInfo } from '../../objects/base';
import { prune } from './store';

export const PROPOSALS_MIGRATIONS: Migration[] = [
  {
    version: 14,
    name: 'proposals',
    kind: 'expand',
    sql: [
      `CREATE TABLE proposals (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        session_id TEXT,
        class TEXT NOT NULL,
        question TEXT NOT NULL,
        why TEXT NOT NULL,
        if_ignored TEXT NOT NULL,
        odds REAL,
        options_json TEXT NOT NULL,
        safe TEXT NOT NULL DEFAULT 'reject',
        spec_json TEXT NOT NULL,
        spec_hash TEXT NOT NULL,
        op TEXT NOT NULL,
        ref TEXT,
        status TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        visible_from INTEGER NOT NULL,
        show_from INTEGER NOT NULL,
        snoozes INTEGER NOT NULL DEFAULT 0,
        decided_at INTEGER,
        decided_by_device TEXT,
        decided_via TEXT,
        decided_message_id TEXT,
        executed_ledger_id TEXT,
        result_json TEXT,
        req_sha256 TEXT
      ) WITHOUT ROWID`,
      // Waiting cards and approvals still running (an Auth step the cron retries).
      `CREATE INDEX proposals_open ON proposals (created_at) WHERE status IN ('waiting', 'approved')`,
      'CREATE INDEX proposals_ref ON proposals (ref) WHERE ref IS NOT NULL',
      'CREATE INDEX proposals_decided ON proposals (decided_at) WHERE decided_at IS NOT NULL',
    ],
  },
];

export const PROPOSALS_TABLES: Record<string, TableInfo> = {
  proposals: { retention: '1 year after decided', backup: true, export: true, prune },
};
