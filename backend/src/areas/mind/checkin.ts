// The check-ins (owner, 2026-11-22): besides the night's morning note, the mind wakes by itself one
// or two times a day to leave a note in the chat or a line on home, never a notification. The
// setting `mind.checkins` (0, 1, 2; default 2) names the slots in the owner's zone: one at 15:00,
// two at 12:30 and 18:30. Each cron tick fires a due slot once, at most 90 minutes late; past that
// it is skipped for the day. A slot is skipped, with why, in quiet hours or "go quiet", while
// speech is silent, while the mind is limited or held, while a chat session is live or the owner
// wrote in the last 60 minutes, while the night is running, or once the hour's or the day's fire
// cap is reached; a skip inside the 90 minutes is looked at again on the next tick. A check-in runs
// on the night routine (the cheaper model): a night wake with the reason `checkin`
// (checkin-session.ts has what that session may do; its record is Core step 53, migrations.ts). The same tick ends what is over: a claim
// after 10 minutes, a wake nobody claimed after 30.

import { uuidv7 } from '../../lib/ids';
import { HOUR, MINUTE, ownerDay, zonedMinute } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import { currentDay } from '../conversation/day';
import { latestOwnerMessage } from '../conversation/stats';
import * as convo from '../conversation/store';
import { page as ledgerPage } from '../ledger/store';
import { inQuiet, quietUntil, quietWindow } from '../settings/quiet';
import { getSetting } from '../settings/store';
import { capFreeAt } from './hold';
import { arrangeState } from './night';
import { speechPosition } from './speech';
import * as store from './store';
import { backoff, leaseLive, type ToFire } from './wake';

/** The slots, minutes of the owner's local day, by the setting's value. */
export const CHECKIN_SLOTS: Record<string, number[]> = { '0': [], '1': [15 * 60], '2': [12 * 60 + 30, 18 * 60 + 30] };
export const CHECKIN_LATE_MS = 90 * MINUTE;
export const CHECKIN_OWNER_MS = 60 * MINUTE;
/** A check-in's claim ends after this; a wake nobody claimed fails after `CHECKIN_UNCLAIMED_MS`. */
export const CHECKIN_CLAIM_MS = 10 * MINUTE;
export const CHECKIN_UNCLAIMED_MS = 30 * MINUTE;
/** The fire caps a check-in respects: the chat's 20 fires an hour, and every wake of the last 24 hours. */
export const CHECKIN_CAPS = { hour: 20, day: 80 } as const;
/** How long an unclaimed night wake counts as the night still coming (night.ts's own window). */
const NIGHT_OPEN_MS = 12 * HOUR;

export type CheckinSkip =
  | 'late'
  | 'unconfigured'
  | 'quiet'
  | 'silent'
  | 'limited'
  | 'chat_live'
  | 'owner_recent'
  | 'night'
  | 'cap_hour'
  | 'cap_day';
export type CheckinOutcome = 'fired' | 'said' | 'lines' | 'nothing' | 'timeout' | 'unclaimed' | 'skipped';

