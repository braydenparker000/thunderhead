// The quota watchdogs' checks (OPERATIONS.md §8.2): today's rows read and rows written across the
// five objects, from Core's meter_days (gathered by the same tick just before), against 60% of the
// day's budget (the Free plan's limits less the old Worker's share, shared/contract/meter.ts). A
// check names the level passed, not the running count, so a trip writes its row once and once more
// at 80%; the next UTC day starts at zero, and it clears.
import { DAY_BUDGET, QUOTA_LEVELS } from '../../../../shared/contract/meter.ts';
import type { WatchdogName } from '../../../../shared/contract/watchdogs.ts';
import type { Check } from '../watchdogs/checks';
import { quota } from './quota';

const level = (pct: number) =>
  pct >= QUOTA_LEVELS.hold ? QUOTA_LEVELS.hold : pct >= QUOTA_LEVELS.note ? QUOTA_LEVELS.note : null;

const check =
  (key: 'rows_read' | 'rows_written'): Check =>
  (db, c) => {
    const q = c.quota ?? quota(db, c.at);
    const l = level(key === 'rows_read' ? q.read_pct : q.written_pct);
    if (l === null) return { detail: null };
    const what = `${key.replace('_', ' ')} today passed ${l}% of the day's budget of ${DAY_BUDGET[key].toLocaleString('en-US')}`;
    return { detail: l === QUOTA_LEVELS.hold ? `${what}; the heavy work waits for 00:00 UTC` : what };
  };

export const METER_CHECKS: Partial<Record<WatchdogName, Check>> = {
  'quota.rows_read': check('rows_read'),
  'quota.rows_written': check('rows_written'),
};
