// Astra the same on every phone the owner signs in on (ASTRA.md §5.3): how this phone's saved data and
// the copy kept on the owner's server become one, as pure functions (app/sync.js does the asking and
// the writing). A copy is {astra: 'sync/1', keys: {<BACKUP_KEY>: {at, value, gone?}}}: `value` is what
// the store holds for the key, `at` when the key last changed on a phone (ms), and `gone`, for progress,
// watched and library, the entries removed, each with when (kept 60 days, so a removal never comes back
// from a phone that still had the entry). DEVICE_KEYS never travel.
//
// The merge, key by key:
//  - progress, watched and library: entry by entry, the newer by the entry's own time (progress
//    `updated`, library `added`, watched the time it was marked); a tombstone at least as new as an
//    entry removes it, an entry changed after its tombstone brings it back. So an episode watched on one
//    phone and a film on another both survive.
//  - addons, settings, recentSearches: whole, the newer `at` wins (the same value keeps the server's
//    time). A change is stamped later than the last time this phone saw for that key (sync.js), so a
//    phone whose clock is behind still wins with a change it made after seeing the other's; clocks that
//    disagree matter only for changes two phones made to the same key between two saves.
//  - A phone's first merge: what it has and what the server has are put together, nothing lost (add-ons
//    by address, settings field by field, recent searches both); a phone with nothing but defaults takes
//    the server's.
// Every server value passes the store's own sanitisers first, as a restore does: a key of the wrong
// shape, or whose every entry is damaged, is used as if the server had none (all or nothing per key).

import {BACKUP_KEYS, SANITISE} from './store.js';
import {CINEMETA} from '../addons/client.js';

export const SYNC_TAG = 'sync/1';
/** Keys merged entry by entry, with tombstones for removed entries. */
export const ENTRY_KEYS = ['progress', 'watched', 'library'];
export const GONE_MS = 60 * 864e5;
const MAX_RECENT = 10;

const isObject = v => v != null && typeof v === 'object' && !Array.isArray(v);
const time = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const size = v => Array.isArray(v) ? v.length : isObject(v) ? Object.keys(v).length : 0;

/** When an entry last changed, on the phone that changed it. */
export function entryTime(key, entry) {
  if (key === 'watched') return entry === true ? 1 : time(entry) ?? 0;
  return time(key === 'library' ? entry?.added : entry?.updated) ?? 0;
}

