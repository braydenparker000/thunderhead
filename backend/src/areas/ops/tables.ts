// The ops area's tables and their retention (DATA.md §10). The SQL is in the P1 base step.
import type { TableInfo } from '../../objects/base';
import { pruneErrors, prunePerf } from './store';

export const OPS_TABLES: Record<string, TableInfo> = {
  errors: {
    retention: '30 days after last_at; at most 1,000 fingerprints',
    backup: true,
    export: false,
    prune: pruneErrors,
  },
  perf_days: { retention: '400 days', backup: true, export: false, prune: prunePerf },
};
