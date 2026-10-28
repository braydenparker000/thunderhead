// @ts-check
// The one API client the pages share, built from config.js, plus the signed-in call wrapper:
// any 401 that says this device is signed out wipes it and goes to /signin/ with the reason
// (SIGN-IN.md §11.2), and a sign-out that couldn't reach the server is retried here first.

import { CONFIG } from '../config.js';
import { createApi } from './api.js';
import { failure, signedOutReason } from './flow.js';
import { pending, store, wipe } from './session.js';

/** True once the site has an API address; until then every page behaves as before sign-in. */
export const configured = Boolean(CONFIG.api);
export const api = createApi({ base: CONFIG.api.replace(/\/+$/, ''), client: `${CONFIG.build}.${String(CONFIG.commit).slice(0, 7)}` });

/** Where /signin/ should come back to: this page. */
export const here = () => location.pathname + location.search;

/** @param {string} reason */
export function toSignin(reason = '') {
  const q = new URLSearchParams();
  if (reason && reason !== 'signed_out_here') q.set('reason', reason);
  const next = here();
  if (next !== '/') q.set('next', next);
  const qs = q.toString();
  location.replace(`/signin/${qs ? `?${qs}` : ''}`);
}

/**
 * Runs `fn` with this device's token. Without a session, or when the server says the session
 * ended, it wipes and leaves for /signin/; every other error is rethrown for the page to show.
 * @template T
 * @param {(token: string) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function signedIn(fn) {
  const s = await store.read();
  if (!s) {
    toSignin();
    return new Promise(() => {});
  }
  try {
    return await fn(s.token);
  } catch (e) {
    const reason = signedOutReason(failure(e));
    if (reason) {
      await wipe();
      toSignin(reason);
      return new Promise(() => {});
    }
    throw e;
  }
}

/** Sends a sign-out that failed while offline (§11.3), then forgets it. */
export async function flushPendingSignout() {
  const token = await pending.get();
  if (!token || !configured) return;
  try {
    await api.signout(token, 'this');
    await pending.clear();
  } catch (e) {
    if (failure(e).kind === 'api') await pending.clear();
  }
}

/** Signs this device out: the server first if it can be reached, then the wipe (§11.3). */
export async function signOutHere() {
  const s = await store.read();
  let reached = true;
  if (s) {
    try {
      await api.signout(s.token, 'this');
    } catch (e) {
      reached = failure(e).kind === 'api';
    }
  }
  await wipe();
  if (s && !reached) await pending.set(s.token);
  location.replace('/signin/');
}
