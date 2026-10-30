// The push outbox inside the Auth object (SECURITY.md §10, BEHAVIOR.md §3.4): the mind's nudges,
// the sign-in notices' generic words (SIGN-IN.md §11.3, PRIVACY.md §8), the owner's tests and the
// reminders the owner set wait here, and `deliver` sends what may go now to every signed-in phone
// (a test to its own phone), the payload only a kind and an id. An item is claimed before it is
// sent, so two runs never send it twice; one no push service took goes back to waiting until its
// deadline. A gone subscription (404, 410) is deleted.

import type { ErrorCode } from '../../../../shared/contract/errors';
import type { PushItem, PushKind, PutPushRequest, PutPushResponse } from '../../../../shared/contract/push.ts';
import { uuidv7 } from '../../lib/ids';
import { DAY, MINUTE } from '../../lib/time';
import { sendPush, type Vapid } from '../../lib/webpush';
import type { Db } from '../../objects/base';
import { DEFAULT_DEADLINE_MS, dayStart, mayGo, type PushContext, type ReminderPush, refusal } from './rules';
import * as store from './store';

/** The words of each sign-in notice that pushes, and where a tap opens. */
export const SECURITY: Record<string, { body: string; url: string }> = {
  new_device: { body: 'New sign-in to Thunderhead', url: '/settings/devices/' },
  password_changed: { body: 'Your Thunderhead password was changed', url: '/settings/devices/' },
  reset_pending: { body: 'A password reset was requested for Thunderhead', url: '/settings/devices/' },
  agent_key_created: { body: 'A new agent key was made for Thunderhead', url: '/settings/agents/' },
};

function queue(
  db: Db,
  kind: PushKind,
  words: PushItem,
  at: number,
  deadline: number,
  more: Partial<store.PushRow> = {},
): string {
  const id = more.id ?? uuidv7(at);
  store.insertPush(db, {
    id,
    kind,
    ...words,
    topic_key: more.topic_key ?? null,
    ref: more.ref ?? null,
    why: more.why ?? null,
    hash: more.hash ?? null,
    session_id: more.session_id ?? null,
    created_at: at,
    deadline,
  });
  return id;
}

/** A sign-in notice's push, if its kind has one: it waits only for quiet hours to end (a day at most). */
export function queueSecurity(db: Db, notice: string, now: number): void {
  const w = SECURITY[notice];
  if (w) queue(db, 'security', { title: 'Thunderhead', ...w }, now, now + DAY);
}

export function queueTest(db: Db, sessionId: string, now: number): string {
  return queue(
    db,
    'test',
    { title: 'Thunderhead', body: 'This is a test. Nothing needs you.', url: '/' },
    now,
    now + 10 * MINUTE,
    {
      session_id: sessionId,
    },
  );
}

/** A reminder's push, under the id of the line it became, once: its words never carry the reminder's text
 * (PRIVACY.md §8: the details toggle does not exist yet). */
export const REMINDER: PushItem = { title: 'Thunderhead', body: 'Your reminder.', url: '/' };

export function queueReminder(db: Db, r: ReminderPush): void {
  if (!store.getPush(db, r.id)) queue(db, 'reminder', REMINDER, r.at, r.until, { id: r.id });
}

/** The mind's nudge under its own id: the same request again is the same answer; a refusal is its code. */
export function queueNudge(
  db: Db,
  id: string,
  r: PutPushRequest,
  hash: string,
  ctx: PushContext,
): PutPushResponse | ErrorCode {
  const had = store.getPush(db, id);
  if (had) return had.kind === 'nudge' && had.hash === hash ? { queued_until: had.created_at } : 'conflict';
  const why = refusal(ctx, store.nudgeHistory(db, dayStart(ctx), r.topic_key, ctx.now));
  if (why) return why;
  queue(db, 'nudge', { title: r.title, body: r.body, url: '/' }, ctx.now, r.deadline ?? ctx.now + DEFAULT_DEADLINE_MS, {
    id,
    topic_key: r.topic_key,
    ref: r.ref ?? null,
    why: r.why,
    hash,
  });
  return { queued_until: ctx.now };
}

export function item(db: Db, id: string): PushItem | null {
  const p = store.getPush(db, id);
  return p ? { title: p.title, body: p.body, url: p.url } : null;
}

export interface Sender {
  vapid: Vapid | null;
  /** The site's address: the VAPID `sub`. */
  sub: string;
}

let fetcher: typeof fetch = (...a) => fetch(...a);
/** For tests: the fetch the push services are asked with. */
export function useFetch(f: typeof fetch): void {
  fetcher = f;
}

/** `live`: the signed-in sessions (Auth's own list). */
export async function deliver(db: Db, ctx: PushContext, s: Sender, live: string[]) {
  const out = { sent: [] as string[], dropped: 0, gone: 0 };
  if (!s.vapid) return out;
  for (const r of ctx.reminders ?? []) queueReminder(db, r);
  for (const p of store.waiting(db)) {
    if (ctx.now > p.deadline) {
      store.markDropped(db, p.id, ctx.now);
      out.dropped++;
      continue;
    }
    if (!mayGo(p.kind, ctx)) continue;
    const subs = store.liveSubscriptions(db, live, p.kind === 'test' ? p.session_id : null);
    if (!subs.length) {
      store.markDropped(db, p.id, ctx.now);
      out.dropped++;
      continue;
    }
    // The claim: another run that reaches this item now finds it taken.
    if (!db.all('UPDATE pushes SET sent_at = ? WHERE id = ? AND sent_at IS NULL RETURNING id', ctx.now, p.id).length)
      continue;
    const ttl =
      p.kind === 'nudge' || p.kind === 'reminder'
        ? Math.max(60, Math.round((p.deadline - ctx.now) / 1000))
        : p.kind === 'test'
          ? 600
          : 86_400;
    let took = 0;
    for (const to of subs) {
      let status = 0;
      try {
        status = await sendPush(
          s.vapid,
          to,
          JSON.stringify({ k: p.kind, id: p.id }),
          { sub: s.sub, ttl, urgency: p.kind === 'nudge' ? 'normal' : 'high', now: ctx.now },
          fetcher,
        );
      } catch {
        // The push service is out of reach: the item waits for the next run.
      }
      if (status === 404 || status === 410) out.gone += store.deleteSubscriptions(db, [to.session_id]);
      else if (status >= 200 && status < 300) took++;
    }
    if (took) out.sent.push(p.id);
    else db.run('UPDATE pushes SET sent_at = NULL WHERE id = ?', p.id);
  }
  return out;
}
