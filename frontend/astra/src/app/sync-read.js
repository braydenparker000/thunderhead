// A copy from the owner's server, checked before any of it is used (ASTRA.md §5.3). The copy came from one
// of the owner's phones through their Worker, but a phone must survive a damaged or hostile one, so:
//  - every value passes the store's own sanitisers, all or nothing per key (as a restore does);
//  - no time is taken as later than `AHEAD` from now: an entry, a tombstone or a key's `at` from a clock far
//    ahead would otherwise win every merge, and a tombstone for it would never end. A key where a time was
//    brought back is marked `clamped`, so the merge saves it back: the server then holds a fixed time that
//    falls into the past, not a far-future one read as "just ahead" again at every fetch;
//  - nothing may bloat or wedge it: a value nested deeper than `MAX_DEPTH` or holding a string longer than
//    `MAX_STRING` is as if not kept (the merge's own walks stay shallow), an unknown setting larger than
//    `MAX_SETTING` is dropped, add-ons keep only the fields Astra uses, recent searches are 10 of 200 characters.

import {BACKUP_KEYS, SANITISE} from './store.js';

export const SYNC_TAG = 'sync/1';
/** Keys merged entry by entry, with tombstones for removed entries. */
export const ENTRY_KEYS = ['progress', 'watched', 'library'];
/** How far ahead of this phone's clock any time may be: phones' clocks may differ, not by more. Half the Worker's
 * own day (shared/contract/astra.ts `ahead_ms`), so a stamp made here passes its check with this clock hours fast. */
export const AHEAD = 12 * 3600e3;
export const MAX_DEPTH = 6;
export const MAX_STRING = 4096; // a remembered stream's link may be this long (app/remembered.js LINK_MAX): a longer string would drop all progress
export const MAX_SETTING = 4096;
const MAX_URL = 4096, MAX_NAME = 200, MAX_RECENT = 10, MAX_QUERY = 200;
const KNOWN_SETTINGS = new Set(['posterWidth', 'posterRadius', 'hero', 'showCatalogType', 'recentSearches', 'openSubtitles', 'hiddenRows',
  'readyAhead', 'findIntros', 'skipLookup']);

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

/** Whether a value is at most `MAX_DEPTH` deep with no string past `MAX_STRING`: walked with a list, never
 * by recursion, and given up as soon as either bound is passed. */
export function bounded(value) {
  const stack = [[value, 0]];
  while (stack.length) {
    const [v, depth] = stack.pop();
    if (typeof v === 'string') { if (v.length > MAX_STRING) return false; continue; }
    if (v === null || typeof v !== 'object') continue;
    if (depth >= MAX_DEPTH) return false;
    for (const x of Array.isArray(v) ? v : Object.values(v)) stack.push([x, depth + 1]);
  }
  return true;
}

/** What a key's value may hold before the store's sanitiser sees it (null: the key is as if not kept). */
function shaped(key, value) {
  // Add-ons: only the fields Astra uses, each of a fixed kind, so nothing else of them is walked or kept.
  if (key === 'addons' && Array.isArray(value))
    return value.filter(a => typeof a?.url === 'string' && a.url.length <= MAX_URL)
      .map(a => ({url: a.url, enabled: a.enabled !== false, name: typeof a.name === 'string' ? a.name.slice(0, MAX_NAME) : 'Add-on'}));
  if (key === 'settings' && isObject(value)) {
    // Settings Astra does not know are kept, as on the phone that wrote them, unless they are large.
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (!KNOWN_SETTINGS.has(k) && (!bounded(v) || JSON.stringify(v).length > MAX_SETTING)) continue;
      out[k] = v;
    }
    value = out;
  }
  if (!bounded(value)) return null;
  if (key === 'recentSearches' && Array.isArray(value)) return value.filter(q => typeof q === 'string' && q.length <= MAX_QUERY).slice(0, MAX_RECENT);
  return value;
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
    const value = shaped(k, e.value);
    if (value === null) continue;
    let clean = SANITISE[k](value);
    if (clean === undefined || (size(value) && !size(clean))) continue;
    const entries = ENTRY_KEYS.includes(k), max = now + AHEAD;
    let clamped = e.at > max;
    if (entries) clean = Object.fromEntries(Object.entries(clean).map(([id, x]) => { const y = withTime(k, x, now); clamped ||= y !== x; return [id, y]; }));
    const late = v => isObject(v) && Object.values(v).some(t => t > max);
    clamped ||= late(e.gone) || (k === 'addons' && late(e.times));
    keys[k] = {at: ahead(e.at, now), value: clean, gone: entries || k === 'addons' ? timesOf(e.gone, now) : {}};
    if (k === 'addons') keys[k].times = timesOf(e.times, now);
    if (clamped) keys[k].clamped = true;
  }
  return {keys};
}
