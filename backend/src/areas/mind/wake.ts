// When the Worker wakes the mind and what it does when a wake goes unanswered (RUNTIME.md §3,
// §4.4, §11): the fire conditions, the 120 s retry and 240 s give-up, requeues of handed-out
// messages nobody acknowledged, the usage backoff, and the presence the phone shows. Everything
// here runs inside a commit; the HTTP fire itself happens after it (fire.ts).
import type { MindPresence, MindRole } from '../../../../shared/contract/api';
import type { MindUse } from '../../../../shared/contract/feed.ts';
import { uuidv7 } from '../../lib/ids';
import { HOUR, MINUTE, SECOND } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import { today } from '../conversation/ops';
import * as convo from '../conversation/store';
import * as settings from '../settings/store';
import * as store from './store';

export const LEASE_MS = 90 * SECOND;
export const FIRE_GAP_MS = 90 * SECOND;
export const RETRY_MS = 120 * SECOND;
export const FAIL_MS = 240 * SECOND;
export const ACK_MS = 120 * SECOND;
const FIRES_PER_HOUR = 20;
const PREWARMS_PER_DAY = 8;
const REQUEUES_IN_A_ROW = 3;
const BACKOFF_MIN = [15, 30, 60, 120];
export const NOT_WAKING = "The mind isn't waking (likely a usage limit or an outage). I'll answer when it's back.";

/** `watch`: a met watch (watches/pulse.ts), which checks its budget and the live lease first. */
export type WakeReason = 'prewarm' | 'message' | 'requeue' | 'watch';
export interface ToFire {
  id: string;
  task: MindRole;
}

export function leaseLive(db: Db, now: number): boolean {
  const l = store.lease(db, 'chat');
  return l !== null && now - l.renewed_at < LEASE_MS;
}

interface Backoff {
  until: number;
  step: number;
}
export function backoff(db: Db): Backoff {
  const b = settings.getSetting(db, 'mind.backoff') as Backoff | undefined;
  return b && typeof b.until === 'number' ? b : { until: 0, step: -1 };
}

/** What a status report says it is doing besides the note: the working card's title and chips. */
export interface Work {
  title?: string;
  using?: MindUse[];
}

/** The presence light's state, written to the setting `mind.status` on every transition. A status
 * report (`work`) that leaves out the title or the chips keeps the ones the session gave while it
 * stays `working`, so the note is the live line under them (HOME.md §4.13); any other state, and
 * the Worker's own transitions (no `work`), drop them. */
export function setPresence(
  w: Writer,
  state: MindPresence['state'],
  note: string | null = null,
  work: Work | null = null,
): void {
  const cur = settings.getSetting(w.db, 'mind.status') as MindPresence | undefined;
  const keep = work !== null && state === 'working' && cur?.state === 'working';
  const given = work !== null && (work.title !== undefined || work.using !== undefined);
  const title = work?.title ?? (keep ? (cur?.title ?? null) : null);
  const using = work?.using ?? (keep ? (cur?.using ?? []) : []);
  const titleAt = given ? w.at : keep ? (cur?.title_at ?? null) : null;
  const same = (cur?.title ?? null) === title && JSON.stringify(cur?.using ?? []) === JSON.stringify(using);
  if (cur && cur.state === state && cur.note === note && same && !given) return;
  // Only a presence with a title or chips carries the fields, so every other one stays as it was.
  const extra = title !== null || using.length ? { title, using, title_at: titleAt } : {};
  const next: MindPresence = { state, note, since: w.at, ...extra };
  settings.putSetting(w.db, 'mind.status', next, 'worker', w.at);
  w.change('mind_status', 'setting:mind.status');
}

/** A chat wake, if every condition of RUNTIME.md §3 holds. `configured` = the mind-chat task's
 * URL and token are set (they hold `none` until SETUP.md K). */
export function maybeWake(w: Writer, reason: WakeReason, configured: boolean): ToFire | null {
  const { db, at } = w;
  // A live session (even one the owner started by hand) needs no wake and keeps its presence.
  if (leaseLive(db, at)) return null;
  if (!configured) {
    setPresence(w, 'unconfigured');
    return null;
  }
  if (backoff(db).until > at) return null;
  if (store.fireCount(db, 'chat', at - HOUR) >= FIRES_PER_HOUR) return null;
  const last = store.lastFireAt(db, 'chat', reason !== 'prewarm');
  if (last !== null && at - last < FIRE_GAP_MS) return null;
  if (reason === 'prewarm' && store.fireCount(db, 'chat', at - 24 * HOUR, 'prewarm') >= PREWARMS_PER_DAY) return null;
  if (reason === 'requeue' && store.fireCount(db, 'chat', at - HOUR, 'requeue') >= REQUEUES_IN_A_ROW) return null;
  const id = uuidv7(at);
  store.insertWake(db, { id, at, task: 'chat', reason });
  setPresence(w, 'waking');
  return { id, task: 'chat' };
}

