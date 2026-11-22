// What a check-in session is and may do (checkin.ts; owner, 2026-11-22). A check-in session is a
// night session whose claim bound a wake with the reason `checkin`; for its first 10 minutes it
// may, beyond what any night session may (home lines and tiles, reads), write ONE message from the
// mind into today's conversation: no reply-to, no attachments, no chip, and never a notification
// (it goes into the thread and the change feed only, as a system line does). No other night
// session may. Its briefing is the chat's (the owner, today's conversation, today so far, loose
// ends), never "night already done", with `role_section: "checkin"`. `th checkin done` ends it and
// records the outcome; the cron ends it by itself after 10 minutes (checkin.ts expire).
import type { BriefResponse } from '../../../../shared/contract/api';
import { Fail } from '../../lib/result';
import type { Db } from '../../objects/base';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { today } from '../conversation/ops';
import * as convo from '../conversation/store';
import { CHECKIN_CLAIM_MS, type CheckinRow, checkinByWake, endCheckin } from './checkin';
import * as store from './store';

export interface CheckinSession {
  row: CheckinRow;
  sessionId: string;
  claimedAt: number;
}

/** The check-in this night session claimed, while it has not ended (`live`: also within its 10
 * minutes); null for any other session. */
export function checkinOf(db: Db, sessionId: string | null, now: number, live = true): CheckinSession | null {
  const s = sessionId ? store.session(db, sessionId) : null;
  if (s?.role !== 'night' || s.wake_id === null || s.ended_at !== null) return null;
  const wk = store.wake(db, s.wake_id);
  if (wk?.reason !== 'checkin') return null;
  const row = checkinByWake(db, wk.id);
  if (!row || row.ended_at !== null) return null;
  if (live && now - s.claimed_at >= CHECKIN_CLAIM_MS) return null;
  return { row, sessionId: s.session_id, claimedAt: s.claimed_at };
}

/** Whether a night briefing is a check-in's (assemble.ts then builds the chat's briefing for it). */
export const isCheckin = (db: Db, sessionId: string | null, now: number) => checkinOf(db, sessionId, now) !== null;

/** A check-in's briefing: the chat's content, the check-in's role section, and never night_done. */
export const asCheckin = (out: BriefResponse): BriefResponse & { role_section: 'checkin' } => ({
  ...out,
  night_done: false,
  role_section: 'checkin',
});

/** Whether a check-in may be about to read its briefing (an open check-in wake, or one claimed in
 * the last 10 minutes): Core then reads today's reports for it, not the closed day's. */
export function checkinPending(db: Db, now: number): boolean {
  return (
    db.one(
      `SELECT 1 FROM wakes WHERE task = 'night' AND reason = 'checkin' AND at >= ?
         AND (status IN ('fired', 'unclaimed') OR (status = 'claimed' AND claimed_at >= ?)) LIMIT 1`,
      now - 2 * CHECKIN_CLAIM_MS - 20 * 60_000,
      now - CHECKIN_CLAIM_MS,
    ) !== null
  );
}

const refused = () =>
  new Fail('forbidden', { reason: 'only a check-in session, within 10 minutes of its claim, writes a check-in' });

/** `th checkin say`: the one message. The same id again is the same answer; a second one is 409. */
export function say(
  w: Writer,
  c: Caller,
  r: { id: string; body: string },
  tz: string,
): { message_id: string; thread_id: string } {
  if (c.who !== 'N') throw refused();
  const cs = checkinOf(w.db, c.session_id, w.at);
  if (!cs) throw refused();
  if (cs.row.message_id !== null) {
    if (cs.row.message_id !== r.id) throw new Fail('conflict', { reason: 'one message per check-in' });
    const had = convo.messageById(w.db, r.id);
    return { message_id: r.id, thread_id: had?.thread_id ?? '' };
  }
  if (convo.messageById(w.db, r.id)) throw new Fail('conflict');
  const thread = today(w, tz);
  const m = convo.insertMessage(w.db, {
    id: r.id,
    thread_id: thread.id,
    author: 'mind',
    origin: 'mind',
    kind: 'text',
    body: r.body,
    meta: { checkin: cs.row.slot },
    reply_to: null,
    created_at: w.at,
    device_id: null,
    session_id: cs.sessionId,
    req_sha256: '',
  });
  w.db.run('UPDATE checkins SET message_id = ? WHERE day = ? AND slot = ?', r.id, cs.row.day, cs.row.slot);
  w.change('message', `msg:${m.id}`);
  return { message_id: m.id, thread_id: thread.id };
}

/** `th checkin done [--nothing <why>]`: ends the session and records the outcome. */
export function done(w: Writer, c: Caller, nothing: string | null): { outcome: string; slot: string } {
  if (c.who !== 'N') throw refused();
  const cs = checkinOf(w.db, c.session_id, w.at, false);
  if (!cs) {
    // A retry after the end gets the same answer.
    const s = c.session_id ? store.session(w.db, c.session_id) : null;
    const row = s?.wake_id ? checkinByWake(w.db, s.wake_id) : null;
    if (row && row.ended_at !== null && row.session_id === c.session_id)
      return { outcome: row.outcome, slot: row.slot };
    throw refused();
  }
  const outcome = endCheckin(w.db, cs.row, w.at, nothing ? `nothing: ${nothing}` : null, cs.sessionId);
  return { outcome, slot: cs.row.slot };
}
