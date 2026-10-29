// The approved ops that run outside Core, after the decision's commit: `agents.revoke` in the Auth
// object. The decide route runs it at once; the 15-minute cron runs again any approval still
// `approved` 2 minutes on (a crash in between), which is safe because each op is idempotent.
import { forget } from '../../http/auth';
import { authObject } from '../../objects/auth';
import type { After, AfterOut } from './decide';

/** The step's outcome, or null when Auth could not be reached (the card stays `approved`). */
export async function runAfter(env: Env, a: After): Promise<AfterOut | null> {
  try {
    if (a.op === 'agents.revoke') {
      const id = String(a.args.agent_id);
      const n = await authObject(env).revokeAgent(id);
      // This isolate at once; every other one within 60 s (SECURITY.md §5.1).
      forget([id]);
      return {
        ok: true,
        result: { revoked: n > 0 },
        what: n > 0 ? 'revoked an agent key' : 'the agent key was already gone',
      };
    }
    return { ok: false, code: 'unknown_op' };
  } catch {
    return null;
  }
}
