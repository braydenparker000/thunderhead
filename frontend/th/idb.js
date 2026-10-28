// @ts-check
// A tiny key-value store on IndexedDB: one database per purpose (`th-auth`, `th-setup`,
// `th-recover`), one object store `kv`. Each call opens and closes its own connection, so a
// later `deleteDatabase` (sign-out wipe, SIGN-IN.md §11.3) is never blocked by an open one.

/** Reading never creates the database, so a wiped device stays wiped (SIGN-IN.md §11.3).
 * @param {string} name @param {boolean} create @returns {Promise<IDBDatabase | null>} */
function open(name, create) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      if (create) req.result.createObjectStore('kv');
      else req.transaction?.abort();
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => (create ? reject(req.error) : resolve(null));
  });
}

/**
 * @template T
 * @param {string} name
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest} run
 * @param {boolean} [create] only a write makes the database
 * @returns {Promise<T>}
 */
async function tx(name, mode, run, create = mode === 'readwrite') {
  const db = await open(name, create);
  if (!db) return /** @type {T} */ (undefined);
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction('kv', mode);
      const req = run(t.objectStore('kv'));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

/** @param {string} name */
export function kv(name) {
  return {
    /** @param {string} key @returns {Promise<any>} */
    get: (key) => tx(name, 'readonly', (s) => s.get(key)),
    /** @param {string} key @param {unknown} value @returns {Promise<void>} */
    set: (key, value) => tx(name, 'readwrite', (s) => s.put(value, key)),
    /** @param {string} key @returns {Promise<void>} */
    del: (key) => tx(name, 'readwrite', (s) => s.delete(key), false),
    /** Deletes the whole database. @returns {Promise<void>} */
    drop: () =>
      new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = req.onerror = req.onblocked = () => resolve(undefined);
      }),
  };
}
