// @ts-check
// Where the data meter keeps its tally: one localStorage entry, `th.p.data` (th/data/tally.js KEY).
// localStorage rather than IndexedDB because a page going away must still write its last counts, and
// only a synchronous store does that inside `pagehide`; every page of the site (home, the framed apps,
// an app open on its own) shares it, and the th.p. prefix means signing out clears it (th/session.js).
// It is small: 62 days of at most eleven parts, three numbers each. Nothing here ever leaves the phone.
import { KEY, empty, merge, parse, prune } from './tally.js';

/** @typedef {import('./tally.js').Tally} Tally */

/** The tally as kept (a fresh one from now when there is none or it cannot be read). @param {number} [now] @returns {Tally} */
export function read(now = Date.now()) {
  try {
    return parse(JSON.parse(localStorage.getItem(KEY) || 'null'), now);
  } catch {
    return empty(now);
  }
}

/** @param {Tally} t */
function write(t) {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {}
}

/** A batch of counts into the kept tally, in one synchronous read and write. @param {Tally} batch @param {number} [now] */
export function mergeIn(batch, now = Date.now()) {
  write(prune(merge(read(now), batch), now));
}

/** Starts counting again from now. @param {number} [now] */
export function reset(now = Date.now()) {
  write(empty(now));
}
