// The mind's session routes (API.md §11.8, RUNTIME.md §4): claim and brief, status (which also
// acknowledges handed-out messages and renews the lease), notes, taint, pending, and each take of
// `GET /v1/live/wait`. All inside a commit, except reads.
import type {
  BriefRequest,
  LiveEvent,
  LiveWaitResponse,
  MindNoteRequest,
  MindRole,
  MindStatusRequest,
  PendingResponse,
} from '../../../../shared/contract/api';
import { uuidv7 } from '../../lib/ids';
import { Fail } from '../../lib/result';
import { HOUR, MINUTE } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import { currentDay } from '../conversation/day';
import * as convo from '../conversation/store';
import * as feed from '../feed/store';
import * as verbs from '../verbs/store';
import { nightDayOf, nightDone } from './night';
import * as sessionNotes from './notes';
import * as stop from './stop';
import * as store from './store';
import { ACK_MS, backoff, clearBackoff, LEASE_MS, leaseLive, setPresence } from './wake';

const RENEW_EVERY_MS = 30_000;
/** How long a taint carries over to the role's new claims, counted from the taint itself. */
export const TAINT_HOLDS_MS = 24 * HOUR;

/** Ids compare after the last `_` (`cse_…` in the VM, `session_…` in the fire response). */
const tail = (id: string | null) => (id ? id.slice(id.lastIndexOf('_') + 1) : null);

export interface Claimed {
  wake: { id: string; reason: string; claim_match: 'exact' | 'loose' | 'manual' } | null;
}

/** `th brief --claim` (RUNTIME.md §4.3). 409 already_live when another chat session holds the
 * lease. Messages shown in the briefing count as handed out (mind Finding 4). A taint lasts 24
 * hours for its role (MEMORY.md §7): the Worker can't tell a session id the mind made up from a
 * new cloud session, so a claim takes over the taint of the role's latest session tainted in the
 * last 24 hours, unless it is the very session the Worker fired after that taint (an exact id
 * match on a wake still open). A loose match can't prove that, so it inherits too. */
export function claim(w: Writer, r: BriefRequest, tz: string): Claimed {
  const { db, at } = w;
  if (r.role === 'chat') {
    const l = store.lease(db, 'chat');
    if (l && l.session_id !== r.session_id && at - l.renewed_at < LEASE_MS) throw new Fail('already_live');
  }
  // The fire whose session id matches, else the newest; every other open wake of the role is
  // settled too, so the alarm never retries a wake this session already answers.
  const openWakes = store.openWakes(db, r.role);
  const open = openWakes.find((o) => o.session_id && tail(o.session_id) === tail(r.session_id)) ?? openWakes[0] ?? null;
  let wake: Claimed['wake'];
  if (open) {
    const match = open.session_id && tail(open.session_id) === tail(r.session_id) ? 'exact' : 'loose';
    for (const o of openWakes)
      store.setWakeStatus(db, o.id, 'claimed', {
        claimed_at: at,
        claim_match: o.id === open.id ? match : 'loose',
        // Only the matched wake takes this session; the others keep their own fire's id.
        ...(o.id === open.id ? { session_id: r.session_id } : {}),
      });
    if (open.retry_of) store.setWakeStatus(db, open.retry_of, 'claimed', { claimed_at: at, claim_match: match });
    wake = { id: open.id, reason: open.reason, claim_match: match };
  } else {
    const id = uuidv7(at);
    store.insertWake(db, { id, at, task: r.role, reason: 'manual' });
    store.setWakeStatus(db, id, 'claimed', { claimed_at: at, claim_match: 'manual', session_id: r.session_id });
    wake = { id, reason: 'manual', claim_match: 'manual' };
  }
  const day = currentDay(db, tz, at);
  const prior = store.taintedSince(db, r.role, at - TAINT_HOLDS_MS);
  const firedAfter =
    open !== null && wake.claim_match === 'exact' && prior !== null && (open.fired_at ?? open.at) > prior.tainted_at;
  store.putSession(db, {
    session_id: r.session_id,
    role: r.role,
    wake_id: wake.id,
    at,
    th_version: r.th_version,
    sha: r.constitution_sha256,
    day,
  });
  // The taint keeps its own time, so a wake fired after it still starts clean however many
  // claims inherited it in between.
  if (prior && !firedAfter)
    store.taintSession(db, {
      id: r.session_id,
      role: r.role,
      day,
      source: `inherited:${prior.taint_source}`,
      at: prior.tainted_at,
    });
  if (r.role === 'chat') {
    store.putLease(db, 'chat', r.session_id, at);
    const waiting = convo.unanswered(db, 30);
    convo.markDelivered(
      db,
      waiting.filter((m) => m.acked_at === null).map((m) => m.id),
      at,
    );
    if (waiting.length) store.sessionSeenOwner(db, r.session_id, waiting.at(-1)?.created_at ?? at);
  }
  // A night with nothing left to do (the 06:07 fallback after the roll's run): its wake ends at
  // once and its briefing says so (`night_done`). The session stays open for `th night start`,
  // which answers done and ends it, or for a missed day's run (`th night start --day <day>`).
  if (r.role === 'night' && nightDone(db, nightDayOf(day)))
    store.setWakeStatus(db, wake.id, 'ended', { ended_at: at, end_reason: 'night_done' });
  // The presence light, the usage backoff and the Stop are the chat session's.
  if (r.role === 'chat') {
    clearBackoff(db, at);
    // A new chat session has no work in progress, so a Stop left standing is moot.
    stop.clear(w);
    setPresence(w, 'working');
  }
  return { wake };
}

