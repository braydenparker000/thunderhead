// Astra's way to the owner's own Worker, with the site's sign-in (SECURITY.md §4.4 rule 4, as Guitar's
// page does): the session is read through th/ported/session.js (a top-level page, or a frame whose top
// page is this site's own; it never writes or creates the sign-in's database), and the API's address
// comes from the site's /config.js. Both load on first use, so a page without them, or signed out,
// behaves exactly as before. The lab imports this module too.
//
// api(path, {method, body, signal}) sends the session, answers the parsed JSON, and throws a
// WorkerError carrying the server's own plain sentence (`details.reason` of its error envelope) and
// its `details.steps`. Nothing here keeps, logs or reports a request or an answer.

/** @typedef {{api: string, token: string}} Session */

/** The error api() throws: `code` is the server's, or 'signed-out', 'network', 'unreadable'; `reason` one plain sentence. */
export class WorkerError extends Error {
  constructor(message, {status = 0, code = '', reason = '', steps = []} = {}) {
    super(message);
    this.name = 'WorkerError';
    Object.assign(this, {status, code, reason: reason || message, steps});
  }
}

export const NOT_SIGNED_IN = 'Astra is not signed in on this phone.';

// The site's files, loaded once they are first needed (a failure is not kept: the next ask tries again).
let site = null;
function siteFiles() {
  site ??= Promise.all([import('/config.js'), import('/th/ported/session.js')])
    .then(([config, session]) => ({api: String(config.CONFIG?.api || ''), sessionToken: session.sessionToken}))
    .catch(error => { site = null; throw error; });
  return site;
}

/**
 * The owner's session and the API's address, or null when signed out (or framed by another site, or
 * the site has no API yet).
 * @returns {Promise<Session | null>}
 */
export async function session() {
  try {
    const {api, sessionToken} = await siteFiles();
    const token = api ? await sessionToken() : null;
    return token ? {api, token} : null;
  } catch { return null; }
}

/** The API's origin when signed in (for a connection opened ahead), else ''. */
export async function apiOrigin(read = session) {
  return (await read())?.api || '';
}

/** One plain sentence from the server, kept short and on one line; '' when there is none. */
export function plainSentence(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 300) : '';
}

const SAID = {
  401: 'Your sign-in on this phone has ended.',
  403: 'Your server refused this request.',
  404: 'Your server does not offer this yet.',
  429: 'Your server is busy just now.',
};

/**
 * Asks the owner's Worker. `path` starts with /v1/. `fetchFn` and `read` (the session) are for tests.
 * @param {string} path
 * @param {{method?: string, body?: unknown, signal?: AbortSignal, fetchFn?: typeof fetch, read?: () => Promise<Session | null>}} [options]
 * @returns {Promise<any>}
 */
export async function api(path, {method = 'GET', body, signal, fetchFn = (...a) => globalThis.fetch(...a), read = session} = {}) {
  const s = await read();
  if (!s) throw new WorkerError(NOT_SIGNED_IN, {code: 'signed-out'});
  const headers = {Authorization: 'Bearer ' + s.token, ...(body === undefined ? {} : {'Content-Type': 'application/json'})};
  let response;
  try {
    response = await fetchFn(s.api + path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal,
      cache: 'no-store', credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer'});
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new WorkerError('Your server could not be reached.', {code: 'network'});
  }
  let data = null;
  try { data = await response.json(); } catch (error) { if (signal?.aborted) throw error; }
  if (!response.ok) {
    const e = data?.error, details = e?.details && typeof e.details === 'object' ? e.details : {};
    throw new WorkerError(SAID[response.status] || 'Your server could not do this just now.', {status: response.status,
      code: typeof e?.code === 'string' ? e.code : '', reason: plainSentence(details.reason), steps: Array.isArray(details.steps) ? details.steps : []});
  }
  if (response.status === 204) return {}; // done, with nothing to say (a removal)
  if (data === null || typeof data !== 'object') throw new WorkerError('Your server sent an answer Astra could not read.', {status: response.status, code: 'unreadable'});
  return data;
}
