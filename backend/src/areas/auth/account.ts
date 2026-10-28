// Signed-in account controls (SIGN-IN.md §3.2, §7.2, §9.1, §11): token checks, /me and notices,
// sign-out, the device list, password change and the recovery code. Run inside the Auth object.
import type { AgentRole, DeviceMe, Notice, RevokeReason, SessionItem } from '../../../../shared/contract/api';
import { DAY, floorHour } from '../../lib/time';
import { hashPassword, KDF_CURRENT, last5Hash, newSalt, sameBytes } from './crypto';
import {
  type AuthDeps,
  clearCounters,
  type Failure,
  fail,
  IDLE_EXPIRY,
  issueRecoveryCode,
  notice,
  type Result,
  reserve,
  throttled,
} from './flows';
import { passwordProblem } from './passwords';
import * as store from './store';
import * as keys from './store-keys';
import type { CounterRef } from './throttle';

export type Principal =
  | { kind: 'device'; session_id: string; label: string }
  | { kind: 'agent'; agent_id: string; role: AgentRole; name: string };

const KEEP_REVOKED = 30 * DAY;

/** The principal behind a token hash, or why not. Renews `last_seen_at`/`last_used_at` at most
 * once an hour, so a busy day costs a handful of writes instead of one per request. */
export function verify(d: AuthDeps, hash: string, agent: boolean, country: string | null): Result<Principal> {
  const now = Date.now();
  const hour = floorHour(now);
  if (agent) {
    const a = keys.agentByTokenHash(d.db, Buffer.from(hash, 'hex'));
    if (!a) return fail('unauthorized');
    if ((a.last_used_at ?? 0) < hour) keys.touchAgent(d.db, a.id, hour, country);
    return { ok: true, kind: 'agent', agent_id: a.id, role: a.role, name: a.name };
  }
  const s = store.sessionByTokenHash(d.db, hash);
  if (!s) return fail('unauthorized');
  if (s.revoked_at !== null)
    return now - s.revoked_at <= KEEP_REVOKED
      ? fail('session_revoked', { reason: s.revoked_reason as RevokeReason })
      : fail('unauthorized');
  if (s.idle_expires_at <= now)
    return now - s.idle_expires_at <= KEEP_REVOKED ? fail('session_expired') : fail('unauthorized');
  if (hour > s.last_seen_at) store.touchSession(d.db, hash, hour, now + IDLE_EXPIRY, country);
  return { ok: true, kind: 'device', session_id: s.id, label: s.label };
}

const SELF_KINDS = new Set(['recovery_used', 'reset_used']);
const NEW_ONLY = new Set(['new_device', 'password_changed', 'agent_key_created']);

/** Notices this session should see: a reset for everyone, a reset/recovery line only for the
 * session it created, and the rest for every other session that existed when it was made. */
function visibleNotices(d: AuthDeps, me: store.SessionRow): keys.NoticeRow[] {
  return keys.openNotices(d.db, Date.now()).filter((n) => {
    if (n.session_id === null) return true;
    if (SELF_KINDS.has(n.kind)) return n.session_id === me.id;
    return n.session_id !== me.id && (!NEW_ONLY.has(n.kind) || n.created_at >= me.created_at);
  });
}

function toWire(n: keys.NoticeRow): Notice {
  const { agent_id: _hidden, ...args } = JSON.parse(n.args_json) as Notice['args'] & { agent_id?: string };
  return {
    id: n.id,
    kind: n.kind,
    created_at: n.created_at,
    expires_at: n.expires_at,
    about_session_id: n.session_id,
    args,
  };
}

export function me(d: AuthDeps, sessionId: string): Result<DeviceMe> {
  const s = store.sessionById(d.db, sessionId);
  if (!s) return fail('unauthorized');
  const rec = store.getRecovery(d.db);
  return {
    ok: true,
    session_id: s.id,
    label: s.label,
    notices: visibleNotices(d, s).map(toWire),
    recovery_confirmed: rec?.confirmed_at != null,
  };
}

/** "Not me" undoes what the notice is about. Returns the principals to drop from caches. */
export function ackNotice(
  d: AuthDeps,
  sessionId: string,
  id: string,
  answer: 'me' | 'not_me' | 'ok',
): Result<{ forget: string[] }> {
  const now = Date.now();
  const s = store.sessionById(d.db, sessionId);
  const n = s ? visibleNotices(d, s).find((x) => x.id === id) : undefined;
  if (!n) return fail('not_found');
  // "That was me" on a pending reset hides it on this device only; the server keeps it open.
  if (n.kind === 'reset_pending' && answer === 'me') return { ok: true, forget: [] };
  const forget = d.storage.transactionSync(() => {
    let ids: string[] = [];
    if (answer === 'not_me') {
      if (n.kind === 'new_device' && n.session_id)
        ids = store.revokeSessions(d.db, now, 'signed_out_elsewhere', { only: n.session_id });
      if (n.kind === 'password_changed')
        ids = store.revokeSessions(d.db, now, 'signed_out_elsewhere', { selfId: sessionId });
      const agentId = (JSON.parse(n.args_json) as { agent_id?: string }).agent_id;
      if (n.kind === 'agent_key_created' && agentId && keys.revokeAgent(d.db, agentId, now)) ids = [agentId];
    }
    keys.ackNotice(d.db, n.id, answer, now);
    return ids;
  });
  return { ok: true, forget };
}

