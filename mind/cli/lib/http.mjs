// One HTTPS call to the Worker, with the headers RUNTIME.md §5.1 and API.md §1 ask for,
// and retries (1 s, 2 s, 4 s) on network errors and 5xx.
//
// The token: in cloud sessions the environment's network secret adds `Authorization` on the way
// out, so th normally has no token at all. `TH_TOKEN` is used only when it is set (local runs, tests).
// The token is never logged, printed or put in a URL.
import {checkRoute} from './contract.mjs';
import {EXIT, ThError, VERSION, exitFor} from './io.mjs';
import {getState} from './state.mjs';

const num = (value, fallback) => (Number.isFinite(Number(value)) && value !== '' && value !== undefined ? Number(value) : fallback);
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function settings(env = process.env) {
  return {
    api: (env.TH_API || '').replace(/\/+$/, ''),
    token: env.TH_TOKEN || '',
    role: env.TH_ROLE || '',
    session: env.CLAUDE_CODE_REMOTE_SESSION_ID || getState('session_id') || '',
    retryBaseMs: num(env.TH_RETRY_BASE_MS, 1000),
    timeoutMs: num(env.TH_REQUEST_TIMEOUT_MS, 28_000),
  };
}

async function readBody(res) {
  const text = await res.text().catch(() => '');
  if (!text) return {};
  try { return JSON.parse(text); } catch {
    if (res.ok) throw new ThError(EXIT.unexpected, 'bad_json', `the Worker answered HTTP ${res.status} with non-JSON`);
    return {error: {code: 'unavailable', message: `non-JSON response (HTTP ${res.status})`}};
  }
}

/**
 * @param {string} method
 * @param {string} path  starts with /v1/
 * @param {{query?: Record<string, any>, body?: any, raw?: Buffer, headers?: Record<string,string>,
 *          retry?: boolean, timeoutMs?: number}} [opts]
 * @returns {Promise<{status: number, data: any, headers: Headers}>}
 */
export async function request(method, path, opts = {}) {
  checkRoute(method, path);
  const s = settings();
  if (!s.api) throw new ThError(EXIT.unreachable, 'no_api', 'TH_API is not set');
  const url = new URL(s.api + path);
  for (const [k, v] of Object.entries(opts.query || {})) {
    if (v !== undefined && v !== null && v !== '' && v !== false) url.searchParams.set(k, String(v));
  }
  /** @type {Record<string, string>} */
  const headers = {'TH-Client': `th/${VERSION}`, ...(opts.headers || {})};
  if (s.role) headers['TH-Role'] = s.role;
  if (s.session) headers['TH-Session'] = s.session;
  if (s.token) headers.Authorization = `Bearer ${s.token}`;
  let body;
  if (opts.raw !== undefined) body = opts.raw;
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers['Content-Type'] = 'application/json'; }

  const tries = opts.retry === false ? 1 : 4;
  let last = new ThError(EXIT.unreachable, 'unreachable', 'no attempt made');
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt) await sleep(s.retryBaseMs * 2 ** (attempt - 1));
    let res;
    try {
      res = await fetch(url, {method, headers, body, signal: AbortSignal.timeout(opts.timeoutMs ?? s.timeoutMs)});
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      last = new ThError(EXIT.unreachable, timedOut ? 'timeout' : 'unreachable',
        `${method} ${url.pathname}: ${timedOut ? 'timed out' : error?.cause?.code || error?.cause?.errors?.[0]?.code || error?.message || 'network error'}`);
      continue;
    }
    const data = await readBody(res);
    if (res.ok) return {status: res.status, data, headers: res.headers};
    const code = data?.error?.code || `http_${res.status}`;
    const exit = exitFor(res.status, code);
    last = new ThError(exit, code, data?.error?.message || `HTTP ${res.status}`,
      data?.error?.request_id || res.headers.get('th-request-id'));
    if (exit !== EXIT.unreachable) throw last;
  }
  throw last;
}

/** RUNTIME.md §5.1: when the owner has tapped Stop, say/status responses say so; th prints `th: STOP` on stderr. */
export function stopNotice(res) {
  if (res.headers.get('th-stop') === '1' || res.data?.stop) {
    process.stderr.write('th: STOP: the owner tapped Stop. Finish the current step, reply "Stopped. Done: … Not done: …", and stop that work.\n');
    return true;
  }
  return false;
}
