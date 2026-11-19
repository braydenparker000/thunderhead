// What this phone remembers for keeping Astra in step (ASTRA.md §5.3), in localStorage `astra.sync.v1`, outside
// the store's `astra.v2.*` so backups, restores and Reset never carry it: the switch, whether this phone has merged
// with the server yet, when each key last changed here, removed entries and add-ons (60 days; add-ons by a fingerprint
// of their address, never the address), when each add-on was had, the version last merged, when it last saved and
// fetched, and whether a save is owed. Read back field by field: a damaged record starts afresh.

import {AHEAD, ENTRY_KEYS, isObject} from './sync-read.js';
import {stampAddons} from './sync-addons.js';

export const RECORD = 'astra.sync.v1';

const times = v => isObject(v) ? Object.fromEntries(Object.entries(v).filter(([, t]) => typeof t === 'number' && Number.isFinite(t))) : {};

/** Keys whose removed entries are remembered. */
const GONE_KEYS = [...ENTRY_KEYS, 'addons'];

export const fresh = () => ({off: false, joined: false, at: {}, gone: {}, added: {}, version: null, savedAt: null, fetchedAt: null, owed: false});

/** The record as stored, checked field by field. */
export function recordOf(v) {
  if (!isObject(v)) return fresh();
  const stamp = x => typeof x === 'number' && Number.isFinite(x) ? x : null;
  return {off: v.off === true, joined: v.joined === true, at: times(v.at), gone: Object.fromEntries(GONE_KEYS.map(k => [k, times(v.gone?.[k])])), added: times(v.added),
    version: typeof v.version === 'string' ? v.version : null, savedAt: stamp(v.savedAt), fetchedAt: stamp(v.fetchedAt), owed: v.owed === true};
}

/** A change made now, stamped later than `seen` (the last time this phone saw for it), so a change made after
 * seeing another phone's wins even when this clock is behind; never past a day ahead of this clock. */
export const stampAfter = (seen, now) => Math.min(Math.max(now, (seen ?? 0) + 1), now + AHEAD);

/** The stamps for one key that changed here at `t`. `was` and `now` hold its entries before and after: entry id →
 * the entry's time for the entry keys, the add-ons' fingerprints for add-ons. */
export function stampChange(rec, k, was, now, t) {
  rec.at[k] = stampAfter(rec.at[k], t);
  if (!was) return;
  if (k === 'addons') stampAddons(rec, was.entries, now.entries, seen => stampAfter(seen, t));
  else if (ENTRY_KEYS.includes(k)) for (const [id, time] of was.entries) if (!now.entries.has(id)) rec.gone[k][id] = stampAfter(time, t);
}