export interface CheckinRow {
  day: string;
  slot: string;
  due_at: number;
  at: number;
  fired_at: number | null;
  wake_id: string | null;
  session_id: string | null;
  outcome: CheckinOutcome;
  why: string | null;
  message_id: string | null;
  ended_at: number | null;
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** The owner's slots for today, as `HH:MM` and minutes. */
export function slotsOf(db: Db): { slot: string; minute: number }[] {
  const v = String(getSetting(db, 'mind.checkins') ?? '2');
  return (CHECKIN_SLOTS[v] ?? CHECKIN_SLOTS['2']).map((minute) => ({ slot: hhmm(minute), minute }));
}

export const checkinRow = (db: Db, day: string, slot: string) =>
  db.one<CheckinRow>('SELECT * FROM checkins WHERE day = ? AND slot = ?', day, slot);

export const checkinByWake = (db: Db, wakeId: string) =>
  db.one<CheckinRow>('SELECT * FROM checkins WHERE wake_id = ?', wakeId);

function record(db: Db, r: Pick<CheckinRow, 'day' | 'slot' | 'due_at' | 'at' | 'outcome'> & Partial<CheckinRow>) {
  db.run(
    `INSERT INTO checkins (day, slot, due_at, at, fired_at, wake_id, outcome, why) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (day, slot) DO UPDATE SET at = excluded.at, fired_at = excluded.fired_at, wake_id = excluded.wake_id,
       outcome = excluded.outcome, why = excluded.why`,
    r.day,
    r.slot,
    r.due_at,
    r.at,
    r.fired_at ?? null,
    r.wake_id ?? null,
    r.outcome,
    r.why ?? null,
  );
}

/** How a check-in ends: what the session did (a message, a home line or tile, nothing), and why. */
export function endCheckin(db: Db, row: CheckinRow, at: number, why: string | null, sessionId: string | null): string {
  const lines =
    sessionId !== null &&
    row.fired_at !== null &&
    // The night key's rows since it fired: no other night session runs beside a check-in (skipWhy).
    ledgerPage(db, null, 1, { since: row.fired_at, actor: 'mind:night', status: null, kind: null }).length > 0;
  const outcome = row.message_id ? 'said' : lines ? 'lines' : why === 'timeout' ? 'timeout' : 'nothing';
  db.run(
    'UPDATE checkins SET outcome = ?, why = ?, ended_at = ?, session_id = coalesce(?, session_id) WHERE day = ? AND slot = ?',
    outcome,
    why,
    at,
    sessionId,
    row.day,
    row.slot,
  );
  if (sessionId) store.endSession(db, sessionId, at);
  if (row.wake_id) store.setWakeStatus(db, row.wake_id, 'ended', { ended_at: at, end_reason: 'checkin_done' });
  return outcome;
}

/** Why a due slot can't fire now, or null. Cheapest reads first. */
export function skipWhy(db: Db, at: number, tz: string, configured: boolean): CheckinSkip | null {
  if (!configured) return 'unconfigured';
  if (inQuiet(at, tz, quietWindow(db)) || quietUntil(db, at) > 0) return 'quiet';
  if (speechPosition(db) === 'silent') return 'silent';
  const presence = (getSetting(db, 'mind.status') as { state?: string } | undefined)?.state;
  const held = (getSetting(db, 'mind.held') as { until?: number } | undefined)?.until ?? 0;
  if (backoff(db).until > at || held > at || presence === 'limited') return 'limited';
  if (leaseLive(db, at)) return 'chat_live';
  const today = currentDay(db, tz, at);
  const thread = convo.dailyThread(db, today);
  const owner = thread ? latestOwnerMessage(db, thread.id) : null;
  if (owner && owner.created_at > at - CHECKIN_OWNER_MS) return 'owner_recent';
  const nightOpen = store.openWakes(db, 'night').some((w) => w.reason !== 'checkin' && at - w.at < NIGHT_OPEN_MS);
  if (nightOpen || arrangeState(db, today, at) === 'working') return 'night';
  if (capFreeAt(db, at, CHECKIN_CAPS.hour) !== null) return 'cap_hour';
  if (store.wakesToday(db, at - 24 * HOUR) >= CHECKIN_CAPS.day) return 'cap_day';
  return null;
}

/** Ends what is over: a check-in claim after 10 minutes (`timeout` unless it said or set a line),
 * a wake nobody claimed after 30 (`unclaimed`, and the wake failed). */
export function expire(w: Writer): void {
  const { db, at } = w;
  const open = db.all<CheckinRow>("SELECT * FROM checkins WHERE outcome = 'fired' AND due_at >= ?", at - 2 * 24 * HOUR);
  for (const row of open) {
    const wk = row.wake_id ? store.wake(db, row.wake_id) : null;
    if (wk?.status === 'claimed' && wk.claimed_at !== null) {
      if (at - wk.claimed_at >= CHECKIN_CLAIM_MS) endCheckin(db, row, at, 'timeout', wk.session_id);
    } else if (!wk || at - (row.fired_at ?? row.at) >= CHECKIN_UNCLAIMED_MS) {
      db.run(
        "UPDATE checkins SET outcome = 'unclaimed', ended_at = ? WHERE day = ? AND slot = ?",
        at,
        row.day,
        row.slot,
      );
      if (wk && (wk.status === 'fired' || wk.status === 'unclaimed')) store.setWakeStatus(db, wk.id, 'failed');
    }
  }
}

/** The cron's tick (inside a commit): ends what is over, then fires the first due slot of the
 * owner's day that has not fired, or records why not. Returns the wake to fire after the commit. */
export function checkinTick(w: Writer, configured: boolean, tz: string): ToFire | null {
  const { db, at } = w;
  expire(w);
  const day = ownerDay(at, tz);
  for (const { slot, minute } of slotsOf(db)) {
    const due = zonedMinute(day, minute, tz);
    if (at < due) continue;
    const had = checkinRow(db, day, slot);
    if (had && had.outcome !== 'skipped') continue;
    if (at - due > CHECKIN_LATE_MS) {
      if (!had) record(db, { day, slot, due_at: due, at, outcome: 'skipped', why: 'late' });
      continue;
    }
    const why = skipWhy(db, at, tz, configured);
    if (why) {
      record(db, { day, slot, due_at: due, at, outcome: 'skipped', why });
      continue;
    }
    const id = uuidv7(at);
    store.insertWake(db, { id, at, task: 'night', reason: 'checkin' });
    record(db, { day, slot, due_at: due, at, fired_at: at, wake_id: id, outcome: 'fired' });
    return { id, task: 'night' };
  }
  return null;
}
