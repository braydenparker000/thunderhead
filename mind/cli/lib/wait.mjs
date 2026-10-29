// `th wait [--minutes N] [--after <seq>]` (RUNTIME.md §4.5, API.md §11.5).
//
// Loops short "takes" of GET /v1/live/wait. The session proxy cuts any request at 30 s, so each take
// asks the Worker to hold for at most 25 s and the client aborts at 28 s. A take that fails is retried
// with back-off until the deadline: the lease lapses after ~90 s without a call, and a lapsed lease
// means handed-out messages are requeued, so it pays to keep trying gently.
//
// Exit 0 messages/events · 3 timeout · 4 Stop · 5 day closed · 2/6/11 at once on 401/403/already_live.
import {EXIT, ThError, invalid, out, redact} from './io.mjs';
import {request, sleep} from './http.mjs';
import {getState, setState} from './state.mjs';

/** The Worker holds a take for at most this many seconds (the proxy cuts at 30 s). */
export const TAKE_S = 25;
/** Launch value in P2 (RUNTIME.md §4.5.5) until test R-2 proves 50-minute waits. */
export const DEFAULT_MINUTES = 24;

const positive = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);

function idleMinutes(startedAt) {
  const since = getState('last_owner_at') ?? getState('claimed_at') ?? startedAt;
  return Math.max(0, Math.floor((Date.now() - Number(since)) / 60_000));
}

function noteOwnerMessages(messages) {
  const latest = Math.max(...messages.map(m => Number(m.created_at) || 0));
  if (latest > 0 && latest > (getState('last_owner_at') ?? 0)) setState('last_owner_at', latest);
  setState('owner_seen', true);
}

/** @param {Record<string, any>} flags @returns {Promise<number>} exit code */
export async function wait(flags) {
  const env = process.env;
  const minutes = flags.minutes === undefined ? positive(env.TH_WAIT_MINUTES, DEFAULT_MINUTES) : Number(flags.minutes);
  if (!(minutes > 0)) throw invalid('--minutes must be a positive number');
  const takeS = Math.min(TAKE_S, Math.max(1, Math.floor(positive(env.TH_TAKE_S, TAKE_S))));
  const abortMs = positive(env.TH_TAKE_ABORT_MS, (takeS + 3) * 1000);
  const backoffMs = positive(env.TH_RETRY_BASE_MS, 1000);
  let after = flags.after !== undefined ? Number(flags.after) : Number(getState('seq', 0)) || 0;
  if (!Number.isFinite(after) || after < 0) throw invalid('--after must be a sequence number');

  const startedAt = Date.now();
  const deadline = startedAt + minutes * 60_000;
  let failures = 0;
  /** @type {ThError|null} */
  let lastError = null;
  while (Date.now() < deadline) {
    const timeout = Math.max(1, Math.min(takeS, Math.ceil((deadline - Date.now()) / 1000)));
    let data;
    try {
      ({data} = await request('GET', '/v1/live/wait', {query: {after, timeout}, retry: false, timeoutMs: abortMs}));
    } catch (error) {
      if (!(error instanceof ThError) || (error.exit !== EXIT.unreachable && error.exit !== EXIT.budget)) throw error;
      lastError = error;
      failures++;
      process.stderr.write(redact(`th: wait: take failed (${error.code}); retrying\n`));
      await sleep(Math.min(30_000, backoffMs * 2 ** Math.min(failures - 1, 5), Math.max(0, deadline - Date.now())));
      continue;
    }
    failures = 0;
    lastError = null;
    if (Number.isFinite(data?.seq)) { after = data.seq; setState('seq', after); }
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    const events = Array.isArray(data?.events) ? data.events : [];
    const signals = Array.isArray(data?.signals) ? data.signals : [];
    if (messages.length) noteOwnerMessages(messages);
    const extra = {...(messages.length ? {messages} : {}), ...(events.length ? {events} : {})};
    if (signals.includes('day_closed')) {
      out({day_closed: {day: getState('day'), seq: after}, ...extra});
      return EXIT.day_closed;
    }
    if (signals.includes('stop')) {
      out({stop: {seq: after}, ...extra});
      return EXIT.stop;
    }
    if (messages.length || events.length) {
      out({messages, events});
      return EXIT.ok;
    }
  }
  if (lastError) throw lastError;
  out({timeout: {idle_min: idleMinutes(startedAt)}});
  return EXIT.timeout;
}
