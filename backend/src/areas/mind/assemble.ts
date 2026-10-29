// Gathers the briefing's inputs from the stores (MEMORY.md §9) and renders it (brief.ts). Reads
// only, each bounded; runs after the claim's commit so the briefing reflects it. Memory (rules,
// open threads, the profile, day notes) comes from areas/memory through its own store and renders.
import type { BriefResponse, MindRole } from '../../../../shared/contract/api';
import { dayBefore, HOUR } from '../../lib/time';
import type { Db } from '../../objects/base';
import { currentDay } from '../conversation/day';
import * as convo from '../conversation/store';
import * as feed from '../feed/store';
import * as ledger from '../ledger/store';
import * as notes from '../memory/notes';
import { renderProfile } from '../memory/profile';
import * as facts from '../memory/store';
import * as ops from '../ops/store';
import { buildBrief } from './brief';
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
): BriefResponse {
  const day = currentDay(db, tz, now);
  const tainted = (store.session(db, sessionId)?.tainted_at ?? null) !== null;
  const thread = convo.dailyThread(db, day);
  const all = thread ? convo.lastMessages(db, thread.id, 200) : [];
  const tail = all.slice(-12);
  const earlier = all.slice(0, -12);
  const yThread = convo.threadsPage(db, null, 5, null).find((t) => t.kind === 'daily' && t.day < day) ?? null;
  const yDay = yThread?.day ?? dayBefore(day);
  // Reflex reads no memory (RUNTIME.md §7.1): none of it is even read for its briefing.
  const memory = role !== 'reflex';
  const current = memory ? facts.recentCurrent(db, FACTS_READ) : [];
  const { core, full } = buildBrief({
    role,
    constitution,
    tainted,
    now,
    tz,
    day,
    wakeReason: wake?.reason ?? null,
    wakesToday: store.wakesToday(db, now - 24 * HOUR),
    prewarmsLeft: Math.max(0, 8 - store.fireCount(db, 'chat', now - 24 * HOUR, 'prewarm')),
    backoffUntil: backoff(db).until,
    threadId: thread?.id ?? null,
    waiting: role === 'chat' ? convo.unanswered(db, 30) : [],
    todayTail: tail,
    todayEarlier: earlier,
    note: memory ? store.latestNote(db) : null,
    yesterday: {
      threadId: yThread?.id ?? null,
      tail: yThread ? convo.lastMessages(db, yThread.id, 20) : [],
      note: memory ? notes.dayNote(db, yDay) : null,
    },
    ledger: ledger.since(db, now - 24 * HOUR, 30),
    errorsOpen: ops.countOpenErrors(db),
    rules: memory ? facts.currentFacts(db, ['rule'], RULES_READ) : [],
    threads: memory ? notes.openThreads(db, 'open', 60) : [],
    profile: memory ? renderProfile(current, now, tz).text : '',
    days: memory ? notes.dayNotes(db, dayBefore(day, 7), dayBefore(day), 7) : [],
    night: null,
  });
  return { wake, day, seq: feed.lastSeq(db), core, full, night_done: false, tainted };
}
