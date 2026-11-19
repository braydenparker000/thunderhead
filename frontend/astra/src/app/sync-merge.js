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

import {BACKUP_KEYS, MAX_PROGRESS} from './store.js';
import {CINEMETA} from '../addons/client.js';
import {ENTRY_KEYS, SYNC_TAG, ahead, entryTime, isObject, size, withTime} from './sync-read.js';
import {mergeAddons} from './sync-addons.js';

export {ENTRY_KEYS, SYNC_TAG, entryTime, readCopy} from './sync-read.js';
export const GONE_MS = 60 * 864e5;
const MAX_RECENT = 10;
/** The newest watched marks a copy carries. A mark is about 55 bytes; 3,000 is some three years of a series
 * watcher's episodes in about 165 KB, a third of a full phone's copy. Older marks stay on the phones that have them. */
export const WATCHED_MAX = 3000;

/** The newest `max` entries of an entry key, by their own times (as Astra itself keeps progress). */
function newest(key, value, max) {
  const ids = Object.keys(value);
  if (ids.length <= max) return value;
  ids.sort((a, b) => entryTime(key, value[b]) - entryTime(key, value[a]));
  return Object.fromEntries(ids.slice(0, max).map(id => [id, value[id]]));
}

/** Equal as data, whatever the order of an object's fields. Walked with a list, never by recursion, so no value
 * (this phone's own included) can be deep enough to stop it. */
export function same(a, b) {
  const pairs = [[a, b]];
  while (pairs.length) {
    const [x, y] = pairs.pop();
    if (x === y) continue;
    if (Array.isArray(x)) {
      if (!Array.isArray(y) || x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) pairs.push([x[i], y[i]]);
    } else if (isObject(x) && isObject(y)) {
      const keys = Object.keys(x);
      if (keys.length !== Object.keys(y).length) return false;
      for (const k of keys) { if (!Object.hasOwn(y, k)) return false; pairs.push([x[k], y[k]]); }
    } else return false;
  }
  return true;
}

/** Nothing but what a fresh Astra starts with (Cinemeta alone, or nothing saved). */
export function isEmpty(key, value) {
  if (value == null) return true;
  if (key === 'addons') return value.length === 0 || (value.length === 1 && value[0].url === CINEMETA);
  return size(value) === 0;
}

/** A first merge of a whole key: both put together. */
function union(key, theirs, mine) {
  if (key === 'recentSearches') {
    const seen = new Set();
    return [...mine, ...theirs].filter(q => !seen.has(q.toLowerCase()) && seen.add(q.toLowerCase())).slice(0, MAX_RECENT);
  }
  const out = {...theirs, ...mine};
  if (theirs.hiddenRows || mine.hiddenRows) out.hiddenRows = [...new Set([...(theirs.hiddenRows || []), ...(mine.hiddenRows || [])])];
  return out;
}

function mergeWhole(key, mine, theirs, first, now) {
  const m = mine?.value === undefined ? null : {...mine, at: ahead(mine.at, now)};
  if (!theirs) return m && {at: m.at, value: m.value};
  if (!m || same(m.value, theirs.value)) return theirs;
  if (first) {
    if (isEmpty(key, m.value)) return theirs;
    const value = union(key, theirs.value, m.value);
    return same(value, theirs.value) ? theirs : {at: ahead(Math.max(now, m.at, theirs.at + 1), now), value};
  }
  return m.at > theirs.at ? {at: m.at, value: m.value} : theirs;
}

function mergeEntries(key, side, theirs, now) {
  const mine = side && (side.value !== undefined || size(side.gone)) ? side : null; // nothing saved here and nothing removed
  const a = mine?.value ?? {}, b = theirs?.value ?? {}, gone = {};
  for (const side of [mine?.gone, theirs?.gone])
    for (const [id, t] of Object.entries(side || {})) { const at = ahead(t, now); if (at > now - GONE_MS && !(gone[id] >= at)) gone[id] = at; }
  const value = {};
  for (const id of new Set([...Object.keys(b), ...Object.keys(a)])) {
    // Times a day ahead at most, this phone's own entries too (a clock far ahead once): healed as they are written.
    const x = a[id] === undefined ? undefined : withTime(key, a[id], now), y = b[id];
    const entry = x === undefined ? y : y === undefined ? x : entryTime(key, y) > entryTime(key, x) ? y : x;
    if (gone[id] >= entryTime(key, entry)) continue; // removed after its last change: stays removed
    delete gone[id]; // changed after it was removed: it is back
    value[id] = entry;
  }
  if (!mine && !theirs) return null;
  return {at: ahead(Math.max(mine?.at ?? 0, theirs?.at ?? 0), now), value, gone};
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
    let merged = entries ? mergeEntries(k, m, t, now)
      : k !== 'addons' ? mergeWhole(k, m, t, first, now)
      : first && t && isEmpty(k, m?.value) ? t : mergeAddons(m, t, {now, gone: GONE_MS}); // a first merge with defaults: the server's
    if (!merged) continue;
    // Progress is Astra's own 300 newest, here and in the copy; the copy carries the newest watched marks only.
    if (k === 'progress') merged = {...merged, value: newest(k, merged.value, MAX_PROGRESS)};
    const sent = k === 'watched' ? newest(k, merged.value, WATCHED_MAX) : merged.value;
    // The same as the server's: keep its times, so a stamp here that changed nothing never wins later.
    if (t && k === 'addons' && same(merged.value, t.value) && same(merged.gone, t.gone) && same(merged.times, t.times)) merged = t;
    keys[k] = entries ? {at: merged.at, value: sent, gone: merged.gone}
      : k === 'addons' ? {at: merged.at, value: merged.value, times: merged.times ?? {}, gone: merged.gone ?? {}} : {at: merged.at, value: merged.value};
    const here = k === 'progress' && playing ? keepPlaying(merged.value, m?.value, playing) : merged.value;
    if (!same(here, m?.value ?? (entries ? {} : undefined))) apply[k] = here;
    if (!t || !same(keys[k].value, t.value) || ((entries || k === 'addons') && !same(keys[k].gone, t.gone)) || (k === 'addons' && !same(keys[k].times, t.times))) differs = true;
  }
  return {copy: {astra: SYNC_TAG, keys}, apply, differs};
}
