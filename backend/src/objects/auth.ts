// The Auth object: password, recovery code, sessions, notices, tickets, agent keys and pushes, in one
// instance named 'owner'. A thin RPC facade over areas/auth. It is its own class so the ~250 ms
// password hash never stalls Core, and so sign-in data stays out of Core's exports and backups.
import type {
  AgentItem,
  AuthStateResponse,
  BreakglassResponse,
  DeviceMe,
  NewAgentResponse,
  SessionItem,
  SignedIn,
  SignedInWithCode,
} from '../../../shared/contract/api';
import type { ErrorCode } from '../../../shared/contract/errors';
import type { PushItem, PutPushRequest, PutPushResponse } from '../../../shared/contract/push.ts';
import * as account from '../areas/auth/account';
import * as agents from '../areas/auth/agents';
import type { Revoked } from '../areas/auth/common';
import * as flows from '../areas/auth/flows';
import { hibpCheck, noBreachCheck } from '../areas/auth/passwords';
import * as reset from '../areas/auth/reset';
import { activeSessions } from '../areas/auth/store';
import * as outbox from '../areas/push/outbox';
import type { PushContext } from '../areas/push/rules';
import * as pushes from '../areas/push/store';
import { present } from '../lib/secrets';
import { type Subscription, vapid } from '../lib/webpush';
import { AUTH_MIGRATIONS } from './auth.migrations';
import { OwnerObject } from './base';

type R<T> = flows.Result<T>;

export class Auth extends OwnerObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, AUTH_MIGRATIONS);
  }

  private get deps(): flows.AuthDeps {
    // Fail closed: without these no hash or source key could ever be checked again.
    const pepper = present(this.env.AUTH_PEPPER);
    const ipKey = present(this.env.IP_HASH_KEY);
    if (!pepper || !ipKey) throw new Error('AUTH_PEPPER or IP_HASH_KEY is not set');
    return {
      db: this.db,
      storage: this.ctx.storage,
      pepper,
      ipKey,
      setupFp: present(this.env.AUTH_SETUP_FP),
      resetFp: present(this.env.AUTH_RESET_FP),
      breached: this.env.AUTH_HIBP === 'on' ? hibpCheck(fetch) : noBreachCheck,
    };
  }

  state(fp: string | null, resetFp: string | null): AuthStateResponse {
    return reset.state(this.deps, fp, resetFp);
  }
  setup(input: flows.SetupInput, meta: flows.RequestMeta): Promise<R<SignedInWithCode>> {
    return flows.setup(this.deps, input, meta);
  }
  login(input: flows.LoginInput, meta: flows.RequestMeta): Promise<R<SignedIn & Revoked>> {
    return flows.login(this.deps, input, meta);
  }
  recover(input: flows.RecoverInput, meta: flows.RequestMeta): Promise<R<SignedInWithCode & Revoked>> {
    return flows.recover(this.deps, input, meta);
  }
  /** Whether a device session is still signed in (the live socket checks it, API.md §12). */
  sessionLive(id: string): boolean {
    return account.sessionLive(this.deps, id);
  }
  verify(tokenHash: string, agent: boolean, country: string | null): R<account.Principal> {
    return account.verify(this.deps, tokenHash, agent, country);
  }
  me(sessionId: string): R<DeviceMe> {
    return account.me(this.deps, sessionId);
  }
  ackNotice(sessionId: string, id: string, answer: 'me' | 'not_me' | 'ok'): R<{ forget: string[] }> {
    return account.ackNotice(this.deps, sessionId, id, answer);
  }
  signout(sessionId: string, scope: 'this' | 'others' | 'all'): string[] {
    return account.signout(this.deps, sessionId, scope);
  }
  sessions(sessionId: string): SessionItem[] {
    return account.sessions(this.deps, sessionId);
  }
  relabel(sessionId: string, id: string, label: string): R<SessionItem> {
    return account.relabel(this.deps, sessionId, id, label);
  }
  revokeSession(sessionId: string, id: string): string[] {
    return account.revokeSession(this.deps, sessionId, id);
  }
  changePassword(sessionId: string, input: account.PasswordInput): Promise<R<{ forget: string[] }>> {
    return account.changePassword(this.deps, sessionId, input);
  }
  newRecoveryCode(sessionId: string, current: string): Promise<R<{ recovery_code: string }>> {
    return account.newRecoveryCode(this.deps, sessionId, current);
  }
  /** The password again before a sensitive step ("download everything"), throttled like every
   * other check of it. */
  async stepUp(sessionId: string, password: string): Promise<R<object>> {
    const cred = await account.checkPassword(this.deps, sessionId, password);
    return 'ok' in cred ? cred : { ok: true };
  }
  confirmRecovery(last5: string): R<object> {
    return account.confirmRecovery(this.deps, last5);
  }
  agents(): AgentItem[] {
    return agents.list(this.deps);
  }
  createAgent(sessionId: string, input: agents.NewAgentInput): Promise<R<NewAgentResponse>> {
    return agents.create(this.deps, sessionId, input);
  }
  revokeAgent(id: string): number {
    return agents.revoke(this.deps, id);
  }
  breakglass(fp: string): Promise<R<BreakglassResponse>> {
    return reset.breakglass(this.deps, fp);
  }
  cancelReset(sessionId: string, label: string, ticketId: string): R<object> {
    return reset.cancel(this.deps, ticketId, label, sessionId);
  }
  prune(): { sessions: number; counters: number; notices: number; pushes: number } {
    return reset.prune(this.deps);
  }

  // --- Web Push (areas/push; SECURITY.md §10) ---
  putPushSubscription(sessionId: string, s: Subscription): void {
    this.ctx.storage.transactionSync(() => pushes.putSubscription(this.db, sessionId, s, Date.now()));
  }
  deletePushSubscription(sessionId: string): void {
    pushes.deleteSubscriptions(this.db, [sessionId]);
  }
  pushItem(id: string): PushItem | null {
    return outbox.item(this.db, id);
  }
  queueNudge(id: string, r: PutPushRequest, hash: string, ctx: PushContext): PutPushResponse | { code: ErrorCode } {
    const out = this.ctx.storage.transactionSync(() => outbox.queueNudge(this.db, id, r, hash, ctx));
    return typeof out === 'string' ? { code: out } : out;
  }
  queuePushTest(sessionId: string): string {
    return outbox.queueTest(this.db, sessionId, Date.now());
  }
  /** Sends what may go now; `ctx` comes from Core. */
  async deliverPushes(ctx: PushContext): Promise<{ sent: string[]; dropped: number; gone: number }> {
    const sub = this.env.SITE_ORIGINS.split(',')[0]?.trim() || 'https://thunderhead.invalid';
    const live = activeSessions(this.db, ctx.now).map((s) => s.id);
    return outbox.deliver(this.db, ctx, { vapid: await vapid(this.env.VAPID_PRIVATE_JWK), sub }, live);
  }
}

/** The single Auth instance. No location hint: the first call (the owner's own setup page)
 * places it, and the public repo names no region. */
export function authObject(env: Env): DurableObjectStub<Auth> {
  return env.AUTH.getByName('owner');
}
