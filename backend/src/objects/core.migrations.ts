// Schema steps for the Core object (DATA.md §9). Expand-only, numbered 1…n, one transaction
// each. Step 1 is the P1 base (settings, the change feed, the error inbox, perf); every later
// step is owned by its area (areas/<name>/migrations.ts), which also declares its tables'
// retention (DATA.md §10). This file only composes them, so an area can later move to its own
// object with its migrations and rows.
import { CONVERSATION_MIGRATIONS, CONVERSATION_TABLES } from '../areas/conversation/migrations';
import { FEED_MIGRATIONS, FEED_TABLES } from '../areas/feed/migrations';
import { LEDGER_MIGRATIONS, LEDGER_TABLES } from '../areas/ledger/migrations';
import { MEMORY_MIGRATIONS, MEMORY_TABLES } from '../areas/memory/migrations';
import { MIND_MIGRATIONS, MIND_TABLES } from '../areas/mind/migrations';
import { OPS_TABLES } from '../areas/ops/tables';
import { SETTINGS_TABLES } from '../areas/settings/tables';
import { SURFACES_MIGRATIONS, SURFACES_TABLES } from '../areas/surfaces/migrations';
import { VERBS_MIGRATIONS, VERBS_TABLES } from '../areas/verbs/migrations';
import type { Migration, TableInfo } from './base';

const P1_BASE: Migration = {
  version: 1,
  name: 'settings, changes, errors, perf_days',
  kind: 'expand',
  sql: [
    `CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        actor TEXT NOT NULL
      ) WITHOUT ROWID`,
    `CREATE TABLE changes (
        seq INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        ref TEXT,
        at INTEGER NOT NULL
      )`,
    `CREATE TABLE errors (
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
      ) WITHOUT ROWID`,
    `CREATE TABLE perf_days (
        day TEXT NOT NULL,
        metric TEXT NOT NULL,
        p50 REAL, p75 REAL, p95 REAL,
        n INTEGER NOT NULL,
        PRIMARY KEY (day, metric)
      ) WITHOUT ROWID`,
  ],
};

export const CORE_MIGRATIONS: Migration[] = [
  P1_BASE,
  ...CONVERSATION_MIGRATIONS,
  ...FEED_MIGRATIONS,
  ...MIND_MIGRATIONS,
  ...LEDGER_MIGRATIONS,
  ...VERBS_MIGRATIONS,
  ...SURFACES_MIGRATIONS,
  ...MEMORY_MIGRATIONS,
].sort((a, b) => a.version - b.version);

/** Every Core table with its retention and export inclusion (DATA.md §10); a test fails if a
 * table exists without an entry here or in DATA.md. */
export const CORE_TABLES: Record<string, TableInfo> = {
  ...SETTINGS_TABLES,
  ...OPS_TABLES,
  ...FEED_TABLES,
  ...CONVERSATION_TABLES,
  ...MIND_TABLES,
  ...LEDGER_TABLES,
  ...VERBS_TABLES,
  ...SURFACES_TABLES,
  ...MEMORY_TABLES,
};
