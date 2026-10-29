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
/** @typedef {import('../../shared/contract/api.ts').SessionItem} SessionItem */
/** @typedef {import('../../shared/contract/api.ts').NoticeAckRequest} NoticeAckRequest */
/** @typedef {import('../../shared/contract/api.ts').PasswordRequest} PasswordRequest */
/** @typedef {import('../../shared/contract/api.ts').PasswordResponse} PasswordResponse */
/** @typedef {import('../../shared/contract/api.ts').RecoveryCodeResponse} RecoveryCodeResponse */
/** @typedef {import('../../shared/contract/api.ts').AgentsResponse} AgentsResponse */
/** @typedef {import('../../shared/contract/api.ts').NewAgentRequest} NewAgentRequest */
/** @typedef {import('../../shared/contract/api.ts').NewAgentResponse} NewAgentResponse */
/** @typedef {import('../../shared/contract/api.ts').TodayResponse} TodayResponse */
/** @typedef {import('../../shared/contract/api.ts').Message} Message */
/** @typedef {import('../../shared/contract/api.ts').ChangesResponse} ChangesResponse */
/** @typedef {import('../../shared/contract/api.ts').LiveTicket} LiveTicket */
/** @typedef {import('../../shared/contract/api.ts').Settings} Settings */
/** @typedef {import('../../shared/contract/api.ts').SurfacesResponse} SurfacesResponse */
/** @typedef {import('../../shared/contract/api.ts').Verb} Verb */
/** @typedef {import('../../shared/contract/api.ts').VerbResultRequest} VerbResultRequest */
/** @typedef {import('../../shared/contract/api.ts').Fact} Fact */
/** @typedef {import('../../shared/contract/api.ts').FactDetail} FactDetail */
/** @typedef {import('../../shared/contract/api.ts').ProposalsResponse} ProposalsResponse */
/** @typedef {import('../../shared/contract/api.ts').DecideProposalRequest} DecideProposalRequest */
/** @typedef {import('../../shared/contract/api.ts').DecideProposalResponse} DecideProposalResponse */
/** @typedef {import('../../shared/contract/api.ts').MemoryOp} MemoryOp */
/** @typedef {import('../../shared/contract/api.ts').MemoryOpsResponse} MemoryOpsResponse */
/** @typedef {import('../../shared/contract/api.ts').ProfileResponse} ProfileResponse */
/** @typedef {import('../../shared/contract/api.ts').DayNote} DayNote */
/** @typedef {import('../../shared/contract/api.ts').PutDayNoteRequest} PutDayNoteRequest */
/** @typedef {import('../../shared/contract/api.ts').OpenThread} OpenThread */
/** @typedef {import('../../shared/contract/api.ts').PutOpenThreadRequest} PutOpenThreadRequest */
/** @typedef {import('../../shared/contract/api.ts').PatchOpenThreadRequest} PatchOpenThreadRequest */

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
   * @param {{ method?: string, token?: string, body?: unknown, keepalive?: boolean }} [opts]
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
      // A write sent while the page goes away (a pending Forget) must still arrive.
      keepalive: opts.keepalive ?? false,
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
    /** @param {string} resetFp @returns {Promise<AuthStateResponse>} */
    resetState: (resetFp) => call(`/v1/auth/state?reset_fp=${encodeURIComponent(resetFp)}`),
    /** @param {string} token @param {string} id @param {NoticeAckRequest['answer']} answer @returns {Promise<null>} */
    ackNotice: (token, id, answer) =>
      call(`/v1/auth/notices/${encodeURIComponent(id)}/ack`, { method: 'POST', token, body: { answer } }),
    /** @param {string} token @param {PasswordRequest} body @returns {Promise<PasswordResponse>} */
    password: (token, body) => call('/v1/auth/password', { method: 'POST', token, body }),
    /** @param {string} token @param {string} current_password @returns {Promise<RecoveryCodeResponse>} */
    newRecoveryCode: (token, current_password) =>
      call('/v1/auth/recovery-code', { method: 'POST', token, body: { current_password } }),
    /** @param {string} token @param {string} last5 @returns {Promise<null>} */
    confirmRecovery: (token, last5) => call('/v1/auth/recovery-code/confirm', { method: 'POST', token, body: { last5 } }),
    /** @param {string} token @param {string} ticket_id @returns {Promise<null>} */
    cancelReset: (token, ticket_id) => call('/v1/auth/breakglass/cancel', { method: 'POST', token, body: { ticket_id } }),
    /** @param {string} token @param {string} id @param {string} label @returns {Promise<SessionItem>} */
    relabel: (token, id, label) =>
      call(`/v1/auth/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', token, body: { label } }),
    /** @param {string} token @param {string} id @returns {Promise<null>} */
    revokeSession: (token, id) => call(`/v1/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', token }),
    /** @param {string} token @returns {Promise<AgentsResponse>} */
    agents: (token) => call('/v1/auth/agents', { token }),
    /** @param {string} token @param {NewAgentRequest} body @returns {Promise<NewAgentResponse>} */
    newAgent: (token, body) => call('/v1/auth/agents', { method: 'POST', token, body }),
    /** @param {string} token @param {string} id @returns {Promise<null>} */
    revokeAgent: (token, id) => call(`/v1/auth/agents/${encodeURIComponent(id)}`, { method: 'DELETE', token }),

    // --- the conversation and the live channel (P2) --------------------------------------------
    /** @param {string} token @returns {Promise<TodayResponse>} */
    today: (token) => call('/v1/threads/today', { token }),
    /** @param {string} token @param {string} id @param {string} body @returns {Promise<Message>} */
    say: (token, id, body) => call(`/v1/messages/${encodeURIComponent(id)}`, { method: 'PUT', token, body: { body } }),
    /** @param {string} token @param {number} after @returns {Promise<ChangesResponse>} */
    changes: (token, after) => call(`/v1/changes?after=${after}&limit=500`, { token }),
    /** @param {string} token @returns {Promise<LiveTicket>} */
    liveTicket: (token) => call('/v1/live/ticket', { method: 'POST', token }),
    /** @param {string} token @returns {Promise<Settings>} */
    settings: (token) => call('/v1/settings', { token }),
    /** @param {string} token @returns {Promise<SurfacesResponse>} */
    surfaces: (token) => call('/v1/surfaces', { token }),
    /** @param {string} token @returns {Promise<null>} */
    typing: (token) => call('/v1/mind/typing', { method: 'POST', token, body: {} }),
    /** @param {string} token @returns {Promise<null>} */
    stop: (token) => call('/v1/mind/stop', { method: 'POST', token, body: {} }),
    /** @param {string} token @returns {Promise<{ items: Verb[] }>} */
    pendingVerbs: (token) => call('/v1/verbs/pending', { token }),
    /** @param {string} token @param {string} id @returns {Promise<Verb>} */
    claimVerb: (token, id) => call(`/v1/verbs/${encodeURIComponent(id)}/claim`, { method: 'POST', token, body: {} }),
    /** @param {string} token @param {string} id @param {VerbResultRequest} body @returns {Promise<Verb>} */
    verbResult: (token, id, body) => call(`/v1/verbs/${encodeURIComponent(id)}/result`, { method: 'POST', token, body }),

    // --- memory (P3) ---------------------------------------------------------------------------
    /** @param {string} token @param {string | null} cursor @returns {Promise<{ items: Fact[], next: string | null }>} */
    facts: (token, cursor) => call(`/v1/memory/facts?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { token }),
    /** @param {string} token @param {string} id @returns {Promise<FactDetail>} */
    fact: (token, id) => call(`/v1/memory/facts/${encodeURIComponent(id)}`, { token }),
    /** @param {string} token @returns {Promise<ProfileResponse>} */
    profile: (token) => call('/v1/memory/profile', { token }),
    /** @param {string} token @param {string} batch_id @param {MemoryOp[]} ops @param {boolean} [keepalive] @returns {Promise<MemoryOpsResponse>} */
    memoryOps: (token, batch_id, ops, keepalive = false) =>
      call('/v1/memory/ops', { method: 'POST', token, body: { batch_id, ops }, keepalive }),
    /** @param {string} token @returns {Promise<{ items: OpenThread[] }>} */
    openThreads: (token) => call('/v1/memory/open-threads?status=open', { token }),
    /** @param {string} token @param {string} id @param {PutOpenThreadRequest} body @returns {Promise<OpenThread>} */
    putThread: (token, id, body) => call(`/v1/memory/open-threads/${encodeURIComponent(id)}`, { method: 'PUT', token, body }),
    /** @param {string} token @param {string} id @param {PatchOpenThreadRequest} body @returns {Promise<OpenThread>} */
    patchThread: (token, id, body) => call(`/v1/memory/open-threads/${encodeURIComponent(id)}`, { method: 'PATCH', token, body }),
    /** @param {string} token @returns {Promise<{ items: DayNote[] }>} */
    dayNotes: (token) => call('/v1/memory/day-notes', { token }),
    /** @param {string} token @param {string} day @param {PutDayNoteRequest} body @returns {Promise<DayNote>} */
    putDayNote: (token, day, body) => call(`/v1/memory/day-notes/${encodeURIComponent(day)}`, { method: 'PUT', token, body }),
    /** @param {string} token @returns {Promise<ProposalsResponse>} */
    proposals: (token) => call('/v1/proposals?status=waiting&limit=50', { token }),
    /** @param {string} token @param {string} id @param {DecideProposalRequest} body @returns {Promise<DecideProposalResponse>} */
    decide: (token, id, body) => call(`/v1/proposals/${encodeURIComponent(id)}/decide`, { method: 'POST', token, body }),
  };
}
