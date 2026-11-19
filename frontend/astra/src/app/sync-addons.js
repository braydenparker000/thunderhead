// Add-ons merged address by address (ASTRA.md §5.3), so a removal sticks: an add-on removed on one phone (perhaps
// because its key leaked) must not come back from another phone that still had it. Each address carries when it was
// had or last added again (`times`), and a removal leaves a tombstone (`gone`, 60 days, as for the entry keys). An
// address stays only while it was added after its last removal; the side whose list changed last gives the order and
// each add-on's fields (on or off, its name), and addresses only the other side has follow, in its order. A phone's
// first merge is the same rule: everything both have, minus what was removed.
//
// Times and tombstones are keyed by a fingerprint of the address (`addressKey`), never the address itself: the
// device record lives in localStorage in clear, and a removed add-on's address is a secret that should go with it.

import {ahead, isObject} from './sync-read.js';

/** A fingerprint of an add-on's address (64 bits as 16 hex digits): two FNV-1a style 32-bit hashes. It names
 * an address in times and tombstones without keeping it; two addresses sharing one is about 1 in 10^17 for 100. */
export function addressKey(url) {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
    b ^= b >>> 15;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/** What a copy keeps of an add-on: the fields Astra uses. */
export const addonOf = a => ({url: a.url, enabled: a.enabled !== false, name: typeof a.name === 'string' ? a.name : 'Add-on'});

/** Merges `mine` and `theirs` ({at, value, times, gone}; either may be absent). `GONE_MS`: how long a tombstone lasts. */
export function mergeAddons(mine, theirs, {now, gone: goneMs}) {
  const m = mine?.value === undefined ? null : {...mine, at: ahead(mine.at, now)};
  if (!m && !theirs) return null;
  const gone = {}, times = {};
  for (const side of [m?.gone, theirs?.gone])
    for (const [fp, t] of Object.entries(side || {})) { const at = ahead(t, now); if (at > now - goneMs && !(gone[fp] >= at)) gone[fp] = at; }
  for (const side of [m?.times, theirs?.times])
    for (const [fp, t] of Object.entries(side || {})) { const at = ahead(t, now); if (!(times[fp] >= at)) times[fp] = at; }
  // Removed after it was last had: stays removed. An address with no known time counts as had long ago.
  const stays = a => !(gone[addressKey(a.url)] >= (times[addressKey(a.url)] ?? 0));
  const [newer, older] = !theirs || (m && m.at > theirs.at) ? [m, theirs] : [theirs, m];
  const value = newer.value.filter(stays).map(addonOf);
  for (const a of older?.value ?? []) if (!value.some(x => x.url === a.url) && stays(a)) value.push(addonOf(a));
  const kept = {};
  for (const a of value) { const fp = addressKey(a.url); delete gone[fp]; if (times[fp]) kept[fp] = times[fp]; }
  return {at: newer.at, value, times: kept, gone};
}

/** Tombstones and add times for a change made here: `before` and `after` are the fingerprints held. */
export function stampAddons(rec, before, after, stamp) {
  rec.gone.addons ??= {};
  for (const fp of before) if (!after.has(fp)) { rec.gone.addons[fp] = stamp(rec.added[fp]); delete rec.added[fp]; }
  for (const fp of after) if (!before.has(fp)) { rec.added[fp] = stamp(rec.gone.addons[fp]); delete rec.gone.addons[fp]; }
}

/** The fingerprints of a list of add-ons. */
export const addressesOf = list => new Set((Array.isArray(list) ? list : []).filter(a => isObject(a) && typeof a.url === 'string').map(a => addressKey(a.url)));

/** One line for add-ons a merge brought that this phone did not have (`before`: its list, or nothing saved):
 * by name and host, or a count and the hosts. Empty when none came. Cinemeta, which a fresh Astra has, is no news. */
export function arrivedLine(before, after, cinemeta) {
  const had = new Set((before ?? [{url: cinemeta}]).map(a => a.url));
  const came = (after ?? []).filter(a => !had.has(a.url));
  const host = a => { try { return new URL(a.url).host; } catch { return '?'; } };
  if (!came.length) return '';
  if (came.length === 1) return `Added from your other phones: ${came[0].name} (${host(came[0])})`;
  return `Added from your other phones: ${came.length} add-ons (${[...new Set(came.map(host))].join(', ')})`;
}
