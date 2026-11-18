// A stream's address, found by the owner's own server. A web page cannot read TorBox's API, nor an
// add-on's forwarding link that passes through it (neither lets another site's page read it), but it
// can read TorBox's file servers; so Astra asks its server (POST /v1/astra/play, addons/worker-api.js)
// with the add-on's link and what the link says of the file (addons/link-facts.js), and the server,
// which holds the TorBox key, answers with the film's direct address: from TorBox itself, or where the
// add-on's link leads. Signed out, or when the server cannot help, the add-on's own link is played as
// before, with one plain sentence saying why (Stream info shows it; player/address.js).
//
// mode 'play' (after the owner's tap) may let the server add an item TorBox already holds to the
// owner's account; mode 'ahead' (a finger coming down, the next episode) never adds anything, so it
// answers without an address when the item is not in the account yet, and the tap then asks with 'play'.
//
// Answers are kept in memory only (never stored, gone with the page), per link, for 45 minutes (a
// TorBox link lives 3 hours); one under way is shared. An answer without an address is not kept, except
// a press's (mode 'ahead'), for a minute, so pressing the same card again asks nothing.
//
// A film TorBox does not hold yet is not played at all (via 'none'): opening the add-on's own link is how
// an add-on starts a download there, and Astra never starts one (owner ruling 2026-11-18).
// Signed out, every kept answer is forgotten; app.js forgets them when the add-ons change.

import {api, session, plainSentence, WorkerError, NOT_SIGNED_IN} from './worker-api.js';
import {linkFacts} from './link-facts.js';

export const KEEP = 45 * 60e3;
/** How long a press that got no address is remembered. */
export const MISS = 60e3;
/** How long each mode waits for the server before playing the add-on's own link. */
export const WAIT = {play: 30e3, ahead: 6e3};

// What the owner is told when the add-on's own link is used (never an address, a hash or a name).
export const SAID = {
  signedOut: NOT_SIGNED_IN,
  timeout: 'Your server took too long to answer.',
  unreachable: 'Your server could not be reached.',
  noAddress: 'Your server found no direct address for this stream.',
};

const STEPS = new Set(['key', 'cached', 'owned', 'add', 'file', 'link', 'follow']);
const kept = new Map(); // link -> {at, mode, promise}

/**
 * @typedef {{url: string | null, via: 'torbox' | 'follow' | 'addon' | 'none', size: number | null, type: string | null,
 *   readable: boolean | null, steps: Array<{step: string, ok: boolean, ms: number, note?: string}>, reason: string | null}} Answer
 */

/** Forgets every kept answer (sign-out, the add-ons changed; tests). */
export function forgetAnswers() { kept.clear(); }

const httpsUrl = value => {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; }
};
const count = v => (Number.isSafeInteger(v) && v > 0 ? v : null);

/** The server's steps, as the contract has them; anything else is dropped. */
function cleanSteps(list) {
  return (Array.isArray(list) ? list : []).slice(0, 20).filter(s => s && typeof s === 'object' && STEPS.has(s.step)).map(s => {
    const note = plainSentence(s.note);
    return {step: s.step, ok: s.ok === true, ms: Number.isFinite(s.ms) ? Math.max(0, Math.round(s.ms)) : 0, ...(note ? {note} : {})};
  });
}

/** @returns {Answer} the add-on's own link, and why. */
const addon = (stream, reason, steps = []) => ({url: stream?.url ?? null, via: 'addon', size: null, type: null, readable: null, steps, reason});

/** @returns {Answer} */
function fromAnswer(data, stream) {
  const url = httpsUrl(data.url), steps = cleanSteps(data.steps);
  if (!url) return addon(stream, SAID.noAddress, steps);
  return {url, via: data.via === 'torbox' ? 'torbox' : 'follow', size: count(data.size), type: typeof data.type === 'string' ? data.type.slice(0, 100) : null,
    readable: typeof data.readable === 'boolean' ? data.readable : null, steps, reason: null};
}

