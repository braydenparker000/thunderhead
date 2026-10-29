// The backups' watchdogs (OPERATIONS.md §8.2), spread into the registry's checks: a stale backup
// (once the first one exists), a failed drill, and no drill for 35 days since the first backup.
import { BACKUP_LIMITS as L } from '../../../../shared/contract/backups.ts';
import { DAY } from '../../lib/time';
import type { Check } from '../watchdogs/checks';
import * as store from './store';

const firstComplete = (db: Parameters<Check>[0]) =>
  db.one<{ at: number | null }>("SELECT min(finished_at) AS at FROM backups WHERE state = 'complete'")?.at ?? null;

const backupStale: Check = (db, c) => {
  const b = store.lastComplete(db);
  if (!b?.finished_at) return { detail: null };
  const days = Math.floor((c.at - b.finished_at) / DAY);
  return {
    detail:
      c.at - b.finished_at > L.stale_days * DAY ? `the newest complete backup (${b.date}) is ${days} days old` : null,
  };
};

const drillFailed: Check = (db) => {
  const d = store.lastDrill(db);
  return { detail: d?.state === 'failed' ? `the ${d.month} drill failed with ${d.problems} problems` : null };
};

const drillOverdue: Check = (db, c) => {
  const first = firstComplete(db);
  if (!first || c.at - first < L.drill_overdue_days * DAY) return { detail: null };
  const d = store.lastDrill(db);
  const since = d?.finished_at ?? first;
  return {
    detail:
      c.at - since > L.drill_overdue_days * DAY
        ? `no restore drill for ${Math.floor((c.at - since) / DAY)} days`
        : null,
  };
};

export const BACKUP_CHECKS = {
  'backup.stale': backupStale,
  'drill.failed': drillFailed,
  'drill.overdue': drillOverdue,
} as const;