/** POST /v1/mind/status. Returns whether the phone should get a typing pulse. The presence light,
 * the lease and the hand-outs are the chat session's; night and reflex report through their own
 * runs (P3, P4), so their status changes nothing here. */
export function status(w: Writer, sessionId: string | null, role: MindRole, r: MindStatusRequest): { typing: boolean } {
  const { db, at } = w;
  if (role !== 'chat') return { typing: false };
  if (sessionId) renew(db, sessionId, at, true);
  if (r.state === 'working') convo.ackHandedOut(db, at);
  if (r.state === 'stopping' && sessionId) {
    store.dropLease(db, 'chat', sessionId);
    store.endSession(db, sessionId, at);
    const s = store.session(db, sessionId);
    if (s?.wake_id)
      store.setWakeStatus(db, s.wake_id, 'ended', { ended_at: at, end_reason: r.error ? 'error' : 'idle' });
    setPresence(w, 'asleep');
    return { typing: false };
  }
  setPresence(w, r.state, r.note ?? null);
  return { typing: r.state === 'working' };
}

export function note(w: Writer, sessionId: string | null, role: MindRole, r: MindNoteRequest): void {
  const body = JSON.stringify(r.open_items);
  const found = sessionNotes.note(w.db, r.id);
  if (found) {
    if (found.body !== r.body || found.open_items_json !== body) throw new Fail('conflict');
    return;
  }
  const s = sessionId ? store.session(w.db, sessionId) : null;
  sessionNotes.putNote(w.db, {
    id: r.id,
    session_id: sessionId,
    wake_id: s?.wake_id ?? null,
    role,
    thread_id: r.thread_id ?? null,
    at: w.at,
    body: r.body,
    open: body,
  });
}

/** Irreversible for the session; enforced from P4, recorded now (API.md §3). A session that never
 * claimed gets its row here, so the mark is never lost. */
export function taint(db: Db, sessionId: string | null, role: MindRole, source: string, at: number, tz: string): void {
  if (!sessionId) throw new Fail('validation', [{ path: 'TH-Session', issue: 'required to mark a session tainted' }]);
  store.taintSession(db, { id: sessionId, role, day: currentDay(db, tz, at), source, at });
}

export function pending(db: Db, sessionId: string | null, role: MindRole, now: number, tz: string): PendingResponse {
  const s = sessionId ? store.session(db, sessionId) : null;
  const wake = s?.wake_id ? store.wake(db, s.wake_id) : null;
  const since = s?.last_owner_at ?? s?.claimed_at ?? now;
  const prewarmOnly = wake?.reason === 'prewarm' && s?.last_owner_at === null;
  return {
    unanswered: role === 'chat' ? convo.unansweredIds(db) : [],
    stop: role === 'chat' && stop.standing(db) !== null,
    day_closed: s !== null && s.day < currentDay(db, tz, now),
    limited: backoff(db).until > now,
    idle_min: Math.floor((now - since) / MINUTE),
    idle_cutoff_min: prewarmOnly ? 10 : 120,
  };
}

/** Renews the chat lease for this session, writing at most every 30 s (DATA.md §4.1). */
function renew(db: Db, sessionId: string, at: number, takeIfFree: boolean): boolean {
  const l = store.lease(db, 'chat');
  if (l && l.session_id === sessionId) {
    if (at - l.renewed_at >= RENEW_EVERY_MS) store.renewLease(db, 'chat', at);
    return true;
  }
  if (takeIfFree && !leaseLive(db, at)) {
    store.putLease(db, 'chat', sessionId, at);
    return true;
  }
  return false;
}

/** One take of GET /v1/live/wait: what changed after `after`, owner messages handed out to the
 * chat session that holds the lease, verb results, and the day-closed signal. */
export function take(w: Writer, since: number, role: MindRole, sessionId: string | null, tz: string): LiveWaitResponse {
  const { db, at } = w;
  // A cursor past the newest change (a restored store, stale local state) would wait forever:
  // start from the newest instead.
  const last = feed.lastSeq(db);
  const after = Math.min(since, last);
  const holds = role === 'chat' && sessionId !== null && renew(db, sessionId, at, true);
  const changes = feed.changesAfter(db, after, 500);
  const kinds = [...new Set(changes.map((c) => c.kind))];
  const messages = holds ? convo.takeOwnerMessages(db, at, ACK_MS, 20) : [];
  if (messages.length && sessionId) store.sessionSeenOwner(db, sessionId, messages.at(-1)?.created_at ?? at);
  const events: LiveEvent[] = [];
  for (const c of changes)
    if (c.kind === 'verb' && c.ref) {
      const st = verbs.statusOf(db, c.ref.slice('verb:'.length));
      if (st === 'done' || st === 'failed') events.push({ type: 'verb.result', ref: c.ref, at: c.at });
    }
  const s = sessionId ? store.session(db, sessionId) : null;
  const signals: LiveWaitResponse['signals'] = s && s.day < currentDay(db, tz, at) ? ['day_closed'] : [];
  const st = role === 'chat' ? stop.standing(db) : null;
  if (st && st.seq > after) signals.push('stop');
  return {
    seq: changes.at(-1)?.seq ?? last,
    changed: changes.length > 0 || messages.length > 0,
    kinds,
    messages,
    events,
    signals,
  };
}
