// The public sign-in flows (SIGN-IN.md §4, §5, §8, §10.3), run inside the Auth object, one
// instance, so every check-then-write is serialised. Each returns a plain result instead of
// throwing, because results cross the RPC boundary and the route maps codes to statuses.
import type { DeviceHints, SignedIn, SignedInWithCode } from '../../../../shared/contract/api';
import { uuidv7 } from '../../lib/ids';
import {
  type AuthDeps,
  clearCounters,
  fail,
  issueRecoveryCode,
  newSession,
  notice,
  type RequestMeta,
  type Result,
  reserve,
  source,
  throttled,
} from './common';
import {
  fingerprint,
  hashPassword,
  KDF_CURRENT,
  newSalt,
  normalizeCode,
  recoveryHash,
  sameBytes,
  sameText,
  weakerThanCurrent,
} from './crypto';
import { normalizeUsername, overCap, passwordProblem, usernameOk } from './passwords';
import { resetTicketFor, syncResetFp } from './reset';
import * as store from './store';
import * as keys from './store-keys';
import type { CounterRef } from './throttle';

export * from './common';

// The dummy salt for unknown usernames: the hash still runs, so timing says nothing.
const DUMMY_SALT = new Uint8Array(16);

export interface SetupInput {
  setup_code: string;
  username: string;
  password: string;
  device: DeviceHints;
}

export async function setup(d: AuthDeps, input: SetupInput, meta: RequestMeta): Promise<Result<SignedInWithCode>> {
  const now = Date.now();
  if (store.hasCredential(d.db)) return fail('setup_done');
  if (!d.setupFp) return fail('setup_fp_missing');
  const refs: CounterRef[] = [
    ['setup', source(d, meta, now)],
    ['setup', 'acct'],
  ];
  const limited = throttled(d, refs, now);
  if (limited) return limited;
  const fp = fingerprint(normalizeCode(input.setup_code) ?? input.setup_code);
  if (!sameText(fp, d.setupFp) || keys.ticketByFingerprint(d.db, fp)) {
    await reserve(d, refs, now);
    return fail('setup_code_wrong');
  }
  const username = normalizeUsername(input.username);
  if (!usernameOk(username)) return fail('username_invalid');
  const problem = passwordProblem(input.password, username);
  if (problem) return fail(problem);
  if ((await d.breached(input.password)) === true) return fail('password_breached');
  // The breach check awaited the network, so another request may have finished setup meanwhile.
  if (store.hasCredential(d.db)) return fail('setup_done');
  const salt = newSalt();
  const hash = hashPassword(input.password, salt, KDF_CURRENT, d.pepper);
  const out = d.storage.transactionSync(() => {
    clearCounters(d, refs);
    store.insertCredential(d.db, username, { ...KDF_CURRENT, salt, hash, at: now });
    const recovery_code = issueRecoveryCode(d, now);
    keys.insertTicket(d.db, {
      id: uuidv7(now),
      kind: 'setup',
      fingerprint: fp,
      source: 'github',
      requested_at: now,
      usable_after: null,
      expires_at: null,
      used_at: now,
      cancelled_at: null,
    });
    // The first session gets no new-device notice: there is no other device.
    return { ...newSession(d, meta, input.device, 1, now).grant, recovery_code };
  });
  return { ok: true, ...out };
}

export interface LoginInput {
  username: string;
  password: string;
  device: DeviceHints;
}

