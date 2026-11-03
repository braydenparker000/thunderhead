// Scheduled actions (API.md §11.11 "Scheduled actions", MIND-PLAN §3.5): a verb or a plan queued
// with `fire_at` (ISO, owner-local or with its offset, within the next 7 days) waits as a
// `scheduled` row: no phone sees it, no ledger row is written yet, and at most 20 wait at once
// (429 `too_many_scheduled`). Its permit is checked when it is queued (an `ask` needs its card
// then, for exactly that call and time) and kept on the row; the Core alarm runs it at its time
// (due.ts) through the same path as at once (run.ts), and its ledger row, written then, names when
// it was queued. Until then it is taken back with `POST /v1/verbs/:id/cancel`, which is its undo;
// after, the verb's own undo applies. Music and podcasts never fire inside quiet hours: one due
// then fires at their end, and the answer says `shifted`. A verb that rests on the asking session
// (`now_only`: the owner's words, a clean chat session) is never scheduled.
import type { Actor, Verb } from '../../../../shared/contract/api';
import { permitOf } from '../../../../shared/contract/permits.ts';
import { QUIET_HELD, SCHEDULE_LIMITS } from '../../../../shared/contract/schedules.ts';
import { verbSpec } from '../../../../shared/contract/verbs.ts';
import { Fail, invalid } from '../../lib/result';
import { DAY, HOUR, MINUTE, ownerDay, wallMinute, zonedMinute } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { heldUntil, quietWindow } from '../settings/quiet';
import type { Call } from './run';
import * as store from './store';

const FIRE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/;

/** `fire_at` → ms: as written when it carries an offset or `Z`; else the owner's wall clock then. */
export function fireMs(s: string, tz: string): number {
  const m = FIRE.exec(s);
  const day = m?.[1] ?? '';
  const real = m !== null && new Date(`${day}T00:00:00Z`).toISOString().startsWith(day);
  if (!m || !real || Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4] ?? 0) > 59)
    throw invalid('fire_at', 'an ISO time, owner-local or with its offset (2026-11-03T18:00)');
  if (m[6]) return Date.parse(s);
  const ms = Number(m[4] ?? 0) * 1000 + Number((m[5] ?? '0').padEnd(3, '0'));
  return zonedMinute(day, Number(m[2]) * 60 + Number(m[3]), tz) + ms;
}

/** A scheduled action's time (ms), checked before it is gated: no `now_only` verb among it, in the
 * next 7 days (a minute late is a slow send of "now"), and fewer than 20 already waiting. */
export function when(w: Writer, verbs: readonly string[], fireAt: string, tz: string): number {
  for (const [i, v] of verbs.entries())
    if (verbSpec(v)?.now_only)
      throw invalid(verbs.length > 1 ? `steps.${i}.verb` : 'fire_at', `${v} runs only as it is asked, never later`);
  const at = fireMs(fireAt, tz);
  if (at < w.at - MINUTE) throw invalid('fire_at', 'in the past');
  if (at > w.at + SCHEDULE_LIMITS.days_ahead * DAY)
    throw invalid('fire_at', `within the next ${SCHEDULE_LIMITS.days_ahead} days`);
  if (store.scheduledCount(w.db) >= SCHEDULE_LIMITS.pending) throw new Fail('too_many_scheduled');
  return at;
}

/** Whether a class among these verbs waits out quiet hours (music, podcasts). */
export const quietHeld = (verbs: readonly string[]) =>
  verbs.some((v) => {
    const cls = permitOf(v)?.class;
    return cls !== undefined && QUIET_HELD.includes(cls);
  });

/** When it fires: its time, or for music and podcasts the end of the quiet hours it falls in. */
export function held(w: Writer, verbs: readonly string[], at: number, tz: string): number {
  return quietHeld(verbs) ? heldUntil(at, tz, quietWindow(w.db)) : at;
}

/** A verb waiting for its time: its row, with the why and position its ledger row will carry. A
 * Worker-side one "expires" as it fires; a phone one's expiry counts from then (24 h by default). */
export function queue(w: Writer, c: Caller, x: Call, side: 'worker' | 'phone', fire: number): void {
  store.insert(w.db, {
    id: x.id,
    created_at: w.at,
    actor: c.actor,
    verb: x.verb,
    schema: x.schema,
    ref: x.ref,
    args_json: JSON.stringify(x.args),
    device_id: x.device_id,
    expires_at: side === 'worker' ? fire : (x.expires_at ?? fire + 24 * HOUR),
    proposal_id: x.proposal_id,
    ledger_id: null,
    req_sha256: x.hash,
    status: 'scheduled',
    fire_at: fire,
    why: x.why,
    permit: x.position,
  });
  w.change('verb', `verb:${x.id}`);
}

/** POST /v1/verbs/:id/cancel: a scheduled verb or plan taken back before it runs (its undo until
 * then). The owner cancels any; the mind its own. Again: the same answer; once it ran, 409. */
export function cancel(w: Writer, c: Caller, id: string): Verb {
  const row = store.byId(w.db, id);
  if (!row) throw new Fail('not_found');
  if (c.who !== 'D' && row.actor !== c.actor) throw new Fail('forbidden', { reason: 'the mind cancels its own only' });
  if (row.status === 'cancelled') return store.toVerb(row);
  if (row.status !== 'scheduled') throw new Fail('already_decided', { reason: 'it ran already: undo its ledger row' });
  store.cancel(w.db, id, w.at);
  w.change('verb', `verb:${id}`);
  return store.toVerb(store.byId(w.db, id) as store.VerbRow);
}

/** GET /v1/verbs/scheduled: what waits, soonest first. */
export const list = (db: Db): Verb[] => store.scheduled(db).map(store.toVerb);

/** "2026-11-03 18:00" in the owner's zone: when a scheduled row was queued, for its ledger row. */
export function localTime(at: number, tz: string): string {
  const m = wallMinute(at, tz);
  return `${ownerDay(at, tz)} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const WHO: Record<string, Caller['who']> = { owner: 'D', 'mind:chat': 'C', 'mind:night': 'N', 'mind:reflex': 'R' };

/** Who a scheduled row runs as when its time comes: whoever queued it, with no session (the one
 * that asked is long over; nothing a scheduled verb runs needs it, `now_only` saw to that). */
export const callerOf = (actor: string): Caller => ({
  actor: actor as Actor,
  who: WHO[actor] ?? 'C',
  session_id: null,
  device_id: null,
});
