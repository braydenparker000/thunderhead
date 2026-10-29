// The import's records (DATA.md §4.4, §12): one `imports` row per run of a dataset (its state,
// counts and verification report) and `import_items`, raw documents such as the old notebook,
// kept until the mind converts them once. With their retention (§10).
import type { Migration, TableInfo } from '../../objects/base';
import { pruneItems } from './store';

export const IMPORT_MIGRATIONS: Migration[] = [
  {
    version: 13,
    name: 'imports, import_items',
    kind: 'expand',
    sql: [
      `CREATE TABLE imports (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        dataset TEXT NOT NULL,
        r2_prefix TEXT NOT NULL,
        manifest_json TEXT,
        state TEXT NOT NULL,
        counts_json TEXT NOT NULL,
        report_json TEXT,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        run_id TEXT NOT NULL,
        job_id TEXT,
        last_error TEXT
      ) WITHOUT ROWID`,
      'CREATE INDEX imports_run ON imports (run_id, dataset)',
      `CREATE TABLE import_items (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        dataset TEXT NOT NULL,
        key TEXT NOT NULL,
        body_json TEXT NOT NULL,
        converted_at INTEGER
      ) WITHOUT ROWID`,
    ],
  },
];

export const IMPORT_TABLES: Record<string, TableInfo> = {
  imports: { retention: 'forever (small)', backup: true, export: true },
  import_items: { retention: '30 days after converted_at', backup: true, export: true, prune: pruneItems },
};