/** The alarm's work: requeue unacknowledged hand-outs, retry an unclaimed wake once at 120 s,
 * give up at 240 s with the honest line and a backoff. Returns the wakes to fire now. */
export function onAlarm(w: Writer, configured: boolean, tz: string): ToFire[] {
  const { db, at } = w;
  const fires: ToFire[] = [];
  if (convo.requeueUnacked(db, at, ACK_MS) > 0 && !leaseLive(db, at)) {
    const f = maybeWake(w, 'requeue', configured);
    if (f) fires.push(f);
  }
  const open = store.openWakes(db, 'chat');
  // A live session already answers: no retry, no give-up, no honest line. Its holder takes them.
  const lease = store.lease(db, 'chat');
  if (lease && at - lease.renewed_at < LEASE_MS) {
    for (const wk of open)
      store.setWakeStatus(db, wk.id, 'claimed', { claimed_at: at, claim_match: 'loose', session_id: lease.session_id });
    return fires;
  }
  const retried = new Set(open.map((wk) => wk.retry_of));
  for (const wk of open) {
    if (wk.status !== 'fired') continue;
    const age = at - wk.at;
    if (!wk.retry_of && age >= RETRY_MS && !retried.has(wk.id)) {
      store.setWakeStatus(db, wk.id, 'unclaimed');
      if (store.fireCount(db, 'chat', at - HOUR) < FIRES_PER_HOUR) {
        const id = uuidv7(at);
        store.insertWake(db, { id, at, task: 'chat', reason: wk.reason, retry_of: wk.id });
        fires.push({ id, task: 'chat' });
      } else giveUp(w, wk.id, tz);
    } else if (wk.retry_of && age >= FAIL_MS - RETRY_MS) giveUp(w, wk.id, tz, wk.retry_of);
  }
  return fires;
}

function giveUp(w: Writer, id: string, tz: string, original?: string): void {
  store.setWakeStatus(w.db, id, 'failed');
  if (original) store.setWakeStatus(w.db, original, 'failed');
  const b = backoff(w.db);
  const step = Math.min(b.step + 1, BACKOFF_MIN.length - 1);
  settings.putSetting(w.db, 'mind.backoff', { until: w.at + BACKOFF_MIN[step] * MINUTE, step }, 'worker', w.at);
  setPresence(w, 'failed');
  systemLine(w, 'not_waking', NOT_WAKING, tz);
}

/** A system line in today's thread, at most once an hour per kind of line (RUNTIME.md §4.4). */
export function systemLine(w: Writer, line: string, body: string, tz: string): void {
  const last = convo.lastSystemLine(w.db, line);
  if (last !== null && w.at - last < HOUR) return;
  const thread = today(w, tz);
  const m = convo.insertMessage(w.db, {
    id: uuidv7(w.at),
    thread_id: thread.id,
    author: 'system',
    origin: 'system',
    kind: 'text',
    body,
    meta: { line },
    reply_to: null,
    created_at: w.at,
    device_id: null,
    session_id: null,
    req_sha256: '',
  });
  w.change('message', `msg:${m.id}`);
}

/** The fire call's outcome (RUNTIME.md §9 F2): a 429 means no fire until the next hour. */
export function fired(
  w: Writer,
  id: string,
  r: { status: number; session_id: string | null; error: string | null },
): void {
  store.recordFire(w.db, id, r.status, r.session_id, r.error);
  if (r.status === 429)
    settings.putSetting(
      w.db,
      'mind.backoff',
      { until: w.at + HOUR, step: Math.max(backoff(w.db).step, 0) },
      'worker',
      w.at,
    );
}

/** The StopFailure hook's `th status limited` (RUNTIME.md §6.3): the usage backoff for a rate or
 * billing limit, five minutes for any other API error. */
export function limited(w: Writer, error: string | null): void {
  const b = backoff(w.db);
  const usage = error === 'rate_limit' || error === 'billing_error';
  const step = usage ? Math.min(b.step + 1, BACKOFF_MIN.length - 1) : b.step;
  const until = w.at + (usage ? BACKOFF_MIN[step] : 5) * MINUTE;
  settings.putSetting(w.db, 'mind.backoff', { until: Math.max(until, b.until), step }, 'worker', w.at);
  setPresence(w, 'limited');
}

/** A claimed wake (or any owner-facing sign of life) ends the backoff. */
export function clearBackoff(db: Db, at: number): void {
  if (backoff(db).step >= 0) settings.putSetting(db, 'mind.backoff', { until: 0, step: -1 }, 'worker', at);
}

/** When the alarm must next run: the oldest unacknowledged hand-out, or an open wake's retry or
 * give-up time. Null when nothing waits. */
export function nextAlarmAt(db: Db): number | null {
  const times: number[] = [];
  const unacked = convo.oldestUnacked(db);
  if (unacked !== null) times.push(unacked + ACK_MS);
  for (const wk of store.openWakes(db, 'chat'))
    if (wk.status === 'fired') times.push(wk.at + (wk.retry_of ? FAIL_MS - RETRY_MS : RETRY_MS));
  return times.length ? Math.min(...times) : null;
}
