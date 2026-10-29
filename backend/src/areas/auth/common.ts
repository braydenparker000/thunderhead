// Shared machinery of the Auth flows: dependencies, results, back-off bookkeeping, sessions,
// notices and recovery codes. Runs inside the Auth object.
import type { DeviceHints, ErrorCode, ErrorDetails, SignedIn } from '../../../../shared/contract/api';
import { uuidv7 } from '../../lib/ids';
import { DAY, floorHour, utcDay } from '../../lib/time';
import type { Db } from '../../objects/base';
import { last5Hash, newRecoveryCode, normalizeCode, recoveryHash, sourceKey, tokenHash } from './crypto';
import type { BreachCheck } from './passwords';
import * as store from './store';
import * as keys from './store-keys';
import { afterFailure, type CounterRef, retryAfterSeconds, waitMs } from './throttle';
import { newToken } from './tokens';

export const IDLE_DAYS = 90;
export const IDLE_EXPIRY = IDLE_DAYS * DAY;
export const MAX_SESSIONS = 50;

/** What the Worker knows about the caller. The IP is hashed here and never stored. */
export interface RequestMeta {
  ip: string;
  country: string | null;
  region: string | null;
}

export interface AuthDeps {
  db: Db;
  storage: DurableObjectStorage;
  pepper: string;
  ipKey: string;
  /** AUTH_SETUP_FP / AUTH_RESET_FP, null when unset, empty or `none`. */
  setupFp: string | null;
  resetFp: string | null;
  breached: BreachCheck;
}

export type Failure = {
  ok: false;
  code: ErrorCode;
  retry_after?: number;
  scope?: 'source' | 'account';
  details?: ErrorDetails;
};
export type Result<T> = ({ ok: true } & T) | Failure;

/** Sessions a sign-in flow revoked (device limit, recovery), so the route can close their live
 * sockets. Never sent to the client. */
export interface Revoked {
  revoked: string[];
}

export const fail = (code: ErrorCode, details?: ErrorDetails): Failure => ({ ok: false, code, details });

const key = ([kind, who]: CounterRef) => `${kind}:${who}`;

/** 429 with the longest wait among the counters, or null when the attempt may go ahead. */
export function throttled(d: AuthDeps, refs: CounterRef[], now: number): Failure | null {
  let worst = 0;
  let scope: 'source' | 'account' = 'source';
  for (const ref of refs) {
    const w = waitMs(store.getCounter(d.db, key(ref)), now, ...ref);
    if (w > worst || (w === worst && w > 0 && ref[1] === 'acct')) {
      worst = w;
      scope = ref[1] === 'acct' ? 'account' : 'source';
    }
  }
  return worst > 0 ? { ok: false, code: 'rate_limited', retry_after: retryAfterSeconds(worst), scope } : null;
}

/** Counts a failure on each counter before the expensive or decisive step, and commits it, so a
 * crash or a CPU-limit kill in the middle still counts the attempt. */
export async function reserve(d: AuthDeps, refs: CounterRef[], now: number): Promise<void> {
  d.storage.transactionSync(() => {
    for (const ref of refs)
      store.putCounter(d.db, key(ref), afterFailure(store.getCounter(d.db, key(ref)), now, ...ref));
  });
  await d.storage.sync();
}

export function clearCounters(d: AuthDeps, refs: CounterRef[]): void {
  for (const ref of refs) store.clearCounter(d.db, key(ref));
}

export const source = (d: AuthDeps, meta: RequestMeta, now: number) => sourceKey(meta.ip, d.ipKey, utcDay(now));

/** `<model or platform> · <browser>[ app]`, e.g. "Android phone · Chrome app". */
export function defaultLabel(device: DeviceHints): string {
  const head = device.model || device.platform;
  const label = [head, device.browser].filter(Boolean).join(' · ') || 'New device';
  return device.standalone ? `${label} app` : label;
}

/** Creates a session (in the caller's transaction), revoking the one idle longest beyond 50;
 * `evicted` names it so its live socket can be closed. */
export function newSession(d: AuthDeps, meta: RequestMeta, device: DeviceHints, credVersion: number, now: number) {
  const active = store.activeSessions(d.db, now);
  let evicted: string[] = [];
  if (active.length >= MAX_SESSIONS) {
    const idlest = active.reduce((a, b) => (b.last_seen_at < a.last_seen_at ? b : a));
    evicted = store.revokeSessions(d.db, now, 'device_limit', { only: idlest.id });
  }
  const token = newToken('th1');
  const label = defaultLabel(device).slice(0, 40);
  const session_id = uuidv7(now);
  store.insertSession(d.db, {
    token_hash: tokenHash(token),
    id: session_id,
    label,
    platform: device.platform || null,
    browser: device.browser || null,
    model: device.model || null,
    standalone: device.standalone ? 1 : 0,
    country: meta.country,
    region: meta.region,
    last_country: meta.country,
    created_at: now,
    last_seen_at: floorHour(now),
    idle_expires_at: now + IDLE_EXPIRY,
    credential_version: credVersion,
  });
  const grant: SignedIn = { token, session_id, idle_days: IDLE_DAYS };
  return { grant, label, others: active.length - evicted.length, evicted };
}

export function notice(
  d: AuthDeps,
  kind: keys.NoticeRow['kind'],
  sessionId: string | null,
  args: Record<string, unknown>,
  now: number,
  ttlDays: number | null,
): void {
  const expires_at = ttlDays === null ? null : now + ttlDays * DAY;
  keys.insertNotice(d.db, {
    id: uuidv7(now),
    kind,
    session_id: sessionId,
    args_json: JSON.stringify(args),
    created_at: now,
    expires_at,
  });
}

/** A new recovery code: stored as two keyed hashes, shown once. */
export function issueRecoveryCode(d: AuthDeps, now: number): string {
  const code = newRecoveryCode();
  const norm = normalizeCode(code) ?? '';
  store.putRecovery(d.db, recoveryHash(norm, d.pepper), last5Hash(norm, d.pepper), now);
  return code;
}
