// Setup state and the reset ticket (SIGN-IN.md §4, §10): GET /v1/auth/state, the GitHub path
// through AUTH_RESET_FP (the only way to open a ticket: the mind can't, owner 2026-11-21), and
// cancel from any device.

import type { AuthStateResponse } from '../../../../shared/contract/api';
import { uuidv7 } from '../../lib/ids';
import { DAY, HOUR } from '../../lib/time';
import { pruneOld } from '../push/store';
import { type AuthDeps, type Failure, fail, notice, type Result } from './flows';
import * as store from './store';
import * as keys from './store-keys';

export const RESET_WAIT = 24 * HOUR;
export const RESET_LIFETIME = 72 * HOUR;

type TicketState = 'pending' | 'ready' | 'cancelled' | 'expired' | 'used';

function ticketState(t: keys.TicketRow, now: number): TicketState {
  if (t.cancelled_at) return 'cancelled';
  if (t.used_at) return 'used';
  if ((t.expires_at ?? 0) <= now) return 'expired';
  return (t.usable_after ?? 0) > now ? 'pending' : 'ready';
}

function openTicket(d: AuthDeps, fp: string, source: keys.TicketRow['source'], now: number): keys.TicketRow {
  const t: keys.TicketRow = {
    id: uuidv7(now),
    kind: 'reset',
    fingerprint: fp,
    source,
    requested_at: now,
    usable_after: now + RESET_WAIT,
    expires_at: now + RESET_WAIT + RESET_LIFETIME,
    used_at: null,
    cancelled_at: null,
  };
  keys.insertTicket(d.db, t);
  // Every active session sees it (no session_id), red on Home until acted on.
  notice(d, 'reset_pending', null, { ticket_id: t.id, usable_after: t.usable_after }, now, null);
  return t;
}

/** The GitHub path: a new AUTH_RESET_FP value opens a ticket the first time Auth sees it,
 * unless that fingerprint was ever used or a reset is already open. True when it opened one, so
 * the caller writes a `notice` change and an open home shows the card at once. */
export function syncResetFp(d: AuthDeps, now: number): boolean {
  if (!d.resetFp || !store.hasCredential(d.db)) return false;
  if (keys.ticketByFingerprint(d.db, d.resetFp) || keys.openResetTicket(d.db, now)) return false;
  d.storage.transactionSync(() => openTicket(d, d.resetFp as string, 'github', now));
  return true;
}

/** For /recover with a reset code: the ready ticket, a failure saying why it can't be used, or
 * null when no reset ticket has this fingerprint. */
export function resetTicketFor(d: AuthDeps, fp: string, now: number): ({ ok: true; id: string } | Failure) | null {
  const t = keys.ticketByFingerprint(d.db, fp);
  if (t?.kind !== 'reset') return null;
  const state = ticketState(t, now);
  if (state === 'ready') return { ok: true, id: t.id };
  if (state === 'pending') return fail('reset_not_ready', { usable_after: t.usable_after ?? 0 });
  return fail(state === 'cancelled' ? 'reset_cancelled' : state === 'used' ? 'reset_used' : 'reset_expired');
}

/** `noticed` (never sent) says this call opened the GitHub path's ticket. */
export type StateResult = AuthStateResponse & { noticed?: true };

export function state(d: AuthDeps, fp: string | null, resetFp: string | null): StateResult {
  const now = Date.now();
  const done = store.hasCredential(d.db);
  const out: StateResult = { setup: done ? 'done' : 'open' };
  if (fp && !done) out.setup_fp = !d.setupFp ? 'missing' : d.setupFp === fp ? 'ready' : 'mismatch';
  if (resetFp && done) {
    if (syncResetFp(d, now)) out.noticed = true;
    const t = keys.ticketByFingerprint(d.db, resetFp);
    if (t?.kind === 'reset') {
      out.reset = ticketState(t, now);
      out.usable_after = t.usable_after ?? undefined;
    } else out.reset = 'none';
  }
  return out;
}

/** Cancel from any signed-in device: the ticket and its fingerprint are void for good. */
export function cancel(d: AuthDeps, ticketId: string, label: string, sessionId: string): Result<object> {
  const now = Date.now();
  const t = keys.ticketById(d.db, ticketId);
  if (t?.kind !== 'reset') return fail('not_found');
  const s = ticketState(t, now);
  if (s !== 'pending' && s !== 'ready')
    return fail(s === 'cancelled' ? 'reset_cancelled' : s === 'used' ? 'reset_used' : 'reset_expired');
  d.storage.transactionSync(() => {
    keys.cancelTicket(d.db, t.id, now);
    keys.ackTicketNotices(d.db, t.id, now);
    notice(d, 'reset_cancelled', sessionId, { label, at: now, ticket_id: t.id }, now, 7);
  });
  return { ok: true };
}

/** What the cron's tidy-up did; `reset_opened` 1 when it opened the GitHub path's ticket. */
export interface Pruned {
  reset_opened: number;
  sessions: number;
  counters: number;
  notices: number;
  pushes: number;
}

/** Housekeeping for the cron: pick up AUTH_RESET_FP; forget rows that can no longer matter. */
export function prune(d: AuthDeps): Pruned {
  const now = Date.now();
  const reset_opened = syncResetFp(d, now) ? 1 : 0;
  return d.storage.transactionSync(() => ({
    reset_opened,
    sessions: store.deleteOldSessions(d.db, now - 30 * DAY),
    counters: store.deleteStaleCounters(d.db, now - 2 * DAY),
    notices: keys.deleteOldNotices(d.db, now - 30 * DAY),
    pushes: pruneOld(d.db, now - 30 * DAY),
  }));
}
