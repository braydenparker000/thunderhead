// The fire call that starts a mind session (RUNTIME.md §3): POST to the task's API trigger with
// the constant text `wake`. The URL and token are Worker secrets that hold `none` until the owner
// connects the task (SETUP.md K for mind-chat, L1 for mind-night), so an unconnected task never
// fires. Runs after the commit that created the wake, from the Worker (waitUntil), the object's
// alarm or the cron's day roll.
import type { MindRole } from '../../../../shared/contract/api';

export interface FireConfig {
  url: string;
  token: string;
}

export interface FireResult {
  status: number;
  session_id: string | null;
  error: string | null;
}

const set = (v: string | undefined) => (v && v !== 'none' ? v : null);

/** The task's trigger, or null while it is not connected. Reflex arrives with P4. */
export function fireConfig(env: Env, task: MindRole): FireConfig | null {
  if (task === 'reflex') return null;
  const url = set(task === 'chat' ? env.ROUTINE_CHAT_URL : env.ROUTINE_NIGHT_URL);
  const token = set(task === 'chat' ? env.ROUTINE_CHAT_TOKEN : env.ROUTINE_NIGHT_TOKEN);
  return url && token && url.startsWith('https://') ? { url, token } : null;
}

export async function fire(cfg: FireConfig, fetchImpl: typeof fetch = fetch): Promise<FireResult> {
  try {
    const res = await fetchImpl(cfg.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'anthropic-beta': 'experimental-cc-routine-2026-04-01',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'wake' }),
      signal: AbortSignal.timeout(10_000),
    });
    let sessionId: string | null = null;
    try {
      const body = (await res.json()) as { claude_code_session_id?: unknown };
      if (typeof body.claude_code_session_id === 'string') sessionId = body.claude_code_session_id.slice(0, 120);
    } catch {
      // no JSON body: the status is what we record
    }
    return { status: res.status, session_id: sessionId, error: res.ok ? null : `http_${res.status}` };
  } catch (e) {
    return { status: 0, session_id: null, error: (e as Error).name === 'TimeoutError' ? 'timeout' : 'network' };
  }
}
