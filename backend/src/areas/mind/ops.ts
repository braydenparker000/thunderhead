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
import { MINUTE } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import { currentDay } from '../conversation/day';
import * as convo from '../conversation/store';
import * as feed from '../feed/store';
import * as verbs from '../verbs/store';
import * as store from './store';
import { ACK_MS, backoff, clearBackoff, LEASE_MS, leaseLive, setPresence } from './wake';

const RENEW_EVERY_MS = 30_000;

/** Ids compare after the last `_` (`cse_…` in the VM, `session_…` in the fire response). */
const tail = (id: string | null) => (id ? id.slice(id.lastIndexOf('_') + 1) : null);

export interface Claimed {
  wake: { id: string; reason: string; claim_match: 'exact' | 'loose' | 'manual' } | null;
}

/** `th brief --claim` (RUNTIME.md §4.3). 409 already_live when another chat session holds the
 * lease. Messages shown in the briefing count as handed out (mind Finding 4). */
export function claim(w: Writer, r: BriefRequest, tz: string): Claimed {
  const { db, at } = w;
  if (r.role === 'chat') {
    const l = store.lease(db, 'chat');
    if (l && l.session_id !== r.session_id && at - l.renewed_at < LEASE_MS) throw new Fail('already_live');
  }
  const open = store.openWakes(db, r.role)[0] ?? null;
  let wake: Claimed['wake'];
  if (open) {
    const match = open.session_id && tail(open.session_id) === tail(r.session_id) ? 'exact' : 'loose';
    store.setWakeStatus(db, open.id, 'claimed', { claimed_at: at, claim_match: match, session_id: r.session_id });
    if (open.retry_of) store.setWakeStatus(db, open.retry_of, 'claimed', { claimed_at: at, claim_match: match });
    wake = { id: open.id, reason: open.reason, claim_match: match };
  } else {
    const id = uuidv7(at);
    store.insertWake(db, { id, at, task: r.role, reason: 'manual' });
    store.setWakeStatus(db, id, 'claimed', { claimed_at: at, claim_match: 'manual', session_id: r.session_id });
    wake = { id, reason: 'manual', claim_match: 'manual' };
  }
  const day = currentDay(db, tz, at);
  store.putSession(db, {
    session_id: r.session_id,
    role: r.role,
    wake_id: wake.id,
    at,
    th_version: r.th_version,
    sha: r.constitution_sha256,
    day,
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
  clearBackoff(db, at);
  setPresence(w, 'working');
  return { wake };
}

/** POST /v1/mind/status. Returns whether the phone should get a typing pulse. */
export function status(w: Writer, sessionId: string | null, role: MindRole, r: MindStatusRequest): { typing: boolean } {
  const { db, at } = w;
  if (sessionId && role === 'chat') renew(db, sessionId, at, true);
  if (r.state === 'working') {
    if (r.thread_id) convo.ackThread(db, r.thread_id, at);
    else for (const t of convo.threadsPage(db, 'open', 5, null)) convo.ackThread(db, t.id, at);
  }
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
  const found = store.note(w.db, r.id);
  if (found) {
    if (found.body !== r.body || found.open_items_json !== body) throw new Fail('conflict');
    return;
  }
  const s = sessionId ? store.session(w.db, sessionId) : null;
  store.putNote(w.db, {
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

/** Irreversible for the session; enforced from P4, recorded now (API.md §3). */
export function taint(db: Db, sessionId: string | null, source: string, at: number): void {
  if (sessionId) store.taintSession(db, sessionId, source, at);
}

export function pending(db: Db, sessionId: string | null, role: MindRole, now: number, tz: string): PendingResponse {
  const s = sessionId ? store.session(db, sessionId) : null;
  const wake = s?.wake_id ? store.wake(db, s.wake_id) : null;
  const since = s?.last_owner_at ?? s?.claimed_at ?? now;
  const prewarmOnly = wake?.reason === 'prewarm' && s?.last_owner_at === null;
  return {
    unanswered: role === 'chat' ? convo.unansweredIds(db) : [],
    stop: false,
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
export function take(w: Writer, after: number, role: MindRole, sessionId: string | null, tz: string): LiveWaitResponse {
  const { db, at } = w;
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
  return {
    seq: Math.max(after, changes.at(-1)?.seq ?? feed.lastSeq(db)),
    changed: changes.length > 0 || messages.length > 0,
    kinds,
    messages,
    events,
    signals,
  };
}
