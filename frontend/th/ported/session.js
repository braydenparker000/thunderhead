// @ts-check
// The owner's session for a ported app whose data has moved to the new Worker (SECURITY.md §4.4
// rule 4; Guitar in P6, Podcasts' worker in P8): read from this site's IndexedDB `th-auth` as the
// shell keeps it, only by a top-level page or a frame whose top page is this site's own (home's
// island, NEXT-BATCH.md part 3; a copy another site frames never gets it, and a service worker checks
// whose request it answers, th/ported/frames.js), never written anywhere else. Null when signed out:
// the app then asks the old Worker as before.

/** Whether this page is in a frame of another site's page (a frame whose top is this site is ours:
 * reading the top's origin throws across sites). */
export function framedByOther() {
  if (typeof window === 'undefined' || window.top === window.self) return false;
  // Home's layer is one level down; anything deeper is not ours to trust.
  if (window.parent !== window.top) return true;
  try {
    return window.top?.location.origin !== location.origin;
  } catch {
    return true;
  }
}

/** @returns {Promise<string | null>} */
export function sessionToken() {
  if (framedByOther()) return Promise.resolve(null);
  return new Promise((resolve) => {
    /** @type {IDBOpenDBRequest} */
    let req;
    try {
      req = indexedDB.open('th-auth');
    } catch {
      resolve(null);
      return;
    }
    // No such database: signed out. Never create it here.
    req.onupgradeneeded = () => req.transaction?.abort();
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const get = db.transaction('kv', 'readonly').objectStore('kv').get('session');
        get.onsuccess = () => {
          db.close();
          resolve(typeof get.result?.token === 'string' ? get.result.token : null);
        };
        get.onerror = () => {
          db.close();
          resolve(null);
        };
      } catch {
        db.close();
        resolve(null);
      }
    };
  });
}