export async function login(d: AuthDeps, input: LoginInput, meta: RequestMeta): Promise<Result<SignedIn>> {
  const now = Date.now();
  if (!store.hasCredential(d.db)) return fail('setup_required');
  if (overCap(input.password)) return fail('password_too_long');
  const refs: CounterRef[] = [
    ['signin', source(d, meta, now)],
    ['signin', 'acct'],
  ];
  // Same 429 whether or not the username exists: counters never look at it. An early attempt
  // is not counted and does not extend the wait.
  const limited = throttled(d, refs, now);
  if (limited) return limited;
  await reserve(d, refs, now);

  const cred = store.getCredential(d.db);
  const salt = cred ? new Uint8Array(cred.salt) : DUMMY_SALT;
  const hash = hashPassword(input.password, salt, cred ?? KDF_CURRENT, d.pepper);
  const ok =
    cred !== null &&
    sameText(normalizeUsername(input.username), cred.username) &&
    sameBytes(hash, new Uint8Array(cred.hash));
  if (!ok || !cred) return fail('wrong_username_or_password');

  // Upgrade an older, weaker hash now that the password is known to be right.
  const upgradeSalt = weakerThanCurrent(cred) ? newSalt() : null;
  const upgraded = upgradeSalt ? hashPassword(input.password, upgradeSalt, KDF_CURRENT, d.pepper) : null;
  const grant = d.storage.transactionSync(() => {
    clearCounters(d, refs);
    if (upgradeSalt && upgraded)
      store.updatePassword(d.db, { ...KDF_CURRENT, salt: upgradeSalt, hash: upgraded, at: now }, false);
    const s = newSession(d, meta, input.device, cred.version, now);
    if (s.others > 0)
      notice(
        d,
        'new_device',
        s.grant.session_id,
        { label: s.label, region: meta.region ?? undefined, country: meta.country ?? undefined, at: now },
        now,
        14,
      );
    return s.grant;
  });
  return { ok: true, ...grant };
}

export interface RecoverInput {
  username: string;
  code: string;
  new_password: string;
  device: DeviceHints;
}

/** Recovery code or ready reset ticket: new password, every session signed out, this device
 * signed in, a new recovery code (SIGN-IN.md §8, §10.3). */
export async function recover(d: AuthDeps, input: RecoverInput, meta: RequestMeta): Promise<Result<SignedInWithCode>> {
  const now = Date.now();
  if (!store.hasCredential(d.db)) return fail('setup_required');
  syncResetFp(d, now);
  const refs: CounterRef[] = [
    ['recover', source(d, meta, now)],
    ['recover', 'acct'],
  ];
  const limited = throttled(d, refs, now);
  if (limited) return limited;
  const username = normalizeUsername(input.username);
  const problem = passwordProblem(input.new_password, username);
  if (problem) return fail(problem);
  await reserve(d, refs, now);

  const cred = store.getCredential(d.db);
  const rec = store.getRecovery(d.db);
  const norm = normalizeCode(input.code);
  const userOk = cred !== null && sameText(username, cred.username);
  const byRecovery =
    userOk && norm !== null && rec !== null && sameBytes(recoveryHash(norm, d.pepper), new Uint8Array(rec.code_hash));
  const ticket = !byRecovery && userOk && norm !== null ? resetTicketFor(d, fingerprint(norm), now) : null;
  if (!cred || (!byRecovery && !ticket)) return fail('wrong_username_or_code');
  if (ticket && !ticket.ok) {
    d.storage.transactionSync(() => clearCounters(d, refs));
    return ticket;
  }
  if ((await d.breached(input.new_password)) === true) {
    d.storage.transactionSync(() => clearCounters(d, refs));
    return fail('password_breached');
  }
  const reason = byRecovery ? 'recovery_used' : 'reset_used';
  const salt = newSalt();
  const hash = hashPassword(input.new_password, salt, KDF_CURRENT, d.pepper);
  const out = d.storage.transactionSync(() => {
    clearCounters(d, refs);
    store.updatePassword(d.db, { ...KDF_CURRENT, salt, hash, at: now }, true);
    store.revokeSessions(d.db, now, reason, {});
    if (ticket?.ok) {
      keys.useTicket(d.db, ticket.id, now);
      keys.ackTicketNotices(d.db, ticket.id, now);
    }
    const recovery_code = issueRecoveryCode(d, now);
    const s = newSession(d, meta, input.device, cred.version + 1, now);
    // Agent keys stay; the new session is told to check them.
    notice(d, reason, s.grant.session_id, { at: now }, now, null);
    return { ...s.grant, recovery_code };
  });
  return { ok: true, ...out };
}
