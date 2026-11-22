// The 15-minute cron: Core's tick (the day roll after 60 quiet minutes and the night shift's fire
// it starts, expiring verbs and decision cards, and the daily prune pass over every table's
// retention), the Auth object's tidy-up (old sessions, spent counters, old notices, a new
// AUTH_RESET_FP), approvals whose Auth step never reported (a crash between the decision and
// the step), run again, and the pushes that may go now (a nudge waiting for a pause, a sign-in
// notice held by quiet hours). On the day roll, the owner's calendar links are fetched again
// (areas/briefing/calendar.ts), so the morning's Briefing and brief start from this day's.
// Each step runs on its own: one that fails no longer stops the rest, and the run ends with the
// cron's heartbeat (Core's `ops.cron`: when it ran, which steps failed), which deep health and the
// Briefing read (OPERATIONS.md §8.5); a cron not seen for 45 minutes is itself a line there.

import { authObject } from '../../objects/auth';
import { coreObject } from '../../objects/core';
import { missingMethod } from '../../objects/rpc';
import { refreshCalendars } from '../briefing/calendar';
import { drivePass } from '../photos/reconcile';
import { runAfter } from '../proposals/after';
import { deliver } from '../push/routes';

export async function runCron(env: Env, now = Date.now()): Promise<string[]> {
  const core = coreObject(env);
  const failed: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch {
      failed.push(name);
    }
  };
  let rolled = false;
  await Promise.all([
    step('auth', async () => {
      const pruned = await authObject(env).prune();
      // The GitHub path's reset ticket opened: an open home shows its card at once (SIGN-IN.md §10.1).
      if (pruned.reset_opened) await core.noticeChanged().catch(() => {});
      if (pruned.sessions || pruned.counters || pruned.notices || pruned.pushes)
        console.log(JSON.stringify({ evt: 'cron', ...pruned }));
    }),
    step('tick', async () => {
      const tick = await core.tick();
      rolled = Boolean(tick.rolled);
      // `night` is the night wake's id (a Core still on the release before P3's night shift has none).
      const night = tick.night ?? null;
      if (tick.rolled || tick.pruned || night)
        console.log(JSON.stringify({ evt: 'cron', rolled: tick.rolled, core_pruned: tick.pruned, night }));
    }),
  ]);
  if (rolled) await step('calendars', () => rollCalendars(core));
  await step('approvals', () => retryApprovals(env, core));
  await step('pushes', () => sendPushes(env));
  await step('photos', () => photosPass(env));
  if (failed.length) console.log(JSON.stringify({ evt: 'cron_failed', failed }));
  // A Core still on the release before the heartbeat (a deploy in progress) records nothing.
  await core.cronBeat(now, failed).catch(() => {});
  return failed;
}

/** Photos' daily Drive pass (areas/photos/reconcile.ts); a failure waits for the next tick and is
 * named in the heartbeat. */
async function photosPass(env: Env): Promise<void> {
  try {
    const out = await drivePass(env);
    if (out?.added || out?.trashed) console.log(JSON.stringify({ evt: 'cron_photos', ...out }));
  } catch (e) {
    // A Core still on the release before Photos (a deploy in progress), or Google not answering.
    if (missingMethod(e)) return;
    console.log(JSON.stringify({ evt: 'cron_photos', failed: true }));
    throw e;
  }
}

/** Every calendar link, fetched on the day roll; a failure is kept on its link, never thrown. */
async function rollCalendars(core: ReturnType<typeof coreObject>): Promise<void> {
  try {
    const plan = await core.calendarPlan(true);
    if (plan.links.length) await refreshCalendars(core, plan.links, plan.tz, Date.now());
  } catch (e) {
    // A Core still on the release before the calendar (a deploy in progress).
    if (!missingMethod(e)) throw e;
  }
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