/** Asks the server, within the mode's wait. Never rejects. @returns {Promise<Answer>} */
async function lookup(stream, mode, {fetchFn, read}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), WAIT[mode]);
  const body = {link: stream.url, mode};
  for (const [key, value] of Object.entries(linkFacts(stream.url, stream))) if (value !== null) body[key] = value;
  try {
    return fromAnswer(await api('/v1/astra/play', {method: 'POST', body, signal: controller.signal, fetchFn, read}), stream);
  } catch (error) {
    if (controller.signal.aborted) return addon(stream, SAID.timeout);
    if (error instanceof WorkerError && error.code === 'signed-out') { kept.clear(); return addon(stream, SAID.signedOut); }
    // Not on TorBox yet (the server's 503): no address at all, and the add-on's link is left alone.
    if (error instanceof WorkerError && error.code === 'unavailable') return {url: null, via: 'none', size: null, type: null, readable: null, steps: cleanSteps(error.steps), reason: error.reason};
    if (error instanceof WorkerError) return addon(stream, error.reason, cleanSteps(error.steps));
    return addon(stream, SAID.unreachable);
  } finally { clearTimeout(timer); }
}

/** Asks, and keeps the answer while it is under way and, when it has an address, 45 minutes after. */
function ask(stream, mode, options) {
  const link = stream.url, entry = {at: Date.now(), mode, promise: null};
  entry.promise = lookup(stream, mode, options).then(answer => {
    const found = answer.via === 'torbox' || answer.via === 'follow';
    if (kept.get(link) === entry) { if (!found && mode === 'play') kept.delete(link); else { entry.at = Date.now(); entry.miss = !found; } }
    return answer;
  });
  kept.set(link, entry);
  return entry.promise;
}

/** A kept answer when it serves this mode, else a new ask. */
function select(stream, mode, options) {
  const link = stream.url, entry = kept.get(link);
  if (entry && Date.now() - entry.at >= (entry.miss ? MISS : KEEP)) kept.delete(link);
  const live = kept.get(link);
  if (!live) return ask(stream, mode, options);
  if (live.mode === 'play' || mode === 'ahead') return live.promise;
  // A tap after a press: the press's answer when it has an address, else asked again to play.
  if (live.miss) return ask(stream, 'play', options); // a press that found nothing: asked to play, and a second tap shares that ask
  return live.promise.then(answer => (answer.via === 'torbox' || answer.via === 'follow' ? answer : select(stream, 'play', options)));
}

/** The caller's wait ends when its signal aborts; the ask itself goes on, and its answer is kept for the next. */
function waitFor(promise, signal) {
  if (!signal) return promise;
  const stopped = () => signal.reason ?? new DOMException('Aborted', 'AbortError');
  if (signal.aborted) return Promise.reject(stopped());
  return new Promise((resolve, reject) => {
    const stop = () => reject(stopped());
    signal.addEventListener('abort', stop, {once: true});
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

/**
 * The address to play for `stream` (Astra's stream: url, filename, size). Resolves an Answer and never
 * rejects, unless `signal` aborts the wait. `fetchFn` and `read` (the session) are for tests.
 * @param {{url: string | null, filename?: string, size?: number | null}} stream
 * @param {{mode?: 'play' | 'ahead', signal?: AbortSignal, fetchFn?: typeof fetch, read?: typeof session}} [options]
 * @returns {Promise<Answer>}
 */
export async function resolveStream(stream, {mode = 'play', signal, fetchFn, read = session} = {}) {
  if (!httpsUrl(stream?.url)) return addon(stream, null); // a local player's or a plain link: nothing to ask
  const signedIn = await waitFor(read(), signal);
  if (!signedIn) { kept.clear(); return addon(stream, SAID.signedOut); }
  return waitFor(select(stream, mode === 'ahead' ? 'ahead' : 'play', {fetchFn, read: async () => signedIn}), signal);
}

/** Asks afresh to play, whatever is kept (a link that stopped working mid-film). Never rejects. */
export function renewStream(stream, options = {}) {
  if (stream?.url) kept.delete(stream.url);
  return resolveStream(stream, {...options, mode: 'play'});
}
