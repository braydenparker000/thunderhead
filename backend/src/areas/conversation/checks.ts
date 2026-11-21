// The conversation's watchdog (OPERATIONS.md §8.2), spread into the registry's checks: an owner
// message unanswered for more than 30 minutes, checked outside quiet hours only (the wake path's
// refires and the backoff's end fire first; this says when they were not enough).
import { WATCHDOG_LIMITS as L } from '../../../../shared/contract/watchdogs.ts';
import { MINUTE } from '../../lib/time';
import { inQuiet, quietWindow } from '../settings/quiet';
import type { Check } from '../watchdogs/checks';
import { oldestUnanswered } from './lapsed';

const replyLate: Check = (db, c) => {
  const since = oldestUnanswered(db);
  if (since === null || c.at - since <= L.reply_late_min * MINUTE || inQuiet(c.at, c.tz, quietWindow(db)))
    return { detail: null };
  return { detail: `an owner message has waited ${Math.floor((c.at - since) / MINUTE)} min for a reply` };
};

export const CONVERSATION_CHECKS = { 'reply.late': replyLate } as const;
