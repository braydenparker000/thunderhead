// A copy from the owner's server, checked before any of it is used (ASTRA.md §5.3). The copy came from one
// of the owner's phones through their Worker, but a phone must survive a damaged or hostile one, so:
//  - every value passes the store's own sanitisers, all or nothing per key (as a restore does);
//  - no time is taken as later than a day from now (`AHEAD`): an entry, a tombstone or a key's `at` from a
//    clock far ahead would otherwise win every merge, and a tombstone for it would never end.

import {BACKUP_KEYS, SANITISE} from './store.js';

export const SYNC_TAG = 'sync/1';
/** Keys merged entry by entry, with tombstones for removed entries. */
export const ENTRY_KEYS = ['progress', 'watched', 'library'];
/** How far ahead of this phone's clock any time may be: phones' clocks may differ, not by more. */
export const AHEAD = 864e5;

export const isObject = v => v != null && typeof v === 'object' && !Array.isArray(v);
const time = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
export const size = v => Array.isArray(v) ? v.length : isObject(v) ? Object.keys(v).length : 0;
/** A time no later than a day from now. */
export const ahead = (t, now) => Math.min(t, now + AHEAD);

/** When an entry last changed, on the phone that changed it. */
export function entryTime(key, entry) {
  if (key === 'watched') return entry === true ? 1 : time(entry) ?? 0;
  return time(key === 'library' ? entry?.added : entry?.updated) ?? 0;
}

/** The entry, its own time brought back to a day from now at most. */
export function withTime(key, entry, now) {
  const max = now + AHEAD;
  if (entryTime(key, entry) <= max) return entry;
  if (key === 'watched') return max;
  return key === 'library' ? {...entry, added: max} : {...entry, updated: max};
}

/** id → a time, each a day from now at most; anything else dropped. */
export function timesOf(v, now) {
  const out = {};
  if (isObject(v)) for (const [id, t] of Object.entries(v)) if (time(t) > 0) out[id] = ahead(t, now);
  return out;
}

/**
 * A copy from the server, checked: {keys: {key: {at, value, gone}}} with damaged keys left out, null when it is
 * no copy at all, or 'newer' when a newer Astra wrote it (then nothing is merged or saved).
 */
export function readCopy(copy, now = Date.now()) {
  if (!isObject(copy) || !isObject(copy.keys)) return null;
  if (copy.astra !== SYNC_TAG) { const n = /^sync\/(\d+)$/.exec(String(copy.astra)); return n && Number(n[1]) > 1 ? 'newer' : null; }
  const keys = {};
  for (const k of BACKUP_KEYS) {
    const e = copy.keys[k];
    if (!isObject(e) || time(e.at) == null) continue;
    let clean = SANITISE[k](e.value);
    if (clean === undefined || (size(e.value) && !size(clean))) continue;
    const entries = ENTRY_KEYS.includes(k);
    if (entries) clean = Object.fromEntries(Object.entries(clean).map(([id, x]) => [id, withTime(k, x, now)]));
    keys[k] = {at: ahead(e.at, now), value: clean, gone: entries ? timesOf(e.gone, now) : {}};
  }
  return {keys};
}
