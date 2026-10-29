// Muse's watchdog (OPERATIONS.md §8.2, MUSE.md §9): no call from Muse for 26 hours, once it has
// called at all. It wakes nobody: the Briefing page says so plainly.
import { WORK_LIMITS } from '../../../../shared/contract/work.ts';
import { HOUR } from '../../lib/time';
import type { Check } from '../watchdogs/checks';
import { seen } from './ops';

const museSilent: Check = (db, c) => {
  const s = seen(db);
  if (!s) return { detail: null };
  const h = Math.floor((c.at - s.last) / HOUR);
  return { detail: c.at - s.last > WORK_LIMITS.silent_h * HOUR ? `no call from Muse for ${h} hours` : null };
};

export const WORK_CHECKS = { 'muse.silent': museSilent } as const;
