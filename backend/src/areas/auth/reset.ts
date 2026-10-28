// Setup state and the reset ticket (SIGN-IN.md §4, §10): GET /v1/auth/state, the mind's
// break-glass request, the GitHub path through AUTH_RESET_FP, and cancel from any device.
import type { AuthStateResponse, BreakglassResponse } from '../../../../shared/contract/api';
import { uuidv7 } from '../../lib/ids';
import { DAY, HOUR } from '../../lib/time';
import { type AuthDeps, type Failure, fail, notice, type Result, reserve, throttled } from './flows';
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
 * unless that fingerprint was ever used or a reset is already open. */
export function syncResetFp(d: AuthDeps, now: number): void {
  if (!d.resetFp || !store.hasCredential(d.db)) return;
  if (keys.ticketByFingerprint(d.db, d.resetFp) || keys.openResetTicket(d.db, now)) return;
  d.storage.transactionSync(() => openTicket(d, d.resetFp as string, 'github', now));
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

export function state(d: AuthDeps, fp: string | null, resetFp: string | null): AuthStateResponse {
  const now = Date.now();
  const done = store.hasCredential(d.db);
  const out: AuthStateResponse = { setup: done ? 'done' : 'open' };
  if (fp && !done) out.setup_fp = !d.setupFp ? 'missing' : d.setupFp === fp ? 'ready' : 'mismatch';
  if (resetFp && done) {
    syncResetFp(d, now);
    const t = keys.ticketByFingerprint(d.db, resetFp);
    if (t?.kind === 'reset') {
      out.reset = ticketState(t, now);
      out.usable_after = t.usable_after ?? undefined;
    } else out.reset = 'none';
  }
  return out;
}

/** POST /v1/auth/breakglass from `mind:chat`, with the fingerprint the owner gave in words. */
export async function breakglass(d: AuthDeps, fp: string): Promise<Result<BreakglassResponse>> {
  const now = Date.now();
  if (!store.hasCredential(d.db)) return fail('setup_required');
  syncResetFp(d, now);
  if (keys.openResetTicket(d.db, now)) return fail('reset_already_pending');
  const old = keys.ticketByFingerprint(d.db, fp);
  if (old) return fail(old.cancelled_at ? 'reset_cancelled' : old.used_at ? 'reset_used' : 'reset_expired');
  const refs: [['reset', 'acct']] = [['reset', 'acct']];
  const limited = throttled(d, refs, now);
  if (limited) return limited;
  await reserve(d, refs, now); // counts tickets: 3 in 30 days
  const t = d.storage.transactionSync(() => openTicket(d, fp, 'mind', now));
  return { ok: true, ticket_id: t.id, usable_after: t.usable_after ?? 0, expires_at: t.expires_at ?? 0 };
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

/** Housekeeping for the cron: pick up AUTH_RESET_FP; forget rows that can no longer matter. */
export function prune(d: AuthDeps): { sessions: number; counters: number; notices: number } {
  const now = Date.now();
  syncResetFp(d, now);
  return d.storage.transactionSync(() => ({
    sessions: store.deleteOldSessions(d.db, now - 30 * DAY),
    counters: store.deleteStaleCounters(d.db, now - 2 * DAY),
    notices: keys.deleteOldNotices(d.db, now - 30 * DAY),
  }));
}
