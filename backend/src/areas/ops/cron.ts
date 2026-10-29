// The 15-minute cron: Core's tick (the day roll after 60 quiet minutes, expiring verbs, and the
// daily prune pass over every table's retention) and the Auth object's tidy-up (old sessions,
// spent counters, old notices, a new AUTH_RESET_FP).
import { authObject } from '../../objects/auth';
import { coreObject } from '../../objects/core';

export async function runCron(env: Env): Promise<void> {
  const [pruned, tick] = await Promise.all([authObject(env).prune(), coreObject(env).tick()]);
  if (pruned.sessions || pruned.counters || pruned.notices || tick.rolled || tick.pruned)
    console.log(JSON.stringify({ evt: 'cron', ...pruned, rolled: tick.rolled, core_pruned: tick.pruned }));
}
