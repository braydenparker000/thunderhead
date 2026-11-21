// The service worker (frontend/sw.js) without a browser, for tests/sw.test.mjs: it runs in a vm
// context with a fake `self` (its listeners kept, its clients' messages and notifications recorded),
// a fake IndexedDB of `kv` stores (the shape th/idb.js keeps), fake caches and a `fetch` the test answers.
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

/** A fake CacheStorage: named caches of path → { bytes, status, type }; `stores` holds them. */
function fakeCaches(stores) {
  const key = (req) => new URL(String(req?.url ?? req), 'https://site.example.test').pathname;
  const out = (e) => (e ? new Response(e.bytes, { status: e.status, headers: { 'content-type': e.type } }) : undefined);
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const map = stores.get(name);
    return {
      match: async (req) => out(map.get(key(req))),
      put: async (req, res) => void map.set(key(req), { bytes: new Uint8Array(await res.arrayBuffer()), status: res.status, type: res.headers.get('content-type') ?? '' }),
      keys: async () => [...map.keys()].map((k) => new Request(`https://site.example.test${k}`)),
    };
  };
  return {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (req, { cacheName } = {}) => {
      for (const [name, map] of stores) if (!cacheName || name === cacheName) { const e = map.get(key(req)); if (e) return out(e); }
      return undefined;
    },
  };
}

/** Loads sw.js. `answer(url, init)` answers its fetches (a Response); `build` is the BUILD stamped into it. */
export function loadWorker(answer, { build = 0 } = {}) {
  const listeners = new Map();
  const told = [];
  const notes = [];
  const fetched = [];
  const dbs = new Map();
  const stores = new Map();
  const self = {
    location: { origin: 'https://site.example.test' },
    addEventListener: (type, f) => listeners.set(type, f),
    registration: { showNotification: async (title, o) => notes.push({ title, ...o }) },
    clients: { matchAll: async () => [{ url: 'https://site.example.test/photos/', postMessage: (m) => told.push(structuredClone(m)) }], claim: async () => {} },
    skipWaiting: () => {},
  };
  const fetch = async (url, init = {}) => {
    const href = String(url?.url ?? url);   // (a Request, as the fetch handler passes one on)
    fetched.push({ url: href, ...init });
    return answer(href, init);
  };
  const context = vm.createContext({ self, fetch, indexedDB: fakeIndexedDb(dbs), caches: fakeCaches(stores), URL, Response, Request, Headers, AbortSignal, JSON, Promise, setTimeout, structuredClone, console });
  const source = readFileSync(new URL('../../frontend/sw.js', import.meta.url), 'utf8').replace(/^const BUILD = 0;$/m, `const BUILD = ${build};`);
  vm.runInContext(source, context);
  /** Dispatches an event the way the browser would and waits for its waitUntil. */
  const dispatch = async (type, event) => {
    let job = Promise.resolve();
    listeners.get(type)({ type, ...event, waitUntil: (p) => { job = p; } });
    await job;
  };
  return { self, listeners, told, notes, fetched, dbs, stores, dispatch };
}
