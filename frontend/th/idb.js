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

/** Databases no write may reach any more in this page: `th-data` once a sign-out's wipe has begun (an outbox
 * write still in flight must not make it again for whoever signs in next), `th-kept` once a sign-out by hand
 * has begun (th/session.js). The page then leaves for /signin/, which starts with none. */
export const sealed = new Set();

/**
 * @template T
 * @param {string} name
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest} run
 * @param {boolean} [create] only a write makes the database
 * @returns {Promise<T>}
 */
async function tx(name, mode, run, create = mode === 'readwrite') {
  const shut = () => mode === 'readwrite' && sealed.has(name);
  if (shut()) throw new Error(`${name} is sealed`);
  const db = await open(name, create);
  if (!db) return /** @type {T} */ (undefined);
  if (shut()) { db.close(); throw new Error(`${name} is sealed`); }
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
    /** Every value whose key starts with `prefix`, in key order. @param {string} prefix @returns {Promise<any[]>} */
    list: async (prefix) => (await tx(name, 'readonly', (s) => s.getAll(IDBKeyRange.bound(prefix, `${prefix}\uffff`)))) ?? [],
    /** Deletes the whole database. @returns {Promise<void>} */
    drop: () =>
      new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = req.onerror = req.onblocked = () => resolve(undefined);
      }),
  };
}
