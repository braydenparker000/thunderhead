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
// Such a press answer is either `ready` (TorBox has the film ready and the server knows its file, so the
// tap costs the add and the address) or a miss (not on TorBox, or the server could not tell).
//
// Answers are kept in memory only (never stored, gone with the page), per link, for 45 minutes (a
// TorBox link lives 3 hours, so the engine always gets one with over two hours left, and renews it
// itself after that); one under way is shared, and a renewed address replaces the kept one. An answer
// without an address is not kept, except a press's (mode 'ahead'): a miss for a minute, so pressing
// the same card again asks nothing, and a ready one for half an hour, as long as the server keeps what
// it learnt. A tap does not wait long for a press still under way (a tap follows the finger by a tenth
// of a second; a press needs a round trip and TorBox's answers): after GRACE it asks to play itself,
// and whichever address comes first is played.
//
// A film TorBox does not hold yet is not played at all (via 'none'): opening the add-on's own link is how
// an add-on starts a download there, and Astra never starts one (owner ruling 2026-11-18).
// Signed out, every kept answer is forgotten; app.js forgets them when the add-ons change.

import {api, session, plainSentence, WorkerError, NOT_SIGNED_IN} from './worker-api.js';
import {linkFacts} from './link-facts.js';

export const KEEP = 45 * 60e3;
/** How long a press that got no address is remembered: a miss, and one TorBox has ready. */
export const MISS = 60e3;
export const READY = 30 * 60e3;
/** How long a tap gives a press still under way to answer before it asks to play itself. */
export const GRACE = 100;
/** How long each mode waits for the server before playing the add-on's own link. */
export const WAIT = {play: 30e3, ahead: 6e3};

// What the owner is told when the add-on's own link is used (never an address, a hash or a name).
export const SAID = {
  signedOut: NOT_SIGNED_IN,
  timeout: 'Your server took too long to answer.',
  unreachable: 'Your server could not be reached.',
  noAddress: 'Your server found no direct address for this stream.',
  ready: 'TorBox has this film ready: a tap adds it to your account and plays it.',
};

const STEPS = new Set(['key', 'cached', 'owned', 'add', 'file', 'link', 'follow']);
const kept = new Map(); // link -> {at, mode, promise, done, found, ready}
const told = new Map(); // the address handed over (or the add-on's link) -> its answer, the last few, for the playback report

/**
 * @typedef {{url: string | null, via: 'torbox' | 'follow' | 'addon' | 'none', size: number | null, type: string | null,
 *   readable: boolean | null, steps: Array<{step: string, ok: boolean, ms: number, note?: string}>, reason: string | null,
 *   ready: boolean, total: number | null}} Answer  `ready`: a press found the film ready on TorBox (no address before a
 *   tap; not a miss); `total`: the server's own time in ms
 */

/** Forgets every kept answer (sign-out, the add-ons changed; tests). */
export function forgetAnswers() { kept.clear(); told.clear(); }

/** How the address being played was found (its via, reason, steps and the server's time), or null: for the playback
 * report, which prints none of the address itself. With no address, the latest answer to a tap (a film not opened). */
export function answerFor(url) {
  if (url === undefined) return [...told.values()].at(-1) ?? null;
  return typeof url === 'string' ? told.get(url) ?? null : null;
}
const tell = (answer, stream) => {
  const at = answer.url || stream?.url;
  if (!at) return;
  told.delete(at); told.set(at, answer);
  while (told.size > 8) told.delete(told.keys().next().value);
};

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

const totalOf = v => (Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
/** @returns {Answer} the add-on's own link, and why. */
const addon = (stream, reason, steps = [], total = null) => ({url: stream?.url ?? null, via: 'addon', size: null, type: null, readable: null, steps, reason, ready: false, total});

/** @returns {Answer} */
function fromAnswer(data, stream) {
  const url = httpsUrl(data.url), steps = cleanSteps(data.steps), total = totalOf(data.total_ms);
  // A press that found the film ready on TorBox, not yet in the account: no address before a tap, and not a miss.
  if (!url && data.ready === true) return {...addon(stream, SAID.ready, steps, total), ready: true};
  if (!url) return addon(stream, SAID.noAddress, steps, total);
  return {url, via: data.via === 'torbox' ? 'torbox' : 'follow', size: count(data.size), type: typeof data.type === 'string' ? data.type.slice(0, 100) : null,
    readable: typeof data.readable === 'boolean' ? data.readable : null, steps, reason: null, ready: false, total};
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
    if (error instanceof WorkerError && error.code === 'unavailable') return {url: null, via: 'none', size: null, type: null, readable: null, steps: cleanSteps(error.steps), reason: error.reason, ready: false, total: null};
    if (error instanceof WorkerError) return addon(stream, error.reason, cleanSteps(error.steps));
    return addon(stream, SAID.unreachable);
  } finally { clearTimeout(timer); }
}

const hasAddress = answer => answer.via === 'torbox' || answer.via === 'follow';

/** Asks, and keeps the answer while it is under way and, when it has an address, 45 minutes after. */
function ask(stream, mode, options) {
  const link = stream.url, entry = {at: Date.now(), mode, promise: null, done: false};
  entry.promise = lookup(stream, mode, options).then(answer => {
    const found = hasAddress(answer);
    if (found || mode === 'play') tell(answer, stream); // what may be played; a press's answer without an address is not
    if (kept.get(link) === entry) {
      if (!found && mode === 'play') kept.delete(link);
      else Object.assign(entry, {at: Date.now(), done: true, found, ready: !found && answer.ready});
    }
    return answer;
  });
  kept.set(link, entry);
  return entry.promise;
}

/** How long a kept answer serves: an address 45 minutes, a ready press half an hour, a miss a minute. A clock set
 * back (the phone's time corrected) counts as expired, so no address outlives its 45 minutes that way. */
const stale = (entry, now = Date.now()) => entry.done && (now < entry.at || now - entry.at >= (entry.found ? KEEP : entry.ready ? READY : MISS));

/** A tap while a press is still under way: the press's address if it comes within GRACE (or before the play's), else
 * the tap's own ask to play, made at once when the press answers without an address (a second tap shares it). */
function afterPress(stream, press, options) {
  return new Promise(resolve => {
    let play = null;
    const sharing = () => { const live = kept.get(stream.url); return live?.mode === 'play' && !stale(live) ? live.promise : null; };
    const start = () => { if (!play) { clearTimeout(timer); play = sharing() || ask(stream, 'play', options); play.then(resolve); } };
    const timer = setTimeout(start, GRACE);
    press.then(answer => { if (hasAddress(answer)) { clearTimeout(timer); resolve(answer); } else start(); });
  });
}

/** A kept answer when it serves this mode, else a new ask. */
function select(stream, mode, options) {
  const link = stream.url, entry = kept.get(link);
  if (entry && stale(entry)) kept.delete(link);
  const live = kept.get(link);
  if (!live) return ask(stream, mode, options);
  if (live.mode === 'play' || mode === 'ahead') return live.promise;
  // A tap after a press: the press's address, else asked to play (a second tap shares that ask).
  if (!live.done) return afterPress(stream, live.promise, options);
  return live.found ? live.promise : ask(stream, 'play', options);
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
