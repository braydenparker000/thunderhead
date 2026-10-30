// @ts-check
// The owner's session for a ported app whose data has moved to the new Worker (SECURITY.md §4.4
// rule 4; Guitar in P6, Podcasts' worker in P8): read from this site's IndexedDB `th-auth` as the
// shell keeps it, only by a top-level page (a framed copy never gets it; a service worker checks
// whose request it answers), never written anywhere else. Null when signed out: the app then asks
// the old Worker as before.

/** @returns {Promise<string | null>} */
export function sessionToken() {
  if (typeof window !== 'undefined' && window.top !== window.self) return Promise.resolve(null);
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
