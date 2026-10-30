// The 15-minute cron: Core's tick (the day roll after 60 quiet minutes and the night shift's fire
// it starts, expiring verbs and decision cards, and the daily prune pass over every table's
// retention), the Auth object's tidy-up (old sessions, spent counters, old notices, a new
// AUTH_RESET_FP), approvals whose Auth step never reported (a crash between the decision and
// the step), run again, and the pushes that may go now (a nudge waiting for a pause, a sign-in
// notice held by quiet hours).

import { authObject } from '../../objects/auth';
import { coreObject } from '../../objects/core';
import { missingMethod } from '../../objects/rpc';
import { runAfter } from '../proposals/after';
import { deliver } from '../push/routes';

export async function runCron(env: Env): Promise<void> {
  const core = coreObject(env);
  const [pruned, tick] = await Promise.all([authObject(env).prune(), core.tick()]);
  // `night` is the night wake's id (a Core still on the release before P3's night shift has none).
  const night = tick.night ?? null;
  if (pruned.sessions || pruned.counters || pruned.notices || pruned.pushes || tick.rolled || tick.pruned || night)
    console.log(JSON.stringify({ evt: 'cron', ...pruned, rolled: tick.rolled, core_pruned: tick.pruned, night }));
  await retryApprovals(env, core);
  await sendPushes(env);
}

async function sendPushes(env: Env): Promise<void> {
  try {
    const out = await deliver(env);
    if (out.sent.length || out.dropped || out.gone)
      console.log(JSON.stringify({ evt: 'cron_push', sent: out.sent.length, dropped: out.dropped, gone: out.gone }));
  } catch (e) {
    // A Core or Auth still on the release before pushes (a deploy in progress).
    if (!missingMethod(e)) throw e;
  }
}

async function retryApprovals(env: Env, core: ReturnType<typeof coreObject>): Promise<void> {
  let stale: Awaited<ReturnType<typeof core.staleApprovals>>;
  try {
    stale = await core.staleApprovals();
  } catch (e) {
    // A Core still on the release before proposals (a deploy in progress).
    if (missingMethod(e)) return;
    throw e;
  }
  for (const a of stale) {
    const out = await runAfter(env, a);
    if (out) await core.proposalRan(a.id, out);
  }
  if (stale.length) console.log(JSON.stringify({ evt: 'cron_approvals', ran: stale.length }));
}