/** Equal as data, whatever the order of an object's fields. */
export function same(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (!isObject(a) || !isObject(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && same(a[k], b[k]));
}

/** Nothing but what a fresh Astra starts with (Cinemeta alone, or nothing saved). */
export function isEmpty(key, value) {
  if (value == null) return true;
  if (key === 'addons') return value.length === 0 || (value.length === 1 && value[0].url === CINEMETA);
  return size(value) === 0;
}

/** Tombstones, checked: id → a time. */
function goneOf(v) {
  const out = {};
  if (isObject(v)) for (const [id, at] of Object.entries(v)) if (time(at) > 0) out[id] = at;
  return out;
}

/**
 * A copy from the server, checked: {keys: {key: {at, value, gone}}} with damaged keys left out, null
 * when it is no copy at all, or 'newer' when a newer Astra wrote it (then nothing is merged or saved).
 */
export function readCopy(copy) {
  if (!isObject(copy) || !isObject(copy.keys)) return null;
  if (copy.astra !== SYNC_TAG) { const n = /^sync\/(\d+)$/.exec(String(copy.astra)); return n && Number(n[1]) > 1 ? 'newer' : null; }
  const keys = {};
  for (const k of BACKUP_KEYS) {
    const e = copy.keys[k];
    if (!isObject(e) || time(e.at) == null) continue;
    const clean = SANITISE[k](e.value);
    if (clean === undefined || (size(e.value) && !size(clean))) continue;
    keys[k] = {at: e.at, value: clean, gone: ENTRY_KEYS.includes(k) ? goneOf(e.gone) : {}};
  }
  return {keys};
}

/** A first merge of a whole key: both put together. */
function union(key, theirs, mine) {
  if (key === 'addons') return [...theirs, ...mine.filter(a => !theirs.some(t => t.url === a.url))];
  if (key === 'recentSearches') {
    const seen = new Set();
    return [...mine, ...theirs].filter(q => !seen.has(q.toLowerCase()) && seen.add(q.toLowerCase())).slice(0, MAX_RECENT);
  }
  const out = {...theirs, ...mine};
  if (theirs.hiddenRows || mine.hiddenRows) out.hiddenRows = [...new Set([...(theirs.hiddenRows || []), ...(mine.hiddenRows || [])])];
  return out;
}

function mergeWhole(key, mine, theirs, first, now) {
  const m = mine?.value === undefined ? null : mine;
  if (!theirs) return m && {at: m.at, value: m.value};
  if (!m || same(m.value, theirs.value)) return theirs;
  if (first) {
    if (isEmpty(key, m.value)) return theirs;
    const value = union(key, theirs.value, m.value);
    return same(value, theirs.value) ? theirs : {at: Math.max(now, m.at, theirs.at + 1), value};
  }
  return m.at > theirs.at ? {at: m.at, value: m.value} : theirs;
}

function mergeEntries(key, side, theirs, now) {
  const mine = side && (side.value !== undefined || size(side.gone)) ? side : null; // nothing saved here and nothing removed
  const a = mine?.value ?? {}, b = theirs?.value ?? {}, gone = {};
  for (const side of [mine?.gone, theirs?.gone])
    for (const [id, at] of Object.entries(side || {})) if (at > now - GONE_MS && !(gone[id] >= at)) gone[id] = at;
  const value = {};
  for (const id of new Set([...Object.keys(b), ...Object.keys(a)])) {
    const x = a[id], y = b[id];
    const entry = x === undefined ? y : y === undefined ? x : entryTime(key, y) > entryTime(key, x) ? y : x;
    if (gone[id] >= entryTime(key, entry)) continue; // removed after its last change: stays removed
    delete gone[id]; // changed after it was removed: it is back
    value[id] = entry;
  }
  if (!mine && !theirs) return null;
  return {at: Math.max(mine?.at ?? 0, theirs?.at ?? 0), value, gone};
}

/** The title playing now keeps this phone's own progress entries (never changed or removed mid-film). */
function keepPlaying(merged, local, playing) {
  const prefix = `${playing.type}:${playing.id}|`, out = {...merged};
  for (const [key, entry] of Object.entries(local || {})) if (key.startsWith(prefix)) out[key] = entry;
  return out;
}

/**
 * Merges this phone's side with the server's. `mine` and `theirs` are {key: {at, value, gone}} (`theirs`
 * from readCopy, {} when nothing is kept; a key this phone has not saved has value undefined). `first`:
 * this phone's first merge. `playing`: {type, id} of the title playing now, or null.
 * Returns {copy, apply, differs}: the merged copy to keep on the server; the values to write on this
 * phone, only those that change; whether the copy differs from the server's (a save is needed).
 */
export function mergeCopies({mine, theirs, first = false, playing = null, now = Date.now()}) {
  const keys = {}, apply = {};
  let differs = false;
  for (const k of BACKUP_KEYS) {
    const entries = ENTRY_KEYS.includes(k), m = mine[k], t = theirs[k];
    const merged = entries ? mergeEntries(k, m, t, now) : mergeWhole(k, m, t, first, now);
    if (!merged) continue;
    keys[k] = entries ? {at: merged.at, value: merged.value, gone: merged.gone} : {at: merged.at, value: merged.value};
    const here = k === 'progress' && playing ? keepPlaying(merged.value, m?.value, playing) : merged.value;
    if (!same(here, m?.value ?? (entries ? {} : undefined))) apply[k] = here;
    if (!t || !same(merged.value, t.value) || (entries && !same(merged.gone, t.gone))) differs = true;
  }
  return {copy: {astra: SYNC_TAG, keys}, apply, differs};
}
