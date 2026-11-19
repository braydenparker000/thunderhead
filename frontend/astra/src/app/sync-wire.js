// What Astra's sync sends to the owner's Worker and how it reads the answers (ASTRA.md §5.3, API.md §11.21), through
// worker-api.js with the site's sign-in. Three requests, all to /v1/astra/backup:
//  - GET ?known=<version this phone last merged>: the copy kept, or {same: true} when it is still that version (the
//    Worker answers from the object's head, so a start where nothing changed costs a few hundred bytes);
//  - PUT ?base=<version merged with> (absent: nothing was kept), the body being the copy itself: its new version;
//  - DELETE: the copy and its daily copies removed.
// A version is an opaque random id, so a query holds nothing of the owner's. Answers are checked before use.

import {isObject, readCopy} from './sync-read.js';

export const PATH = '/v1/astra/backup';
/** The Worker's cap on a copy as sent (shared/contract/astra.ts `ASTRA_BACKUP.max_bytes`). */
export const MAX_COPY = 1024 * 1024;
/** A keepalive request's body may be 64 KiB at most: kept under it. */
export const KEEPALIVE_MAX = 63 * 1024;

const query = (name, version) => version ? `?${name}=${encodeURIComponent(version)}` : '';
const unreadable = () => Object.assign(Error('Your server sent an answer Astra could not read.'), {code: 'unreadable'});
/** A copy's size as it would be sent. */
export const sizeOf = copy => new TextEncoder().encode(JSON.stringify(copy)).length;

/** The copy kept: {version, copy} (copy: readCopy's, null when none or unusable), or {version, same: true}. */
export async function fetchCopy(api, known, now) {
  const a = await api(PATH + query('known', known));
  if (!isObject(a)) throw unreadable();
  if (a.same === true) {
    if (!known || a.version !== known) throw unreadable();
    return {version: known, same: true};
  }
  if (!('copy' in a) || (a.version !== null && typeof a.version !== 'string')) throw unreadable();
  return {version: a.version, copy: a.version === null ? null : readCopy(a.copy, now)};
}

/** Saves `copy` in place of the version `base` names; its new version. `keepalive`: a fetch that outlives the page. */
export async function saveCopy(api, copy, base, keepalive = null) {
  const saved = await api(PATH + query('base', base), {method: 'PUT', body: copy, ...(keepalive ? {fetchFn: keepalive} : {})});
  if (typeof saved?.version !== 'string') throw unreadable();
  return saved.version;
}

export const removeCopy = api => api(PATH, {method: 'DELETE'});
