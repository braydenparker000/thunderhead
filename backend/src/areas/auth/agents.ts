// Agent keys (SIGN-IN.md §17, API.md §11.4): made in Settings → Agents with the current
// password, shown once, stored as SHA-256 only, revoked within 60 s everywhere.
import type { AgentItem, AgentRole, NewAgentResponse } from '../../../../shared/contract/api';
import { uuidv7 } from '../../lib/ids';
import { checkPassword } from './account';
import { tokenHash } from './crypto';
import { type AuthDeps, fail, notice, type Result } from './flows';
import * as store from './store';
import * as keys from './store-keys';
import { newToken, prefixForRole } from './tokens';

export const MAX_AGENTS = 20;

export function list(d: AuthDeps): AgentItem[] {
  return keys.activeAgents(d.db);
}

export interface NewAgentInput {
  name: string;
  role: AgentRole;
  current_password: string;
}

export async function create(d: AuthDeps, me: string, input: NewAgentInput): Promise<Result<NewAgentResponse>> {
  const cred = await checkPassword(d, me, input.current_password);
  if ('ok' in cred) return cred;
  const now = Date.now();
  const active = keys.activeAgents(d.db);
  // Names are unique among active keys, so a rotated key can take its old name back.
  if (active.some((a) => a.name === input.name)) return fail('agent_name_taken');
  if (active.length >= MAX_AGENTS) return fail('agent_limit');
  const token = newToken(prefixForRole(input.role));
  const id = uuidv7(now);
  d.storage.transactionSync(() => {
    const label = store.sessionById(d.db, me)?.label ?? 'a device';
    keys.insertAgent(
      d.db,
      {
        id,
        name: input.name,
        role: input.role,
        created_at: now,
        created_on: label,
        last_used_at: null,
        last_country: null,
      },
      Buffer.from(tokenHash(token), 'hex'),
    );
    notice(d, 'agent_key_created', me, { name: input.name, role: input.role, label, agent_id: id }, now, 14);
  });
  return { ok: true, id, token };
}

export function revoke(d: AuthDeps, id: string): number {
  return keys.revokeAgent(d.db, id, Date.now());
}
