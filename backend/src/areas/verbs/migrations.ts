// Verbs queued for a phone or run by the Worker (DATA.md §4.3), with retention (§10). `error_json`
// holds a failed result's code (e.g. `unsupported_verb`). Schema step 29: the mixes `music.mix_save`
// keeps (a name and its songs, by the id of the verb that saved it), which `music.play_mix` plays.
// Step 33: scheduled actions and plans (schedule.ts, plan.ts): when a `scheduled` row fires, the plan
// a step belongs to, and the why and permit a scheduled row keeps for the ledger row it writes when
// it runs (none is written while it waits). Step 38: routines (routines.ts), a plan and a condition
// the owner approved once; the alarm's soonest and the due pass read `routines_next` only.
import type { Migration, TableInfo } from '../../objects/base';
import { pruneMixes } from './mixes';
import { prune } from './store';

export const VERBS_MIGRATIONS: Migration[] = [
  {
    version: 6,
    name: 'verbs',
    kind: 'expand',
    sql: [
      `CREATE TABLE verbs (
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
      ) WITHOUT ROWID`,
      `CREATE INDEX verbs_open ON verbs (created_at) WHERE status IN ('pending', 'claimed')`,
    ],
  },
  {
    version: 29,
    name: 'mixes',
    kind: 'expand',
    sql: [
      `CREATE TABLE mixes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        refs_json TEXT NOT NULL,
        tracks INTEGER NOT NULL,
        recipe TEXT,
        actor TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) WITHOUT ROWID`,
      'CREATE INDEX mixes_created ON mixes (created_at)',
    ],
  },
  {
    version: 33,
    name: 'verbs scheduled',
    kind: 'expand',
    sql: [
      'ALTER TABLE verbs ADD COLUMN fire_at INTEGER',
      'ALTER TABLE verbs ADD COLUMN plan_id TEXT',
      'ALTER TABLE verbs ADD COLUMN why TEXT',
      'ALTER TABLE verbs ADD COLUMN permit TEXT',
      // At most 20 rows: the alarm's soonest, the due pass and the list read only these.
      "CREATE INDEX verbs_scheduled ON verbs (fire_at) WHERE status = 'scheduled'",
    ],
  },
  {
    version: 38,
    name: 'routines',
    kind: 'expand',
    sql: [
      `CREATE TABLE routines (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        what TEXT NOT NULL,
        why TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        cond_json TEXT NOT NULL,
        when_text TEXT NOT NULL,
        event_type TEXT,
        actor TEXT NOT NULL,
        proposal_id TEXT NOT NULL,
        permit TEXT,
        status TEXT NOT NULL,
        approved_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        next_at INTEGER,
        last_run_at INTEGER,
        last_ledger_id TEXT,
        last_day TEXT,
        last_error TEXT
      ) WITHOUT ROWID`,
      // The tick's check: the soonest time-bound routine that is on (NULL while off or event-bound).
      'CREATE INDEX routines_next ON routines (next_at) WHERE next_at IS NOT NULL',
      "CREATE INDEX routines_event ON routines (event_type) WHERE event_type IS NOT NULL AND status = 'on'",
    ],
  },
];

export const VERBS_TABLES: Record<string, TableInfo> = {
  verbs: {
    retention: 'done/failed/expired/cancelled deleted 30 days after done_at or expires_at',
    backup: true,
    export: true,
    prune,
  },
  mixes: {
    retention: 'the newest 50; older ones deleted by the daily prune (an undo deletes one at once)',
    backup: true,
    export: true,
    prune: pruneMixes,
  },
  routines: {
    retention: 'forever while kept (at most 12); the owner’s Remove deletes one at once',
    backup: true,
    export: true,
  },
};
