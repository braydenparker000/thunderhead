// The row meter's days (DATA.md §3): one row per UTC day and object class. Every object keeps its own
// class's row (each object's migrations add this table as a step of its own, from this SQL); Core's
// copy also holds the other classes' rows from its tick, so the meter is read in a few rows a day.
// Core's schema step 24.
import type { Migration, TableInfo } from '../../objects/base';
import { pruneDays } from './store';

export const METER_DAYS_SQL = `CREATE TABLE meter_days (
        day TEXT NOT NULL,
        class TEXT NOT NULL,
        rows_read INTEGER NOT NULL,
        rows_written INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (day, class)
      ) WITHOUT ROWID`;

export const METER_MIGRATIONS: Migration[] = [
  {
    version: 24,
    name: 'meter_days',
    kind: 'expand',
    sql: [METER_DAYS_SQL],
  },
];

export const METER_TABLES: Record<string, TableInfo> = {
  meter_days: {
    retention: '400 days (one row per UTC day and object class; counts only)',
    backup: false,
    export: false,
    prune: pruneDays,
  },
};
