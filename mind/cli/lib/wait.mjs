// `th wait [--minutes N] [--after <seq>]` (RUNTIME.md §4.5, API.md §11.5) and the listening half of
// `th listen` and `th reply` (lib/reply.mjs).
//
// Loops short "takes" of GET /v1/live/wait. The session proxy cuts any request at 30 s, so each take
// asks the Worker to hold for at most 25 s and the client aborts at 28 s. A take that fails is retried
// with back-off until the deadline: the lease lapses after ~90 s without a call, and a lapsed lease
// means handed-out messages are requeued, so it pays to keep trying gently.
//
// The idle cut-off: `th wait` with no --minutes, and `th listen`, read idle_min and idle_cutoff_min
// from GET /v1/mind/pending at start, again every 5 minutes while takes come back empty, and when the
// cut-off is reached. At the cut-off with nothing waiting, th closes the session itself (the model is
// not asked): th status stopping, the local mark `closed`, {"closed":{"idle_min":n}}, exit 12.
//
// Exit 0 messages/events · 3 timeout/quiet · 4 Stop · 5 day closed · 12 closed · 2/6/11 at once on
// 401/403/already_live. Messages off the record come named (`off_record`), with the rule beside them.
import {EXIT, ThError, invalid, out, redact} from './io.mjs';
import {request, sleep} from './http.mjs';
import {getState, setState} from './state.mjs';
import {handedOver, listening} from './keepalive.mjs';

/** What the session is told beside messages off the record (the Worker refuses the writes anyway). */
export const OFF_RECORD_NOTE = 'Off the record: answer each with --reply-to, so the answer stays in its conversation. ' +
  'Remember nothing from it: no fact, rule, loose end, title or session note (the Worker refuses: off_record).';

/** The Worker holds a take for at most this many seconds (the proxy cuts at 30 s). */
export const TAKE_S = 25;
/** `th listen` listens this long by default: it fits a foreground Bash call with a 10-minute timeout. */
export const LISTEN_MINUTES = 9;
/** The cut-off when the Worker can't be asked (the `mind.idle` default). */
export const FALLBACK_CUTOFF_MIN = 45;
/** How often a quiet listener asks the Worker for the cut-off again. */
const REFRESH_MS = 5 * 60_000;

const positive = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);
/** One minute in ms; TH_MINUTE_MS shortens it in tests only. */
const minuteMs = () => positive(process.env.TH_MINUTE_MS, 60_000);

function idleMinutes(startedAt) {
  const since = getState('last_owner_at') ?? getState('claimed_at') ?? startedAt;
  return Math.max(0, Math.floor((Date.now() - Number(since)) / minuteMs()));
}

/** Owner messages handed to this session and not yet answered, oldest first ({id, seq}). */
export const handed = () => (Array.isArray(getState('handed')) ? getState('handed') : []);

function noteOwnerMessages(messages) {
  const latest = Math.max(...messages.map(m => Number(m.created_at) || 0));
  if (latest > 0 && latest > (getState('last_owner_at') ?? 0)) setState('last_owner_at', latest);
  setState('owner_seen', true);
  const known = new Set(handed().map(h => h.id));
  const fresh = messages.filter(m => m?.id && !known.has(m.id)).map(m => ({id: m.id, seq: Number(m.seq) || 0}));
  setState('handed', [...handed(), ...fresh].slice(-20));
}

/** A reply to `id` answers it and every message handed before it (the Worker settles them so). */
export function forgetAnswered(id) {
  const list = handed();
  const at = list.findIndex(h => h.id === id);
  setState('handed', at < 0 ? list : list.slice(at + 1));
}

/** The Worker's idle and cut-off, or null when it can't be read. */
async function readIdle() {
  try {
    const {data} = await request('GET', '/v1/mind/pending', {retry: false});
    if (Number.isFinite(data?.idle_min) && Number.isFinite(data?.idle_cutoff_min)) {
      return {idle: data.idle_min, cutoff: data.idle_cutoff_min, at: Date.now(),
        unanswered: Array.isArray(data.unanswered) ? data.unanswered : []};
    }
  } catch { /* the local estimate stands in */ }
  return null;
}

/** Ends the session without the model: what `th status stopping` sends, the local mark, exit 12. */
async function close(idleMin) {
  try {
    await request('POST', '/v1/mind/status', {body: {state: 'stopping'}});
    setState('status', {state: 'stopping', at: Date.now()});
  } catch (error) {
    process.stderr.write(redact(`th: could not report stopping (${error?.code || 'error'})\n`));
  }
  setState('closed', true);
  out({closed: {idle_min: idleMin}});
  return EXIT.closed;
}

/**
 * The take loop. `minutes`: stop after that long (exit 3); `cutoff`: also stop at the idle cut-off
 * (exit 12, or 3 while an owner message is unanswered). `quiet`: print the quiet form at exit 3.
 * @param {{minutes?: number, cutoff?: boolean, quiet?: boolean, after?: number}} opts
 * @returns {Promise<number>} exit code
 */
