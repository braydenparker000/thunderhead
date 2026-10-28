// The 15-minute cron. In P1 it tidies the Auth object (old sessions, spent counters, old notices)
// and picks up a new AUTH_RESET_FP; Core.tick() with its job table arrives in P2.
import { authObject } from '../../objects/auth';

export async function runCron(env: Env): Promise<void> {
  const pruned = await authObject(env).prune();
  if (pruned.sessions || pruned.counters || pruned.notices) console.log(JSON.stringify({ evt: 'cron', ...pruned }));
}
