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
import { MIND_STATUS_LIMITS } from '../../../../shared/contract/feed.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail } from '../../lib/result';
import { HOUR, MINUTE } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import { currentDay, logicalDay } from '../conversation/day';
import { offRecordOf, refuseHeld } from '../conversation/held';
import * as convo from '../conversation/store';
import * as feed from '../feed/store';
import * as verbs from '../verbs/store';
import { claimedSession, markOffRecord, sawOffRecord, taintedNow } from './guards';
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
 * match on a wake still open), or, for the night, a claim on a later day's fired wake once every
 * session holding the taint has ended. A loose match can't prove more, so it inherits too. */
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
    open !== null && wake.claim_match === 'exact' && prior !== null && (open.fired_at ?? open.at) > prior.event_at;
  // The night (MEMORY.md §7, RUNTIME.md §4.3): a claim that binds to a night wake the Worker fired on
  // a later logical day than the taint's starts clean, once every night session holding a taint of
  // the last 24 hours has ended (`th night done`, or the fallback's `th night start`): last night's
  // evals or songs don't hold tonight's memory. A manual claim (the 06:07 schedule's too), a
  // same-day one, or one while a tainted session still lives (it could claim under a new id) inherits.
  const nextNight =
    r.role === 'night' &&
    open !== null &&
    prior !== null &&
    logicalDay(open.fired_at ?? open.at, tz) > logicalDay(prior.event_at, tz) &&
    !store.taintLive(db, r.role, at - TAINT_HOLDS_MS);
  store.putSession(db, {
    session_id: r.session_id,
    role: r.role,
    wake_id: wake.id,
    at,
    th_version: r.th_version,
    sha: r.constitution_sha256,
    day,
  });
  // The taint keeps its event's time and is no event of its own, so a wake fired after it still
  // starts clean however many claims inherited it in between.
  if (prior && !firedAfter && !nextNight)
    store.taintSession(db, {
      id: r.session_id,
      role: r.role,
      day,
      source: `inherited:${prior.taint_source}`,
      at: prior.event_at,
      event: false,
    });
  if (r.role === 'chat') {
    store.putLease(db, 'chat', r.session_id, at);
    // Only the newest chat session writes: the older ones end here (they can't take the lease back).
    store.endOthers(db, 'chat', r.session_id, at);
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

/** Each chat session's last accepted `working` or `listening` report: the same state again within
 * 3 s changes nothing the phone sees (MIND_STATUS_LIMITS.every_ms, HOME.md §4.13). Kept in memory:
 * a Core that restarts forgets it, which only lets one more report through. */
const reported = new Map<string, { at: number; state: string }>();

/** POST /v1/mind/status. Returns whether the phone should get a typing pulse. The presence light,
 * the lease and the hand-outs are the chat session's; night and reflex report through their own
 * runs (P3, P4), so their status changes nothing here. A report inside 3 s of the session's last
 * accepted one in the same state still renews the lease and acknowledges what was handed out (it
 * is the session's housekeeping), but its note, title and chips are dropped. */
export function status(w: Writer, sessionId: string | null, role: MindRole, r: MindStatusRequest): { typing: boolean } {
  const { db, at } = w;
  if (role !== 'chat') return { typing: false };
  if (sessionId) renew(db, sessionId, at, true);
  if (r.state === 'working') convo.ackHandedOut(db, at);
  if (r.state === 'stopping' && sessionId) {
    reported.delete(sessionId);
    store.dropLease(db, 'chat', sessionId);
    store.endSession(db, sessionId, at);
    const s = store.session(db, sessionId);
    if (s?.wake_id)
      store.setWakeStatus(db, s.wake_id, 'ended', { ended_at: at, end_reason: r.error ? 'error' : 'idle' });
    setPresence(w, 'asleep');
    return { typing: false };
  }
  if (r.state === 'working' || r.state === 'listening') {
    const key = sessionId ?? '';
    const last = reported.get(key);
    if (last && last.state === r.state && at - last.at < MIND_STATUS_LIMITS.every_ms) return { typing: false };
    if (reported.size > 64) for (const [k, v] of reported) if (at - v.at > HOUR) reported.delete(k);
    reported.set(key, { at, state: r.state });
  }
  setPresence(w, r.state, r.note ?? null, { title: r.title, using: r.using });
  return { typing: r.state === 'working' };
}

export function note(w: Writer, sessionId: string | null, role: MindRole, r: MindNoteRequest): void {
  const body = JSON.stringify(r.open_items);
  const found = sessionNotes.note(w.db, r.id);
  if (found) {
    if (found.body !== r.body || found.open_items_json !== body) throw new Fail('conflict');
    return;
  }
  // A session note is read by the night: never one about a conversation off the record (403
  // off_record) or a deleted one (410 gone), conversation/held.ts.
  refuseHeld(w.db, r.thread_id, w.at);
  // Nor from a session that was handed a message off the record, whatever thread it names.
  if (sawOffRecord(w.db, sessionId)) throw new Fail('off_record');
  const s = sessionId ? store.session(w.db, sessionId) : null;
  // Written after outside text (MEMORY.md §7): a clean session's briefing and the night's day leave
  // its words out.
  const tainted = taintedNow(w.db, sessionId, role);
  sessionNotes.putNote(w.db, {
    id: r.id,
    session_id: sessionId,
    wake_id: s?.wake_id ?? null,
    role,
    thread_id: r.thread_id ?? null,
    at: w.at,
    body: r.body,
    open: body,
    tainted,
  });
}

/** Irreversible for the session; enforced from P4, recorded now (API.md §3). A session that never
 * claimed gets its row here, so the mark is never lost. */
export function taint(
  db: Db,
  sessionId: string | null,
  role: MindRole,
  source: string,
  at: number,
  tz: string,
  songs = false,
): void {
  if (!sessionId) throw new Fail('validation', [{ path: 'TH-Session', issue: 'required to mark a session tainted' }]);
  // Songs' tags (areas/music/tags-read.ts) go only to a claimed, live session of the role (403
  // session_required otherwise), checked on every read, so a made-up id can't take the taint in its
  // place; a night session's read is also recorded for the web rule (`songs`).
  if (songs) claimedSession(db, sessionId, role);
  store.taintSession(db, { id: sessionId, role, day: currentDay(db, tz, at), source, at, event: true });
  if (songs && role === 'night') store.markSongs(db, sessionId, at);
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
    // The night (RUNTIME.md §6.4): closed once any night session read songs' tags since this one
    // claimed, and for a night call that names no session the Worker knows (fails closed).
    songs: role === 'night' && (s === null || store.songsSince(db, s.claimed_at)),
  };
}

/** Renews the chat lease for this session, writing at most every 30 s (DATA.md §4.1). */
function renew(db: Db, sessionId: string, at: number, takeIfFree: boolean): boolean {
  const l = store.lease(db, 'chat');
  if (l && l.session_id === sessionId) {
    if (at - l.renewed_at >= RENEW_EVERY_MS) store.renewLease(db, 'chat', at);
    return true;
  }
  // Only a session still open may take a lapsed lease back (one a newer claim ended may not).
  if (takeIfFree && !leaseLive(db, at) && store.sessionOpen(db, sessionId)) {
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
  // Messages off the record are handed out (the chat answers them) and named, so it remembers none.
  const offRecord = messages.length ? offRecordOf(db, messages, at) : [];
  // The Worker marks the session it hands them to: from now on it writes no memory (guards.ts).
  if (offRecord.length && sessionId) markOffRecord(db, { id: sessionId, role, day: currentDay(db, tz, at), at });
  return {
    seq: changes.at(-1)?.seq ?? last,
    changed: changes.length > 0 || messages.length > 0,
    kinds,
    messages,
    events,
    signals,
    ...(offRecord.length ? { off_record: offRecord } : {}),
  };
}
