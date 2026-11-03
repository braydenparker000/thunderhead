// Gathers the briefing's inputs from the stores (MEMORY.md §9) and renders it (brief.ts). Reads
// only, each bounded; runs after the claim's commit so the briefing reflects it. Memory (rules,
// open threads, the profile, day notes) comes from areas/memory through its own store and renders.
// The night role's day is the one it works on, the day before the open one (RUNTIME.md §12).
import type { BriefResponse, MindRole } from '../../../../shared/contract/api';
import { dayBefore, HOUR } from '../../lib/time';
import type { Db } from '../../objects/base';
import { briefLines, view as calendarView } from '../briefing/calendar-store';
import { currentDay } from '../conversation/day';
import { offRecordOf } from '../conversation/held';
import { dayCounts } from '../conversation/stats';
import * as convo from '../conversation/store';
import * as feed from '../feed/store';
import * as ledger from '../ledger/store';
import * as notes from '../memory/notes';
import { renderProfile } from '../memory/profile';
import * as facts from '../memory/store';
import { quotaBriefLine, safeQuota } from '../meter/quota';
import * as ops from '../ops/store';
import { lawsLine } from '../proposals/laws';
import * as proposals from '../proposals/store';
import { mindSettingLines } from '../settings/catalog';
import { quietUntil } from '../settings/quiet';
import * as watchdogs from '../watchdogs/ops';
import { buildBrief } from './brief';
import { nightDayOf, nightDone, nightLine } from './night';
import * as sessionNotes from './notes';
import * as store from './store';
import { backoff } from './wake';

/** How many current facts a briefing reads at most (newest first), and how many rules. */
const FACTS_READ = 2_000;
const RULES_READ = 200;

export function assemble(
  db: Db,
  role: MindRole,
  tz: string,
  now: number,
  wake: BriefResponse['wake'],
  constitution: string,
  sessionId: string,
  opts: { nightConfigured: boolean; offRecordSeen?: () => void },
): BriefResponse {
  const day = currentDay(db, tz, now);
  const night = role === 'night' ? nightDayOf(day) : null;
  const tainted = (store.session(db, sessionId)?.tainted_at ?? null) !== null;
  const thread = convo.dailyThread(db, day);
  const all = thread ? convo.lastMessages(db, thread.id, 200) : [];
  const tail = all.slice(-12);
  const earlier = all.slice(0, -12);
  const yThread = night
    ? convo.dailyThread(db, night)
    : (convo.threadsPage(db, null, 5, null).find((t) => t.kind === 'daily' && t.day < day) ?? null);
  const yDay = yThread?.day ?? dayBefore(day);
  // Reflex reads no memory (RUNTIME.md §7.1): none of it is even read for its briefing.
  const memory = role !== 'reflex';
  const current = memory ? facts.recentCurrent(db, FACTS_READ) : [];
  // Waiting messages are the only words off the record a briefing shows (the chat must answer
  // them), each marked, with the role-side note (brief.ts); today's, yesterday's and the full
  // file's messages are the daily threads' only, and a deleted thread's waiting ones were settled.
  const waiting = role === 'chat' ? convo.unanswered(db, 30) : [];
  // Messages off the record it hands out mark the session (the caller writes it): no memory from it.
  const offRecord = offRecordOf(db, waiting, now);
  if (offRecord.length) opts.offRecordSeen?.();
  const { core, full } = buildBrief({
    role,
    constitution,
    laws: lawsLine(db, constitution),
    decisions: proposals.waiting(db),
    tainted,
    now,
    tz,
    day: night ?? day,
    wakeReason: wake?.reason ?? null,
    wakesToday: store.wakesToday(db, now - 24 * HOUR),
    prewarmsLeft: Math.max(0, 8 - store.fireCount(db, 'chat', now - 24 * HOUR, 'prewarm')),
    backoffUntil: backoff(db).until,
    quietUntil: quietUntil(db, now),
    threadId: thread?.id ?? null,
    waiting,
    offRecord,
    todayTail: tail,
    todayEarlier: earlier,
    note: memory ? sessionNotes.latestNote(db) : null,
    yesterday: {
      threadId: yThread?.id ?? null,
      tail: yThread ? convo.lastMessages(db, yThread.id, 20) : [],
      note: memory ? notes.dayNote(db, yDay) : null,
      count: night ? dayCounts(db, night).messages : undefined,
    },
    ledger: ledger.since(db, now - 24 * HOUR, 30),
    errorsOpen: ops.countOpenErrors(db),
    watchdogs: watchdogs
      .list(db)
      .filter((w) => w.state === 'tripped')
      .map((w) => ({ name: w.name, since: w.since ?? now, handled: w.handled?.outcome ?? null })),
    quota: quotaBriefLine(safeQuota(db, now)),
    rules: memory ? facts.currentFacts(db, ['rule'], RULES_READ) : [],
    threads: memory ? notes.openThreads(db, 'open', 60) : [],
    profile: memory ? renderProfile(current, now, tz).text : '',
    days: memory ? notes.dayNotes(db, dayBefore(day, 7), dayBefore(day), 7) : [],
    night: nightLine(db, day, opts.nightConfigured),
    settings: mindSettingLines(db),
    // Reflex handles breakage: the owner's day is not its business.
    calendar: role === 'reflex' ? [] : briefLines(calendarView(db, now, tz), tz),
  });
  return {
    wake,
    day: night ?? day,
    seq: feed.lastSeq(db),
    core,
    full,
    night_done: night !== null && nightDone(db, night),
    // What its memory writes are labelled (MEMORY.md §7); `tainted` is its old name, kept one release.
    provenance: tainted ? 'outside' : 'owner',
    tainted,
  };
}