export function signout(d: AuthDeps, sessionId: string, scope: 'this' | 'others' | 'all'): string[] {
  const target = scope === 'this' ? { only: sessionId } : scope === 'others' ? { except: sessionId } : {};
  return store.revokeSessions(d.db, Date.now(), 'signed_out_elsewhere', { ...target, selfId: sessionId });
}

function item(s: store.SessionRow, me: string): SessionItem {
  return {
    id: s.id,
    label: s.label,
    platform: s.platform,
    browser: s.browser,
    standalone: s.standalone === 1,
    region: s.region,
    country: s.country,
    last_country: s.last_country,
    signed_in_at: s.created_at,
    last_seen_at: s.last_seen_at,
    this_device: s.id === me,
  };
}

/** This device first, then newest first. */
export function sessions(d: AuthDeps, me: string): SessionItem[] {
  const items = store.activeSessions(d.db, Date.now()).map((s) => item(s, me));
  return [...items.filter((i) => i.this_device), ...items.filter((i) => !i.this_device)];
}

export function relabel(d: AuthDeps, me: string, id: string, label: string): Result<SessionItem> {
  if (!store.relabelSession(d.db, id, label, Date.now())) return fail('not_found');
  const s = store.sessionById(d.db, id);
  return s ? { ok: true, ...item(s, me) } : fail('not_found');
}

export function revokeSession(d: AuthDeps, me: string, id: string): string[] {
  return store.revokeSessions(d.db, Date.now(), 'signed_out_elsewhere', { only: id, selfId: me });
}

/** The inline password check in Settings: 5 tries per session, then 2^(n−5) s; it never touches
 * the account-wide counter, so a stranger can't block the owner's own signed-in phone. */
export async function checkPassword(
  d: AuthDeps,
  sessionId: string,
  password: string,
): Promise<Failure | store.CredentialRow> {
  const now = Date.now();
  const refs: CounterRef[] = [['pwcheck', sessionId]];
  const limited = throttled(d, refs, now);
  if (limited) return limited;
  await reserve(d, refs, now);
  const cred = store.getCredential(d.db);
  if (!cred) return fail('setup_required');
  const hash = hashPassword(password, new Uint8Array(cred.salt), cred, d.pepper);
  if (!sameBytes(hash, new Uint8Array(cred.hash))) return fail('current_password_wrong');
  d.storage.transactionSync(() => clearCounters(d, refs));
  return cred;
}

export interface PasswordInput {
  current_password: string;
  new_password: string;
  sign_out_others: boolean;
}

export async function changePassword(
  d: AuthDeps,
  me: string,
  input: PasswordInput,
): Promise<Result<{ forget: string[] }>> {
  const cred = await checkPassword(d, me, input.current_password);
  if ('ok' in cred) return cred;
  const problem = passwordProblem(input.new_password, cred.username, input.current_password);
  if (problem) return fail(problem);
  if ((await d.breached(input.new_password)) === true) return fail('password_breached');
  const now = Date.now();
  const salt = newSalt();
  const hash = hashPassword(input.new_password, salt, KDF_CURRENT, d.pepper);
  const forget = d.storage.transactionSync(() => {
    store.updatePassword(d.db, { ...KDF_CURRENT, salt, hash, at: now }, true);
    if (input.sign_out_others) return store.revokeSessions(d.db, now, 'password_changed', { except: me });
    const label = store.sessionById(d.db, me)?.label;
    notice(d, 'password_changed', me, { label, at: now }, now, 14);
    return [];
  });
  return { ok: true, forget };
}

export async function newRecoveryCode(
  d: AuthDeps,
  me: string,
  current: string,
): Promise<Result<{ recovery_code: string }>> {
  const cred = await checkPassword(d, me, current);
  if ('ok' in cred) return cred;
  const recovery_code = d.storage.transactionSync(() => issueRecoveryCode(d, Date.now()));
  return { ok: true, recovery_code };
}

export function confirmRecovery(d: AuthDeps, last5: string): Result<object> {
  const typed = last5.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  const rec = store.getRecovery(d.db);
  if (!rec || !sameBytes(last5Hash(typed, d.pepper), new Uint8Array(rec.last5_hash)) || typed.length !== 5)
    return fail('validation', [{ path: 'last5', issue: 'does not match the recovery code' }]);
  store.confirmRecovery(d.db, Date.now());
  return { ok: true };
}
