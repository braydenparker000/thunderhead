// The phone's reports (NEXT-BATCH.md part 1, API.md §11.16): one row per batch, kept 30 days.
// Schema step 23. The key is (kind, at, id), so a list reads its own rows newest first and the
// daily prune reads only the rows it deletes, with no second index to write.
import type { Migration, TableInfo } from '../../objects/base';
import { prune } from './store';

export const REPORTS_MIGRATIONS: Migration[] = [
  {
    version: 23,
    name: 'reports',
    kind: 'expand',
    sql: [
      `CREATE TABLE reports (
        kind TEXT NOT NULL,
        at INTEGER NOT NULL,
        id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        body_json TEXT NOT NULL,
        PRIMARY KEY (kind, at, id)
      ) WITHOUT ROWID`,
    ],
  },
];

export const REPORTS_TABLES: Record<string, TableInfo> = {
  reports: {
    retention: '30 days after at (one row per batch: timings, counts and track ids, never titles or words)',
    backup: false,
    export: false,
    prune,
  },
};
