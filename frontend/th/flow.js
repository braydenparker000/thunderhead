// @ts-check
// The sign-in client's state machine (SIGN-IN.md §3.3) and the small rules around it, with no
// DOM, so tests/auth-logic.test.mjs drives every arrow with a fake API and store.
//
//  BOOT ──no token──▶ SIGNED_OUT        BOOT ──token──▶ SIGNED_IN
//  SIGNED_OUT ──submit──▶ SUBMITTING ──200──▶ SIGNED_IN
//                             ├─ 401 / network / 5xx ──▶ SIGNED_OUT + line
//                             └─ 429 ──▶ WAITING ──countdown 0──▶ SIGNED_OUT
//  SIGNED_IN ──401 session_* / unauthorized──▶ WIPING ──▶ SIGNED_OUT + reason

import { ApiError } from './api.js';
import { LINES, lineFor } from './copy.js';

/** @typedef {import('../../shared/contract/api.ts').DeviceHints} DeviceHints */
/** @typedef {import('../../shared/contract/api.ts').SignedIn} SignedIn */
/** @typedef {import('../../shared/contract/api.ts').LoginRequest} LoginRequest */
/** @typedef {{ session_id: string, token: string, signed_in_at: number, username?: string }} Session */
/** @typedef {{ read(): Promise<Session | null>, write(s: Session): Promise<void> }} SessionStore */
/** @typedef {'boot' | 'signed_out' | 'submitting' | 'waiting' | 'signed_in' | 'wiping'} State */
/**
 * @typedef {{ kind: 'api' | 'timeout' | 'network', code: string | null, status: number,
 *   retryAfter: number | null, scope: string | null, reason: string | null }} Failure
 */

/** `next` only if it is a path on this site: starts with `/`, not `//` (§2). @param {unknown} raw */
export function safeNext(raw) {
  return typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\') ? raw : '/';
}

/** "Try again in 8 s" under a minute, "Try again in 2:08" from a minute up (§6.2). @param {number} seconds */
export function waitLabel(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return s < 60 ? `Try again in ${s} s` : `Try again in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** What went wrong with a request, in one shape. @param {unknown} e @returns {Failure} */
export function failure(e) {
  if (e instanceof ApiError) {
    const d = e.details && !Array.isArray(e.details) ? e.details : null;
    return { kind: 'api', code: e.code, status: e.status, retryAfter: e.retryAfter, scope: e.scope, reason: d?.reason ?? null };
  }
  const name = /** @type {{ name?: string }} */ (e)?.name;
  const kind = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network';
  return { kind, code: null, status: 0, retryAfter: null, scope: null, reason: null };
}

/** The `reason` for /signin/ when a request shows this device is signed out, else null (§11.2).
 * @param {Failure} f */
export function signedOutReason(f) {
  if (f.status !== 401) return null;
  if (f.code === 'session_revoked') return f.reason ?? 'unauthorized';
  if (f.code === 'session_expired') return 'expired';
  if (f.code === 'unauthorized') return 'unauthorized';
  return null;
}

/**
 * @param {{
 *   api: { login(body: LoginRequest): Promise<SignedIn> },
 *   store: SessionStore,
 *   device: () => Promise<DeviceHints>,
 *   now?: () => number,
 *   online?: () => boolean,
 * }} deps `now` is a monotonic clock in ms (performance.now), so a changed phone clock can't
 *   shorten a wait.
 */
export function createSignin({ api, store, device, now = () => performance.now(), online = () => true }) {
  /** @type {State} */
  let state = 'boot';
  let line = '';
  let wrong = 0;
  let retryAt = 0;
  /** @type {string | null} */
  let redirect = null;
  let reload = false;

  const view = () => ({ state, line, wrong, redirect, reload, waitLeft: state === 'waiting' ? Math.max(0, (retryAt - now()) / 1000) : 0 });

  return {
    view,
    async boot() {
      state = (await store.read()) ? 'signed_in' : 'signed_out';
      return view();
    },
    /** @param {{ username: string, password: string }} form */
    async submit(form) {
      if (state === 'submitting' || state === 'waiting' || state === 'signed_in') return view();
      state = 'submitting';
      line = '';
      redirect = null;
      reload = false;
      try {
        const r = await api.login({ username: form.username, password: form.password, device: await device() });
        await store.write({ session_id: r.session_id, token: r.token, signed_in_at: Date.now(), username: form.username });
        state = 'signed_in';
        wrong = 0;
        return view();
      } catch (e) {
        const f = failure(e);
        if (f.code === 'rate_limited') {
          state = 'waiting';
          retryAt = now() + Math.max(1, f.retryAfter ?? 1) * 1000;
          line = f.scope === 'account' ? LINES.rate_account : LINES.rate_source;
          return view();
        }
        state = 'signed_out';
        if (f.code === 'wrong_username_or_password') wrong++;
        if (f.code === 'setup_required') redirect = '/setup/';
        if (f.code === 'client_outdated') reload = true;
        line = f.kind === 'network' && !online() ? LINES.offline : lineFor(f, { auth: true });
        return view();
      }
    },
    /** Call once a second while waiting; the button comes back at 0. Nothing is submitted. */
    tick() {
      if (state === 'waiting' && now() >= retryAt) {
        state = 'signed_out';
        line = '';
      }
      return view();
    },
    /** A request showed this device is signed out: wipe, then back to the form with a reason.
     * @param {() => Promise<void>} wipe */
    async revoked(wipe) {
      state = 'wiping';
      await wipe();
      state = 'signed_out';
      return view();
    },
  };
}
