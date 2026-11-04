// The speech setting in the Worker (BEHAVIOR.md §3.7, shared/contract/lands.ts): `mind.speech` is
// "as needed" by default, which holds nothing back (the voice ladder, nudge_repeat, the push budget
// and what lands govern). The two restrictive positions are held at the mind's three unprompted
// writes: `quiet` takes at most 1 home line change and 1 card a day (the owner's day) and a push only
// for what the owner asked for; `silent` takes no home line, tile, card or push at all. A write that
// names the owner's own words asking for it (`asked_by`: their message from a device in the last 48
// hours, from a session that read no outside text) is a reply, never held back and never counted.
// Reminders are the owner's own and ring in every position. One settings row read; the day's counts
// only while quiet.
import {
  ASKED_HOURS,
  SPEECH_POSITIONS,
  SPEECH_QUIET,
  type SpeechPosition,
  type SpeechSpent,
  type SpeechWrite,
} from '../../../../shared/contract/lands.ts';
import { Fail, invalid } from '../../lib/result';
import { HOUR, ownerDay, zonedMinute } from '../../lib/time';
import type { Db } from '../../objects/base';
import { type Caller, isMind } from '../../objects/caller';
import * as convo from '../conversation/store';
import { speechSpentSince } from '../ledger/store';
import { getSetting } from '../settings/store';
import { taintedNow } from './guards';

const ROLE = { C: 'chat', N: 'night', R: 'reflex' } as const;

/** The owner's position, or the default while unset (or set to something no longer allowed). */
export function speechPosition(db: Db): SpeechPosition {
  const v = getSetting(db, 'mind.speech');
  return (SPEECH_POSITIONS as readonly unknown[]).includes(v) ? (v as SpeechPosition) : 'as_needed';
}

/** What the day has spent: the mind's home line puts and cards not asked for, since the owner's day began. */
export const spentToday = (db: Db, now: number, tz: string) =>
  speechSpentSince(db, zonedMinute(ownerDay(now, tz), 0, tz));

/** The position and, while quiet, what is spent (section 1 of the briefing; a refusal's details). */
export function speechState(db: Db, now: number, tz: string): SpeechSpent {
  const speech = speechPosition(db);
  return { speech, ...(speech === 'quiet' ? spentToday(db, now, tz) : { lines: 0, cards: 0 }) };
}

/** `asked_by` checked: the owner's own message from a device, in the last 48 hours. Returns whether
 * it counts as asked: not from a session that read outside text (its words could be anyone's). */
export function asked(db: Db, c: Caller, id: string | undefined, now: number): boolean {
  if (id === undefined) return false;
  const m = convo.messageOrigin(db, id);
  if (m?.author !== 'owner' || m.origin !== 'owner_device')
    throw invalid('asked_by', "not one of the owner's messages");
  if (m.created_at < now - ASKED_HOURS * HOUR || m.created_at > now)
    throw invalid('asked_by', `older than ${ASKED_HOURS} hours`);
  const role = ROLE[c.who as keyof typeof ROLE];
  return !!role && !taintedNow(db, c.session_id, role);
}

/** Before the mind's unprompted write: nothing for anyone but the mind, nothing while "as needed",
 * nothing for a write the owner asked for (`asked` above, checked first); else 422 `speech_budget`
 * with what is spent. */
export function speechGate(db: Db, c: Caller, write: SpeechWrite, wasAsked: boolean, now: number, tz: string): void {
  if (!isMind(c) || wasAsked) return;
  const speech = speechPosition(db);
  if (speech === 'as_needed') return;
  const spent = speech === 'quiet' ? spentToday(db, now, tz) : { lines: 0, cards: 0 };
  const over =
    speech === 'silent' ||
    write === 'push' ||
    (write === 'line' && spent.lines >= SPEECH_QUIET.lines) ||
    (write === 'card' && spent.cards >= SPEECH_QUIET.cards);
  if (over) throw new Fail('speech_budget', { speech, spent });
}
