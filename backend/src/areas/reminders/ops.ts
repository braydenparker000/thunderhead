// Reminders the owner sets (HOME.md §6.2, BEHAVIOR.md §3.4 "Owner-set reminders"), inside a
// commit. A reminder is the owner's own words at the owner's own time: from the phone, or from the
// chat mind naming the owner's message that asked (a recent owner-device message, at most 3 from
// one, never from a tainted session), because a reminder's push skips the mind's push budget. A
// time inside quiet hours moves to their end (never before 06:30). At its time the alarm delivers
// it once: a system line in today's thread and, outside quiet hours, a push.
import {
  type PutReminderRequest,
  REMINDER_LIMITS,
  type Reminder,
  type RemindersResponse,
} from '../../../../shared/contract/reminders.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import { DAY, HOUR, MINUTE } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { today } from '../conversation/ops';
import * as convo from '../conversation/store';
import { claimedSession } from '../mind/guards';
import { heldUntil, inQuiet, type QuietWindow, quietWindow } from '../settings/quiet';
import * as store from './store';

/** How far in the past a new reminder's time may be (a slow send of "now"). */
export const PAST_MS = MINUTE;
/** The owner's message a mind names: this recent, and at most this many reminders from one. */
export const SOURCE_MS = 48 * HOUR;
export const PER_MESSAGE = 3;
/** How long a delivered reminder's push may still go (the outbox drops it after). */
export const PUSH_MS = HOUR;
/** Reminders one pass delivers. */
const PER_RUN = 20;
// C0 and C1 controls (newlines and tabs included): a reminder is one plain line.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** When a reminder asked for `at` is delivered: then, or the end of the quiet hours it falls in. */
export const fireAt = (at: number, tz: string, quiet: QuietWindow) => heldUntil(at, tz, quiet);

/** The mind's claimed chat session, clean (as memory writes need it): else 403. */
function cleanSession(w: Writer, c: Caller): void {
  if (claimedSession(w.db, c.session_id, 'chat').tainted) throw new Fail('session_tainted');
}

/** PUT /v1/reminders/:id. The same request again answers the stored reminder; another body under
 * the id is a conflict. */
export function put(
  w: Writer,
  c: Caller,
  id: string,
  r: PutReminderRequest,
  hash: string,
  tz: string,
): { reminder: Reminder; created: boolean } {
  const had = store.byId(w.db, id);
  if (had) {
    if (had.req_sha256 !== hash) throw new Fail('conflict');
    return { reminder: store.shown(had), created: false };
  }
  const mind = c.who === 'C';
  if (!mind && c.who !== 'D') throw new Fail('forbidden');
  if (!mind && r.source_message_id !== undefined) throw invalid('source_message_id', 'only the mind names one');
  if (mind && r.source_message_id === undefined) throw invalid('source_message_id', "the owner's message that asked");
  const text = r.text.trim();
  if (!text) throw invalid('text', 'required');
  if (text.length > REMINDER_LIMITS.text) throw invalid('text', `at most ${REMINDER_LIMITS.text} characters`);
  if (CONTROL.test(text)) throw invalid('text', 'no control characters');
  if (r.at < w.at - PAST_MS) throw invalid('at', 'in the past');
  if (r.at > w.at + REMINDER_LIMITS.days_ahead * DAY)
    throw invalid('at', `at most ${REMINDER_LIMITS.days_ahead} days ahead`);
  if (mind) {
    cleanSession(w, c);
    checkSource(w, r.source_message_id as string);
  }
  if (store.openCount(w.db) >= REMINDER_LIMITS.open)
    throw invalid('id', `at most ${REMINDER_LIMITS.open} reminders set at once`);
  store.insert(w.db, {
    id,
    text,
    at: r.at,
    fire_at: fireAt(r.at, tz, quietWindow(w.db)),
    state: 'set',
    origin: mind ? 'mind' : 'owner_device',
    source_message_id: r.source_message_id ?? null,
    created_at: w.at,
    req_sha256: hash,
  });
  return { reminder: store.shown(store.byId(w.db, id) as store.ReminderRow), created: true };
}

/** The owner's own words: an owner-device message of the last 48 hours, not yet used 3 times. */
function checkSource(w: Writer, id: string): void {
  const m = convo.messageOrigin(w.db, id);
  if (m?.author !== 'owner' || m.origin !== 'owner_device')
    throw invalid('source_message_id', "not one of the owner's messages");
  if (m.created_at < w.at - SOURCE_MS) throw invalid('source_message_id', 'older than 48 hours');
  if (store.fromMessage(w.db, id) >= PER_MESSAGE)
    throw invalid('source_message_id', `at most ${PER_MESSAGE} reminders from one message`);
}

/** GET /v1/reminders: set ones soonest first, then those delivered or taken back in the last day. */
export function list(db: Db, now: number): RemindersResponse {
  return { items: store.list(db, now - DAY).map(store.shown) };
}

/** DELETE /v1/reminders/:id: a set reminder is taken back (the row stays); again is the same
 * answer; one already delivered is gone (410). */
export function cancel(w: Writer, c: Caller, id: string): Reminder {
  const had = store.byId(w.db, id);
  if (!had) throw new Fail('not_found');
  if (c.who === 'C') cleanSession(w, c);
  else if (c.who !== 'D') throw new Fail('forbidden');
  if (had.state === 'done') throw new Fail('expired');
  if (had.state === 'set') store.markCancelled(w.db, id, w.at);
  return store.shown(store.byId(w.db, id) as store.ReminderRow);
}

/** The alarm's pass: every set reminder due by now becomes its line in today's thread, once (the
 * row turns `done` in the same commit). A push is owed unless it is delivered inside quiet hours
 * or `push` is false (the eval sandbox). Returns how many owe a push; past PER_RUN, the alarm
 * comes back at once for the rest. */
export function deliverDue(w: Writer, tz: string, push: boolean): number {
  const owed = push && !inQuiet(w.at, tz, quietWindow(w.db));
  let pushes = 0;
  for (const r of store.due(w.db, w.at, PER_RUN)) {
    const id = uuidv7(w.at);
    if (!store.markDone(w.db, r.id, w.at, id, owed ? w.at + PUSH_MS : null)) continue;
    convo.insertMessage(w.db, {
      id,
      thread_id: today(w, tz).id,
      author: 'system',
      origin: 'system',
      kind: 'text',
      body: r.text,
      meta: { reminder: { id: r.id, at: r.at } },
      reply_to: null,
      created_at: w.at,
      device_id: null,
      session_id: null,
      req_sha256: '',
    });
    w.change('message', `msg:${id}`);
    if (owed) pushes++;
  }
  return pushes;
}
