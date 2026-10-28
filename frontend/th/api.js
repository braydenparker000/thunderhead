// @ts-check
// The site's API client: typed from shared/contract through JSDoc, so the frontend keeps no
// build step while TypeScript still checks every request and response shape (decision X5).
// Bearer token only, never cookies (the site and the API are different sites). Every request
// sends TH-Client and gives up after 15 s; a non-JSON 5xx or 429 (Cloudflare's own error
// pages) becomes `unavailable` (API.md §6).

/** @typedef {import('../../shared/contract/api.ts').ErrorBody} ErrorBody */
/** @typedef {import('../../shared/contract/api.ts').ErrorCode} ErrorCode */
/** @typedef {import('../../shared/contract/api.ts').HealthResponse} HealthResponse */
/** @typedef {import('../../shared/contract/api.ts').AuthStateResponse} AuthStateResponse */
/** @typedef {import('../../shared/contract/api.ts').SetupRequest} SetupRequest */
/** @typedef {import('../../shared/contract/api.ts').LoginRequest} LoginRequest */
/** @typedef {import('../../shared/contract/api.ts').RecoverRequest} RecoverRequest */
/** @typedef {import('../../shared/contract/api.ts').SignedIn} SignedIn */
/** @typedef {import('../../shared/contract/api.ts').SignedInWithCode} SignedInWithCode */
/** @typedef {import('../../shared/contract/api.ts').DeviceMe} DeviceMe */
/** @typedef {import('../../shared/contract/api.ts').SignoutRequest} SignoutRequest */
/** @typedef {import('../../shared/contract/api.ts').SessionsResponse} SessionsResponse */

export const TIMEOUT_MS = 15_000;

/** An API failure, carrying the server's stable error code. */
export class ApiError extends Error {
  /** @param {number} status @param {ErrorBody['error']} error */
  constructor(status, error) {
    super(error.message);
    this.status = status;
    /** @type {ErrorCode} */
    this.code = error.code;
    this.details = error.details ?? null;
    /** Seconds to wait (429), from the body, not `Retry-After` alone (SIGN-IN.md §6.2). */
    this.retryAfter = error.retry_after ?? null;
    this.scope = error.scope ?? null;
  }
}

/**
 * @param {{ base: string, client: string, timeoutMs?: number }} config `client` is
 *   `<build>.<sha7>` from config.js.
 */
export function createApi({ base, client, timeoutMs = TIMEOUT_MS }) {
  /**
   * @template T
   * @param {string} path
   * @param {{ method?: string, token?: string, body?: unknown }} [opts]
   * @returns {Promise<T>}
   */
  async function call(path, opts = {}) {
    /** @type {Record<string, string>} */
    const headers = { 'TH-Client': client };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + path, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    /** @type {any} */
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (res.ok) return data;
    if (!data?.error) {
      const unavailable = { code: /** @type {ErrorCode} */ ('unavailable'), message: `HTTP ${res.status}`, request_id: '' };
      throw new ApiError(res.status, unavailable);
    }
    throw new ApiError(res.status, /** @type {ErrorBody} */ (data).error);
  }

  return {
    call,
    /** @returns {Promise<HealthResponse>} */
    health: () => call('/v1/health'),
    /** @param {string} [fp] @returns {Promise<AuthStateResponse>} */
    authState: (fp) => call(`/v1/auth/state${fp ? `?fp=${encodeURIComponent(fp)}` : ''}`),
    /** @param {SetupRequest} body @returns {Promise<SignedInWithCode>} */
    setup: (body) => call('/v1/auth/setup', { method: 'POST', body }),
    /** @param {LoginRequest} body @returns {Promise<SignedIn>} */
    login: (body) => call('/v1/auth/login', { method: 'POST', body }),
    /** @param {RecoverRequest} body @returns {Promise<SignedInWithCode>} */
    recover: (body) => call('/v1/auth/recover', { method: 'POST', body }),
    /** @param {string} token @returns {Promise<DeviceMe>} */
    me: (token) => call('/v1/auth/me', { token }),
    /** @param {string} token @param {SignoutRequest['scope']} scope @returns {Promise<null>} */
    signout: (token, scope) => call('/v1/auth/signout', { method: 'POST', token, body: { scope } }),
    /** @param {string} token @returns {Promise<SessionsResponse>} */
    sessions: (token) => call('/v1/auth/sessions', { token }),
  };
}