export async function listenLoop({minutes, cutoff = false, quiet = false, after: from} = {}) {
  const env = process.env;
  const takeS = Math.min(TAKE_S, Math.max(1, Math.floor(positive(env.TH_TAKE_S, TAKE_S))));
  const abortMs = positive(env.TH_TAKE_ABORT_MS, (takeS + 3) * 1000);
  const backoffMs = positive(env.TH_RETRY_BASE_MS, 1000);
  let after = from !== undefined ? Number(from) : Number(getState('seq', 0)) || 0;
  if (!Number.isFinite(after) || after < 0) throw invalid('--after must be a sequence number');
  setState('closed', false);
  listening();

  const startedAt = Date.now();
  const until = minutes === undefined ? Infinity : startedAt + minutes * 60_000;
  let read = cutoff ? await readIdle() : null;
  const idleNow = () => (read ? read.idle + Math.floor((Date.now() - read.at) / minuteMs()) : idleMinutes(startedAt));
  const closeTime = () => (!cutoff ? Infinity : read ? read.at + (read.cutoff - read.idle) * minuteMs()
    : startedAt + (FALLBACK_CUTOFF_MIN - idleMinutes(startedAt)) * minuteMs());
  let closeAt = closeTime();
  let failures = 0;
  /** @type {ThError|null} */
  let lastError = null;
  for (;;) {
    if (Date.now() >= closeAt) {
      read = (await readIdle()) ?? read;
      closeAt = Math.max(closeTime(), read ? 0 : closeAt);
      if (Date.now() < closeAt) continue;
      if (lastError) throw lastError;
      if (!read?.unanswered.length) return close(idleNow());
      out(quiet ? {quiet: {idle_min: idleNow(), closes_in_min: 0}, unanswered: read.unanswered}
        : {timeout: {idle_min: idleNow()}, unanswered: read.unanswered});
      return EXIT.timeout;
    }
    if (Date.now() >= until) break;
    const end = Math.min(until, closeAt);
    const timeout = Math.max(1, Math.min(takeS, Math.ceil((end - Date.now()) / 1000)));
    let data;
    try {
      ({data} = await request('GET', '/v1/live/wait', {query: {after, timeout}, retry: false, timeoutMs: abortMs}));
    } catch (error) {
      if (!(error instanceof ThError) || (error.exit !== EXIT.unreachable && error.exit !== EXIT.budget)) throw error;
      lastError = error;
      failures++;
      process.stderr.write(redact(`th: wait: take failed (${error.code}); retrying\n`));
      await sleep(Math.min(30_000, backoffMs * 2 ** Math.min(failures - 1, 5), Math.max(0, end - Date.now())));
      continue;
    }
    failures = 0;
    lastError = null;
    if (Number.isFinite(data?.seq)) { after = data.seq; setState('seq', after); }
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    const events = Array.isArray(data?.events) ? data.events : [];
    const signals = Array.isArray(data?.signals) ? data.signals : [];
    if (messages.length) noteOwnerMessages(messages);
    // The session's own acknowledgement, and the lease kept while the mind works (keepalive.mjs).
    if (messages.length) await handedOver();
    const held = Array.isArray(data?.off_record) && data.off_record.length ? {off_record: {threads: data.off_record, note: OFF_RECORD_NOTE}} : {};
    const extra = {...(messages.length ? {messages} : {}), ...(events.length ? {events} : {}), ...held};
    if (signals.includes('day_closed')) {
      out({day_closed: {day: getState('day'), seq: after}, ...extra});
      return EXIT.day_closed;
    }
    if (signals.includes('stop')) {
      out({stop: {seq: after}, ...extra});
      return EXIT.stop;
    }
    if (messages.length || events.length) {
      out({messages, events, ...held});
      return EXIT.ok;
    }
    if (cutoff && Date.now() - (read?.at ?? startedAt) >= REFRESH_MS) {
      read = (await readIdle()) ?? read;
      closeAt = closeTime();
    }
  }
  if (lastError) throw lastError;
  if (quiet) out({quiet: {idle_min: idleNow(), closes_in_min: Math.max(0, Math.ceil((closeAt - Date.now()) / minuteMs()))}});
  else out({timeout: {idle_min: idleMinutes(startedAt)}});
  return EXIT.timeout;
}

/** `th wait`: --minutes N stops after N (exit 3); without it, it runs to the idle cut-off. */
export async function wait(flags) {
  if (flags.minutes !== undefined && !(Number(flags.minutes) > 0)) throw invalid('--minutes must be a positive number');
  const minutes = flags.minutes === undefined ? undefined : Number(flags.minutes);
  return listenLoop({minutes, cutoff: minutes === undefined, after: flags.after});
}
