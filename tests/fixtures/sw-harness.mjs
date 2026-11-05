// The service worker (frontend/sw.js) without a browser, for tests/sw.test.mjs: it runs in a vm
// context with a fake `self` (its listeners kept, its clients' messages and notifications recorded),
// a fake IndexedDB of `kv` stores (the shape th/idb.js keeps) and a `fetch` the test answers.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** A fake IndexedDB: databases of one `kv` store each; `dbs` holds their maps. */
function fakeIndexedDb(dbs) {
  const later = (f) => setTimeout(f, 0);
  return {
    open(name) {
      const req = {};
      later(() => {
        if (!dbs.has(name)) {
          req.transaction = { abort: () => {} };
          req.onupgradeneeded?.();
          req.error = new Error('aborted');
          return req.onerror?.();
        }
        const map = dbs.get(name);
        req.result = {
          close() {},
          transaction() {
            const t = {};
            const store = {};
            const op = (f) => {
              const r = {};
              later(() => {
                r.result = f();
                later(() => t.oncomplete?.());
              });
              return r;
            };
            store.get = (k) => op(() => structuredClone(map.get(k)));
            store.put = (v, k) => op(() => void map.set(k, structuredClone(v)));
            store.delete = (k) => op(() => void map.delete(k));
            t.objectStore = () => store;
            return t;
          },
        };
        req.onsuccess?.();
      });
      return req;
    },
  };
}

/** Loads sw.js. `answer(url, init)` answers its fetches (a Response). */
export function loadWorker(answer) {
  const listeners = new Map();
  const told = [];
  const notes = [];
  const fetched = [];
  const dbs = new Map();
  const self = {
    location: { origin: 'https://site.example.test' },
    addEventListener: (type, f) => listeners.set(type, f),
    registration: { showNotification: async (title, o) => notes.push({ title, ...o }) },
    clients: { matchAll: async () => [{ url: 'https://site.example.test/photos/', postMessage: (m) => told.push(structuredClone(m)) }], claim: async () => {} },
    skipWaiting: () => {},
  };
  const fetch = async (url, init = {}) => {
    fetched.push({ url: String(url), ...init });
    return answer(String(url), init);
  };
  const context = vm.createContext({ self, fetch, indexedDB: fakeIndexedDb(dbs), caches: {}, URL, Response, Request, AbortSignal, JSON, Promise, setTimeout, structuredClone, console });
  vm.runInContext(readFileSync(new URL('../../frontend/sw.js', import.meta.url), 'utf8'), context);
  /** Dispatches an event the way the browser would and waits for its waitUntil. */
  const dispatch = async (type, event) => {
    let job = Promise.resolve();
    listeners.get(type)({ type, ...event, waitUntil: (p) => { job = p; } });
    await job;
  };
  return { listeners, told, notes, fetched, dbs, dispatch };
}
