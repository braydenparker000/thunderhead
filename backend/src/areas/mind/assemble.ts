// Gathers the briefing's inputs from the stores (MEMORY.md §9) and renders it (brief.ts). Reads
// only; runs after the claim's commit so the briefing reflects it.
import type { BriefResponse, MindRole } from '../../../../shared/contract/api';
import { HOUR } from '../../lib/time';
import type { Db } from '../../objects/base';
import { currentDay } from '../conversation/day';
import * as convo from '../conversation/store';
import * as feed from '../feed/store';
import * as ledger from '../ledger/store';
import * as ops from '../ops/store';
import { buildBrief } from './brief';
import * as store from './store';
import { backoff } from './wake';

export function assemble(db: Db, role: MindRole, tz: string, now: number, wake: BriefResponse['wake']): BriefResponse {
  const day = currentDay(db, tz, now);
  const thread = convo.dailyThread(db, day);
  const all = thread ? convo.lastMessages(db, thread.id, 200) : [];
  const tail = all.slice(-12);
  const earlier = all.slice(0, -12);
  const yThread = convo.threadsPage(db, null, 5, null).find((t) => t.kind === 'daily' && t.day < day) ?? null;
  const { core, full } = buildBrief({
    role,
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
    note: store.latestNote(db),
    yesterday: { threadId: yThread?.id ?? null, tail: yThread ? convo.lastMessages(db, yThread.id, 20) : [] },
    ledger: ledger.since(db, now - 24 * HOUR, 30),
    errorsOpen: ops.countOpenErrors(db),
  });
  return { wake, day, seq: feed.lastSeq(db), core, full, night_done: false };
}
